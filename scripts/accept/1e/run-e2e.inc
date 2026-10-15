#!/usr/bin/env bash
# run-e2e.inc: `make accept-ui` entrypoint. Builds nothing (the Makefile does
# that); boots one fresh seeded server and runs the whole Playwright suite
# serially against it. Each spec owns its missions, so one server serves the
# full run deterministically.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/_server.inc"
root="$(git rev-parse --show-toplevel)"
command -v bun >/dev/null 2>&1 || {
  echo "run-e2e: missing required command bun" >&2
  exit 1
}
start_1e_server || {
  echo "run-e2e: seeded server failed to start" >&2
  exit 1
}
trap 'stop_1e_server' EXIT
cd "$root/dispatcher/web" && ACCEPT_1E_URL="$ACCEPT_1E_URL" bunx playwright test
