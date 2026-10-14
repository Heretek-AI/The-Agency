#!/usr/bin/env bash
# 06-director-scout: through the Director API, asking scout for the
# repository languages creates a mission, a task, and an accurate reply.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
require_cmd curl
require_cmd python3
require_provider_key
cd "$root" || fail "cannot cd to $root"

for c in agency-director agency-scout agency-dispatcher agency-gateway; do
  [ "$(container_health "$c")" = "healthy" ] || fail "$c is not healthy (run check 02 first)"
done
[ -f .env ] || fail "no .env (run: make init)"
[ -f secrets/allowlist.env ] || fail "no operator passwords (run: make init)"

# Credentials travel inside curl only, never into logs.
set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source secrets/allowlist.env
set +a
[ -n "${PW_DIRECTOR:-}" ] || fail "PW_DIRECTOR is empty in .env"

port="$(rest_port)"
base="http://127.0.0.1:$port"
dhost=(-H "Host: director.agency.localhost")
auth=("opencode:$PW_DIRECTOR")

approver_token=$(rest_login approver "$AGENCY_APPROVER_PASSWORD") ||
  fail "approver login failed"
before=$(rest_api GET "/api/missions" "$approver_token" | python3 -c '
import json,sys
print(" ".join(m["id"] for m in json.load(sys.stdin)["missions"]))') ||
  fail "cannot list missions before the probe"

session=$(curl -fsS --noproxy '*' -m 20 -u "${auth[0]}" -X POST "$base/api/session" \
  "${dhost[@]}" -H 'content-type: application/json' \
  -d '{"agent":"director","location":{"directory":"/work/demo/repo"}}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])') ||
  fail "cannot create a director session"
cleanup_session() {
  curl -fsS --noproxy '*' -m 20 -u "${auth[0]}" -X DELETE "$base/api/session/$session" \
    "${dhost[@]}" >/dev/null 2>&1 || echo "06: warning: director session $session left behind" >&2
}

prompt_text="Live acceptance probe. Use your fleet tools in order: 1) fleet_mission_create with objective 'Report the programming languages used in the demo repository'. 2) fleet_plan_submit with one scout task (key lang-recon, paths [], acceptance ['languages listed with evidence']). 3) fleet_wait for the mission. 4) Reply with the mission id and the languages found."
prompt_body=$(mktemp)
python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$prompt_text" >"$prompt_body"
curl -fsS --noproxy '*' -m 30 -u "${auth[0]}" -X POST "$base/api/session/$session/prompt" \
  "${dhost[@]}" -H 'content-type: application/json' --data-binary "@$prompt_body" >/dev/null ||
  { rm -f "$prompt_body"; cleanup_session; fail "director prompt refused"; }
rm -f "$prompt_body"

mission=""
for _ in $(seq 1 60); do
  after=$(rest_api GET "/api/missions" "$approver_token" | python3 -c '
import json,sys
print(" ".join(m["id"] for m in json.load(sys.stdin)["missions"]))') ||
    { cleanup_session; fail "cannot list missions during the probe"; }
  for id in $after; do
    case " $before " in
      *" $id "*) ;;
      *) mission="$id" ;;
    esac
  done
  [ -n "$mission" ] && break
  sleep 20
done
[ -n "$mission" ] || { cleanup_session; fail "director created no mission within 20 minutes"; }

final=$(wait_for_mission "$mission" "$approver_token" 1200) ||
  { cleanup_session; fail "mission $mission never reached a terminal state"; }
[ "$final" = "done" ] || { cleanup_session; fail "mission $mission ended $final, want done"; }

tasks=$(rest_api GET "/api/missions/$mission" "$approver_token" | python3 -c '
import json,sys
tasks = json.load(sys.stdin)["tasks"]
print(" ".join(f"{t[\"id\"]}:{t[\"status\"]}:{t.get(\"expert\") or \"-\"}" for t in tasks))') ||
  { cleanup_session; fail "cannot read mission $mission"; }
echo "$tasks" | grep -q "lang-recon:done:scout" ||
  { cleanup_session; fail "no done scout task in $mission (tasks: $tasks)"; }

reply=""
for _ in $(seq 1 30); do
  reply=$(curl -fsS --noproxy '*' -m 20 -u "${auth[0]}" \
    "$base/api/session/$session/message" "${dhost[@]}" 2>/dev/null |
    python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))') || reply=""
  if echo "$reply" | grep -qi "typescript"; then
    break
  fi
  sleep 20
done
echo "$reply" | grep -qi "typescript" ||
  { cleanup_session; fail "director reply never named TypeScript"; }
echo "$reply" | grep -q "$mission" ||
  { cleanup_session; fail "director reply never named mission $mission"; }
cleanup_session
pass
