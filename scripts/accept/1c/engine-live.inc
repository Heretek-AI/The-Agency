#!/usr/bin/env bash
# engine-live.inc: run the Stage 1c live engine proof inside the dispatcher
# image on the `fleet` network. Scope is `scout`, `docs`, or `both` (used by
# `make engine-live`). Prints the engine log on failure.
# Exit 0 on success, 1 on failure, 77 when the proof cannot run here.
# The provider key is only tested for presence, never printed.
set -u
set -o pipefail

scope="${1:?usage: engine-live.inc <scout|docs|both>}"
case "$scope" in
  scout | docs | both) ;;
  *) echo "engine-live: unknown scope '$scope'" >&2; exit 1 ;;
esac

root="$(git rev-parse --show-toplevel)"
cd "$root" || exit 1

if [ ! -f .env.provider ] || ! grep -q '^OPENCODE_API_KEY=.\+' .env.provider 2>/dev/null; then
  echo "engine-live: no provider key in .env.provider" >&2
  exit 77
fi

image="agency-dispatcher:1.0.0"
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "engine-live: building $image" >&2
  docker build -f dispatcher/Dockerfile -t "$image" \
    --build-arg "AGENT_UID=$(id -u)" \
    --build-arg "AGENT_GID=$(id -g)" \
    --build-arg "OPENCODE_VERSION=$(grep '^OPENCODE_VERSION=' versions.env | cut -d= -f2)" \
    . >&2 || exit 1
fi

if [ ! -d workspace/demo/repo ]; then
  bash scripts/workspace-init.sh demo --demo >&2 || exit 1
fi
mkdir -p state/registry/demo
for f in repo.yaml ownership.yaml checks.yaml; do
  [ -f "state/registry/demo/$f" ] || cp "registry.example/demo/$f" state/registry/demo/
done

out=$(make up 2>&1 | tail -2) || { echo "engine-live: make up failed: $out" >&2; exit 1; }
for c in agency-scout agency-docs agency-verifier; do
  healthy=""
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = "healthy" ] \
      && { healthy=1; break; }
    sleep 10
  done
  [ -n "$healthy" ] || { echo "engine-live: $c never healthy" >&2; exit 1; }
done

state_dir="/tmp/opencode/1c-live-$scope"
rm -rf "$state_dir"
mkdir -p "$state_dir"

volume="agency_artifacts"
docker volume inspect "$volume" >/dev/null 2>&1 || {
  echo "engine-live: volume $volume missing" >&2; exit 1;
}

# Forward only the variables the proof needs (never dump the environment).
# shellcheck disable=SC1091
set -a
# shellcheck source=/dev/null
source .env
set +a

container="agency-dispatcher-live-$scope"
docker rm -f "$container" >/dev/null 2>&1 || true
docker run --rm --name "$container" --network agency_fleet \
  -v "$root/workspace:/work:rw,z" \
  -v "$volume:/artifacts:z" \
  -v "$root/state/registry:/registry:ro,z" \
  -v "$state_dir:/data:z" \
  -e "ENGINE_LIVE_SCOPE=$scope" \
  -e ENGINE_LIVE_WORK=/work \
  -e ENGINE_LIVE_ARTIFACTS=/artifacts \
  -e ENGINE_LIVE_REGISTRY=/registry \
  -e ENGINE_LIVE_STATE=/data \
  -e "AGENCY_MODEL=$AGENCY_MODEL" \
  -e "PW_DIRECTOR=$PW_DIRECTOR" \
  -e "PW_SCOUT=$PW_SCOUT" \
  -e "PW_ARCHITECT=$PW_ARCHITECT" \
  -e "PW_PRODUCT=$PW_PRODUCT" \
  -e "PW_FRONTEND=$PW_FRONTEND" \
  -e "PW_BACKEND=$PW_BACKEND" \
  -e "PW_DBA=$PW_DBA" \
  -e "PW_PLATFORM=$PW_PLATFORM" \
  -e "PW_SECURITY=$PW_SECURITY" \
  -e "PW_QA=$PW_QA" \
  -e "PW_REVIEWER=$PW_REVIEWER" \
  -e "PW_DOCS=$PW_DOCS" \
  -e "VERIFIER_TOKEN=$VERIFIER_TOKEN" \
  "$image" \
  bun test ./dispatcher/test/live/engine.live.test.ts
code=$?
echo "engine-live: scope $scope exited $code; state at $state_dir" >&2
exit "$code"
