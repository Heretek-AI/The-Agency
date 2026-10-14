#!/usr/bin/env bash
# Shared helpers for Stage 1d acceptance checks. Sourced, never executed
# directly (this file has no .sh suffix so accept.sh does not run it, and
# .prettierignore keeps Prettier from reflowing it). Every helper fails
# closed: transport errors, missing prerequisites, and missing keys return
# non-zero. Secrets are never printed.
[ -n "${REST_INC_LOADED:-}" ] && return 0
REST_INC_LOADED=1

rest_root() {
  git rev-parse --show-toplevel
}

rest_port() {
  local root port
  root="$(rest_root)"
  port=""
  if [ -f "$root/.env" ]; then
    port="$(grep '^AGENCY_HTTP_PORT=' "$root/.env" | cut -d= -f2)"
  fi
  printf '%s' "${port:-8081}"
}

rest_base() {
  printf 'http://127.0.0.1:%s' "$(rest_port)"
}

# Skip the check when no usable provider key is configured. Only checks
# 06-14 may call this (the stage prompt allows skips there and nowhere
# else). An empty value or the documented disabled-no-key marker (used so
# containers boot for infrastructure checks without a real key) both skip.
require_provider_key() {
  local root value
  root="$(rest_root)"
  value="$(grep '^OPENCODE_API_KEY=' "$root/.env.provider" 2>/dev/null | cut -d= -f2)"
  if [ -z "$value" ] || [ "$value" = "disabled-no-key" ]; then
    skip "no provider key in .env.provider"
  fi
}

# rest_login <user> <password> prints the session token. Fails when login
# does not return 200 with a token.
rest_login() {
  local user="$1" password="$2" base body token
  base="$(rest_base)"
  body=$(mktemp)
  printf '{"username":%s,"password":%s}' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$user")" \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$password")" >"$body"
  token=$(curl -fsS --noproxy '*' -m 20 -X POST "$base/api/auth/login" \
    -H 'content-type: application/json' --data-binary "@$body" 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])') || {
    rm -f "$body"
    return 1
  }
  rm -f "$body"
  printf '%s' "$token"
}

# rest_api <method> <path> <token> [data-file] prints the response body
# and sets REST_STATUS. Transport failures return 1; HTTP error statuses
# do not (the caller asserts on REST_STATUS).
rest_api() {
  local method="$1" path="$2" token="$3" data="${4:-}" base out
  base="$(rest_base)"
  if [ -n "$data" ]; then
    out=$(curl -sS --noproxy '*' -m 30 -X "$method" "$base$path" \
      -H "authorization: Bearer $token" -H 'content-type: application/json' \
      --data-binary "@$data" -w '\n%{http_code}') || return 1
  else
    out=$(curl -sS --noproxy '*' -m 30 -X "$method" "$base$path" \
      -H "authorization: Bearer $token" -w '\n%{http_code}') || return 1
  fi
  REST_STATUS="$(printf '%s' "$out" | tail -1)"
  printf '%s' "$out" | sed '$d'
}

# rest_mcp <tool> <json-args> prints the raw JSON-RPC response. Fails on
# transport errors only; tool-level failures are in the JSON body.
rest_mcp() {
  local tool="$1" args="$2" root mcptoken base envelope
  root="$(rest_root)"
  mcptoken="$(grep '^FLEET_MCP_TOKEN=' "$root/.env" | cut -d= -f2)"
  [ -n "$mcptoken" ] || return 1
  base="$(rest_base)"
  envelope=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%s,"arguments":%s}}' \
    "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$tool")" "$args")
  curl -fsS --noproxy '*' -m 60 -X POST "$base/mcp" \
    -H "authorization: Bearer $mcptoken" -H 'content-type: application/json' \
    -d "$envelope" 2>/dev/null
}

# mcp_text <tool> <json-args> prints the tool text payload and returns 1
# when the tool reports isError.
mcp_text() {
  local resp
  resp=$(rest_mcp "$1" "$2") || return 1
  python3 -c '
import json,sys
body = json.load(sys.stdin)
result = body.get("result", {})
texts = [c.get("text", "") for c in result.get("content", [])]
sys.stdout.write("\n".join(texts))
if result.get("isError"):
    sys.exit(3)
' <<<"$resp"
}

# wait_for_mission <mission-id> <token> <timeout-sec> polls until the
# mission is terminal. Prints the final status. Fails on timeout.
wait_for_mission() {
  local id="$1" token="$2" timeout="$3" start now status body
  start=$(date +%s)
  while true; do
    body=$(rest_api GET "/api/missions/$id" "$token") || return 1
    status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["mission"]["status"])' <<<"$body") ||
      return 1
    case "$status" in
      done | failed | cancelled)
        printf '%s' "$status"
        return 0
        ;;
    esac
    now=$(date +%s)
    if [ $((now - start)) -ge "$timeout" ]; then
      echo "timed out waiting for mission $id (last status $status)" >&2
      return 1
    fi
    sleep 15
  done
}

# container_health <name> prints the docker health status (or "absent").
container_health() {
  docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null || printf 'absent'
}
