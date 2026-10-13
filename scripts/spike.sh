#!/usr/bin/env bash
# Spike session-flow runner (Stage 1a, Step 2).
# From a clean state: starts one container from the base image (builds
# nothing), then with curl exercises /api/info, /openapi.json, session
# create (with a per-task `permissions` array), a permission request that is
# listed and then rejected, prompt, wait, messages, and diff. Tears the
# container down by name on exit, including on failure. Exits non-zero on
# the first unexpected response; there is no tolerant path.
#
# Requires a provider key in .env.provider (fail-closed otherwise); the
# acceptance check maps a missing key to SKIP, this script never does.
#
# The permission sub-flow uses the real route
# POST /api/session/{id}/permission (operationId session.permission.create,
# review/opencode/packages/protocol/openapi.json). The spike session carries
# one probe rule with effect "ask" so the request pends; every other action
# resolves through the deny-all baseline. Nothing here fabricates server
# state: the id comes from the POST response and the listing is asserted.
set -u

NAME="agency-spike"
ROOT="$(git rev-parse --show-toplevel)"
TAG="$(grep '^OPENCODE_VERSION=' "$ROOT/versions.env" | cut -d= -f2)"
IMAGE="agency-base:$TAG"
WORK=""

cleanup() {
  # Cleanup-trap rm is explicitly allowed to tolerate failure; everything
  # under test below fails closed instead.
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "spike: missing required command $1" >&2
    exit 1
  }
}
need docker
need git
need curl
need python3

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "spike: missing image $IMAGE (run: make build-base)" >&2
  exit 1
fi

key=$(sed -n 's/^OPENCODE_API_KEY=//p' "$ROOT/.env.provider" 2>/dev/null | head -1 | sed 's/[[:space:]]*#.*//;s/^[[:space:]]*//;s/[[:space:]]*$//')
if [ -z "$key" ]; then
  echo "spike: no provider key (.env.provider with non-empty OPENCODE_API_KEY)" >&2
  exit 1
fi
pw=$(python3 -c "import secrets; print(secrets.token_urlsafe(18))")

# Throwaway git repository with a worktree as the workspace.
WORK=$(mktemp -d)
git init -q "$WORK/demo-repo"
git -C "$WORK/demo-repo" -c user.name=spike -c user.email=spike@agency.invalid commit -q --allow-empty -m seed
git -C "$WORK/demo-repo" -c user.name=spike -c user.email=spike@agency.invalid worktree add -q "$WORK/trees/t1" -b fleet/t1
echo "spike seed" >"$WORK/trees/t1/notes.txt"
printf '# Demo repo\n\nSPIKE_AGENTS_MARKER=repo-instructions-here\n' >"$WORK/trees/t1/AGENTS.md"
git -C "$WORK/trees/t1" -c user.name=spike -c user.email=spike@agency.invalid add -A
git -C "$WORK/trees/t1" -c user.name=spike -c user.email=spike@agency.invalid commit -q -m seed

docker rm -f "$NAME" >/dev/null 2>&1
rm_rc=$?
if [ "$rm_rc" -ne 0 ] && docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "spike: stale container $NAME could not be removed" >&2
  exit 1
fi
docker run -d --name "$NAME" \
  -e "OPENCODE_PASSWORD=$pw" \
  -e "OPENCODE_API_KEY=$key" \
  -e AGENCY_EXPERT=spike \
  -e OPENCODE_CONFIG_DIR=/etc/agency \
  -v "$ROOT/spike/config:/etc/agency:ro,z" \
  -v "$WORK:/work:z" \
  "$IMAGE" >/dev/null

# Wait until healthy (fail-closed on timeout).
healthy=""
for _ in $(seq 1 24); do
  healthy=$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo "unknown")
  if [ "$healthy" = "healthy" ]; then
    break
  fi
  sleep 5
done
if [ "$healthy" != "healthy" ]; then
  echo "spike: container never became healthy (status=$healthy)" >&2
  docker logs "$NAME" 2>&1 | tail -5 >&2
  exit 1
fi

