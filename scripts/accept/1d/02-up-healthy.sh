#!/usr/bin/env bash
# 02-up-healthy: twelve experts, proxy, verifier, Dispatcher, and gateway
# are healthy; the gateway answers through agency.localhost routing and
# the Director's debug UI is reachable behind its own host.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
# shellcheck disable=SC1091
source "$(dirname "$0")/rest.inc"
root="$(git rev-parse --show-toplevel)"
require_cmd docker
require_cmd bun
require_cmd python3
cd "$root" || fail "cannot cd to $root"

[ -f .env ] || fail "no .env (run: make init)"
model="$(grep '^AGENCY_MODEL=' .env | cut -d= -f2)"
[ -n "$model" ] || fail "AGENCY_MODEL is empty in .env"
pw_director="$(grep '^PW_DIRECTOR=' .env | cut -d= -f2)"
[ -n "$pw_director" ] || fail "PW_DIRECTOR is empty in .env"

[ -d workspace/demo/repo ] || bash scripts/workspace-init.sh demo --demo >&2 ||
  fail "workspace-init demo failed"
mkdir -p state/registry/demo
for f in repo.yaml ownership.yaml checks.yaml; do
  [ -f "state/registry/demo/$f" ] || cp "registry.example/demo/$f" state/registry/demo/ ||
    fail "cannot seed state/registry/demo/$f"
done
[ -f state/registry/allowlist.yaml ] || fail "state/registry/allowlist.yaml missing (run: make init)"

out=$(docker compose build dispatcher 2>&1 | tail -2) || fail "dispatcher build failed: $out"
out=$(docker compose pull gateway 2>&1 | tail -2) || fail "gateway pull failed: $out"
out=$(make up 2>&1 | tail -3) || fail "make up failed: $out"

containers="agency-director agency-scout agency-architect agency-product agency-frontend agency-backend agency-dba agency-platform agency-security agency-qa agency-reviewer agency-docs agency-egress agency-verifier agency-dispatcher agency-gateway"
unhealthy=""
for _ in $(seq 1 90); do
  unhealthy=""
  for c in $containers; do
    [ "$(container_health "$c")" = "healthy" ] || unhealthy="$unhealthy $c"
  done
  [ -z "$unhealthy" ] && break
  sleep 10
done
[ -z "$unhealthy" ] || fail "never healthy:$unhealthy"

# The Director's fleet MCP server needs its token inside the container.
[ -n "$(docker exec agency-director printenv FLEET_MCP_TOKEN 2>/dev/null)" ] ||
  fail "director container holds no FLEET_MCP_TOKEN"

port="$(rest_port)"
base="http://127.0.0.1:$port"
code=$(curl -sS --noproxy '*' -m 20 -o /dev/null -w '%{http_code}' \
  "$base/healthz" -H "Host: agency.localhost") || fail "gateway healthz unreachable"
[ "$code" = "200" ] || fail "gateway healthz returned $code"
body=$(curl -sS --noproxy '*' -m 20 "$base/healthz" \
  -H "Host: agency.localhost") || fail "gateway healthz body unreadable"
echo "$body" | grep -q '"ok":true' || fail "gateway healthz not healthy: $body"

code=$(curl -sS --noproxy '*' -m 20 -o /dev/null -w '%{http_code}' \
  "$base/api/info" -H "Host: director.agency.localhost" -u "opencode:$pw_director") ||
  fail "director debug UI unreachable through the gateway"
[ "$code" = "200" ] || fail "director debug UI returned $code"
pass
