#!/usr/bin/env bash
# 03-only-gateway-published: the gateway is the only container with a
# host port binding, and it binds only 127.0.0.1.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
cd "$root" || fail "cannot cd to $root"

ids=$(docker compose ps -q 2>/dev/null) || fail "docker compose ps failed"
[ -n "$ids" ] || fail "project has no containers to inspect (run check 02 first)"
bad=""
gateway_ok=""
# shellcheck disable=SC2086
while IFS= read -r line; do
  name="${line%% *}"
  bindings="${line#* }"
  if [ "$bindings" = "null" ] || [ "$bindings" = "{}" ]; then
    continue
  fi
  case "$name" in
    *agency-gateway*)
      echo "$bindings" | grep -q '127.0.0.1' || bad="$bad $name(non-loopback:$bindings)"
      gateway_ok=1
      ;;
    *)
      bad="$bad $name($bindings)"
      ;;
  esac
done < <(docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' $ids)
[ -z "$bad" ] || fail "unexpected host port bindings:$bad"
[ -n "$gateway_ok" ] || fail "gateway publishes no host port"
port="$(rest_port)"
echo "gateway alone publishes 127.0.0.1:$port" >&2
pass
