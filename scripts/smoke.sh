#!/usr/bin/env bash
# Smoke for The Agency experts (Stage 1b, Step 9). Checks every enabled
# expert and fails on the first expert that misses any item. Makes no model
# calls and never prints a secret: passwords travel inside curl only.
set -u

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "smoke: missing required command docker" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "smoke: missing required command python3" >&2; exit 1; }
[ -f .env ] || { echo "smoke: .env missing (run: make init)" >&2; exit 1; }

set -a
# shellcheck disable=SC1091
source .env
set +a
[ -n "${AGENT_UID:-}" ] || { echo "smoke: AGENT_UID is empty" >&2; exit 1; }

ROSTER="$(
  bun -e '
import { parse } from "yaml";
import { enabledExperts, FleetSchema } from "./dispatcher/src/fleet-schema.js";
const fleet = FleetSchema.parse(parse(await Bun.file("fleet.yaml").text()));
const out = {};
for (const name of enabledExperts(fleet)) {
  const e = fleet.experts[name];
  out[name] = { access: e.access, skills: e.skills, mcp: e.mcp };
}
console.log(JSON.stringify(out));
'
)" || { echo "smoke: cannot read fleet roster" >&2; exit 1; }

api() {
  # api <container> <password> <method> <path> -> body on stdout
  local container="$1" password="$2" method="$3" path="$4" code out
  if ! out=$(docker exec "$container" curl -sS --noproxy '*' -u "opencode:$password" -X "$method" \
    -w '\n%{http_code}' "http://127.0.0.1:4096$path"); then
    echo "smoke: curl failed for $method $path" >&2
    return 1
  fi
  code=$(echo "$out" | tail -1)
  echo "$out" | sed '$d'
  [ "$code" = "200" ] || [ "$code" = "201" ] || [ "$code" = "204" ] || {
    echo "smoke: unexpected status $code for $method $path" >&2
    return 1
  }
}

fail() {
  echo "smoke: expert $1: $2" >&2
  exit 1
}

[ "$(echo "$ROSTER" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")" -gt 0 ] \
  || {
    echo "smoke: roster holds no enabled experts" >&2
    exit 1
  }

for name in $(echo "$ROSTER" | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin)))"); do
  container="agency-$name"
  upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  pw_var="PW_$upper"
  pw="${!pw_var:-}"
  [ -n "$pw" ] || fail "$name" "password variable $pw_var is empty"
  if [ "$name" = "director" ]; then other_pw="${PW_BACKEND:-}"; else other_pw="${PW_DIRECTOR:-}"; fi

  [ "$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null)" = "healthy" ] \
    || fail "$name" "container not healthy"
  [ "$(docker exec "$container" id -u)" = "$AGENT_UID" ] \
    || fail "$name" "runs as uid $(docker exec "$container" id -u), want $AGENT_UID"

  agents="$(api "$container" "$pw" GET /api/agent)" || fail "$name" "/api/agent unreachable"
  echo "$agents" | python3 -c "import json,sys; assert '$name' in [a.get('id') for a in json.load(sys.stdin)['data']]" \
    || fail "$name" "/api/agent does not list persona $name"

  skills="$(api "$container" "$pw" GET /api/skill)" || fail "$name" "/api/skill unreachable"
  for skill in $(echo "$ROSTER" | python3 -c "import json,sys; print(' '.join(json.load(sys.stdin)['$name']['skills']))"); do
    echo "$skills" | python3 -c "import json,sys; assert '$skill' in [s.get('name') for s in json.load(sys.stdin)['data']]" \
      || fail "$name" "/api/skill does not list skill $skill"
  done

  settled=""
  for _ in $(seq 1 36); do
    mcps="$(api "$container" "$pw" GET /api/mcp)" || fail "$name" "/api/mcp unreachable"
    if echo "$mcps" | python3 -c "
import json,sys
for s in json.load(sys.stdin)['data']:
    st = s.get('status',{}).get('status') if isinstance(s.get('status'),dict) else s.get('status')
    if st in ('failed','needs_auth'):
        print('BAD', s.get('name'), st); sys.exit(2)
    if st not in ('connected','disabled'):
        sys.exit(1)
"; then
      settled="yes"
      break
    elif [ $? -eq 2 ]; then
      fail "$name" "/api/mcp shows a failed server"
    fi
    sleep 5
  done
  [ -n "$settled" ] || fail "$name" "/api/mcp never settled (pending after 3 minutes)"

  if docker logs "$container" 2>&1 | grep -q "configuration normalization diagnostic"; then
    fail "$name" "log contains a configuration normalization diagnostic"
  fi

  docker exec "$container" touch /etc/agency/smoke-probe 2>/dev/null \
    && fail "$name" "/etc/agency is writable"
  access=$(echo "$ROSTER" | python3 -c "import json,sys; print(json.load(sys.stdin)['$name']['access'])")
  if [ "$access" = "ro" ]; then
    docker exec "$container" touch /work/smoke-probe 2>/dev/null \
      && fail "$name" "ro expert can write /work"
  else
    docker exec "$container" touch /work/smoke-probe 2>/dev/null \
      || fail "$name" "scoped expert cannot write /work"
    docker exec "$container" rm -f /work/smoke-probe
  fi

  code=$(docker exec "$container" curl -sS --noproxy '*' -u "opencode:$pw" -o /dev/null \
    -w '%{http_code}' http://127.0.0.1:4096/api/info) || fail "$name" "own password probe failed"
  [ "$code" = "200" ] || fail "$name" "own password rejected (status $code)"
  code=$(docker exec "$container" curl -sS --noproxy '*' -u "opencode:$other_pw" -o /dev/null \
    -w '%{http_code}' http://127.0.0.1:4096/api/info) || fail "$name" "other password probe failed"
  [ "$code" = "401" ] || fail "$name" "another expert's password accepted (status $code)"

  echo "smoke: $name ok"
done

echo "smoke: all enabled experts healthy"