# Every API call below goes through this helper: unexpected status fails.
api() {
  # api <method> <path> [body] -> response body on stdout
  local method="$1" path="$2" body="${3:-}"
  local code out
  if [ -n "$body" ]; then
    if ! out=$(docker exec "$NAME" curl -sS --noproxy '*' -u "opencode:$pw" -X "$method" \
      -H 'Content-Type: application/json' --data "$body" -w '\n%{http_code}' \
      "http://127.0.0.1:4096$path"); then
      echo "spike: curl failed for $method $path" >&2
      exit 1
    fi
  else
    if ! out=$(docker exec "$NAME" curl -sS --noproxy '*' -u "opencode:$pw" -X "$method" \
      -w '\n%{http_code}' "http://127.0.0.1:4096$path"); then
      echo "spike: curl failed for $method $path" >&2
      exit 1
    fi
  fi
  code=$(echo "$out" | tail -1)
  echo "$out" | sed '$d'
  if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "204" ]; then
    echo "spike: unexpected status $code for $method $path" >&2
    exit 1
  fi
}

info=$(api GET /api/info)
echo "$info" | grep -q '"version"' || {
  echo "spike: /api/info has no version field" >&2
  exit 1
}

api GET /openapi.json >"$WORK/openapi.json"
grep -q '"/api/session"' "$WORK/openapi.json" || {
  echo "spike: /openapi.json missing session paths" >&2
  exit 1
}

# The session carries one probe rule with effect "ask" (evaluated after the
# agent's baseline rules) so the permission request below pends instead of
# resolving to allow or deny.
session=$(api POST /api/session '{"title":"spike","agent":"spike","location":{"directory":"/work/trees/t1"},"permissions":[{"action":"edit","resource":"notes.txt","effect":"allow"},{"action":"spikeprobe","resource":"*","effect":"ask"}],"metadata":{"spike":"1a"}}')
sid=$(echo "$session" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])") || {
  echo "spike: could not parse session id" >&2
  exit 1
}

# A permission request through the real create route: it must resolve to
# "ask" (pending), be listed, then be rejected and disappear from the list.
preq=$(api POST "/api/session/$sid/permission" '{"action":"spikeprobe","resources":["probe-1"]}')
echo "$preq" | grep -q '"effect":"ask"' || {
  echo "spike: permission request did not resolve to ask: $preq" >&2
  exit 1
}
rid=$(echo "$preq" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['id'])") || {
  echo "spike: could not parse permission request id" >&2
  exit 1
}
pending=$(api GET "/api/session/$sid/permission")
echo "$pending" | grep -q "$rid" || {
  echo "spike: permission request $rid not listed" >&2
  exit 1
}
api POST "/api/session/$sid/permission/$rid/reply" '{"decision":"reject","message":"spike rejects"}' >/dev/null
pending_after=$(api GET "/api/session/$sid/permission")
if echo "$pending_after" | grep -q "$rid"; then
  echo "spike: rejected permission request $rid still listed" >&2
  exit 1
fi

# The model run: edit the granted file, then echo a marker.
api POST "/api/session/$sid/prompt" '{"text":"Append exactly the line spike-ok to notes.txt in your session directory using the edit tool, then run `echo spike-shell-ok` with the shell tool. End with a ## RESULT fenced JSON block {\"status\":\"done\",\"summary\":\"spike edit and shell\"}."}' >/dev/null

code=$(docker exec "$NAME" curl -sS --noproxy '*' -u "opencode:$pw" -X POST \
  -o /dev/null -w '%{http_code}' --max-time 600 \
  "http://127.0.0.1:4096/api/experimental/session/$sid/wait")
if [ "$code" != "204" ]; then
  echo "spike: wait returned $code, want 204" >&2
  exit 1
fi

messages=$(api GET "/api/session/$sid/message")
echo "$messages" | grep -q "spike-shell-ok" || {
  echo "spike: model output missing shell marker" >&2
  exit 1
}
echo "$messages" | grep -q "## RESULT" || {
  echo "spike: model output missing RESULT block" >&2
  exit 1
}

diff=$(api GET "/api/session/$sid/diff")
echo "$diff" | grep -q "notes.txt" || {
  echo "spike: session diff missing notes.txt" >&2
  exit 1
}

echo "SPIKE PASS session=$sid"
exit 0
