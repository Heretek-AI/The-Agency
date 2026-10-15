#!/usr/bin/env bash
# Shared helper for Stage 1e acceptance checks: build the web bundle once and
# boot a fresh seeded Dispatcher + UI server per check. Sourced, not executed.
# Requires: bun, git, curl. Sets ACCEPT_1E_URL.
# shellcheck disable=SC2317
_1e_server_pid=""
_1e_server_log=""

start_1e_server() {
  local root port log
  root="$(git rev-parse --show-toplevel)"
  port="${ACCEPT_1E_PORT:-4101}"
  log="$(mktemp -t accept-1e-server-XXXXXX.log)"
  _1e_server_log="$log"
  export ACCEPT_1E_URL="http://127.0.0.1:${port}"
  ACCEPT_1E_PORT="$port" bun "$root/scripts/accept/1e/test-server.ts" >"$log" 2>&1 &
  _1e_server_pid=$!
  local deadline=$((SECONDS + 90))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -fs -o /dev/null "$ACCEPT_1E_URL/" 2>/dev/null; then
      return 0
    fi
    if ! kill -0 "$_1e_server_pid" 2>/dev/null; then
      echo "1e server died during startup; log:" >&2
      cat "$log" >&2
      return 1
    fi
    sleep 2
  done
  echo "1e server did not become ready in 90s; log:" >&2
  cat "$log" >&2
  return 1
}

stop_1e_server() {
  if [ -n "${_1e_server_pid:-}" ]; then
    kill "$_1e_server_pid" 2>/dev/null || true
    wait "$_1e_server_pid" 2>/dev/null || true
    _1e_server_pid=""
  fi
  pkill -f "accept/1e/test-server.ts" 2>/dev/null || true
}
