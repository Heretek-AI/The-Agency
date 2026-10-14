#!/usr/bin/env bash
# Probe one expert's model round trip from inside its own container.
# Usage: scripts/probe-model.sh <expert> [prompt-text]
# Prints the assistant's reply text (redacted to 500 chars) and exits 0 on
# success. All credentials stay inside the container via its environment.
set -u
set -o pipefail
root="$(git rev-parse --show-toplevel)"
expert="${1:?usage: scripts/probe-model.sh <expert> [prompt-text]}"
prompt_text="${2:-Reply with exactly: probe-ok}"
cd "$root" || exit 1
docker compose exec -T "$expert" sh -s "$prompt_text" <<'SCRIPT'
text="$1"
base="http://127.0.0.1:4096"
auth="opencode:${OPENCODE_PASSWORD}"
sid=$(curl -fsS --noproxy '*' -u "$auth" -X POST "$base/api/session" \
  -H 'content-type: application/json' \
  -d '{"title":"model-probe","location":{"directory":"/work"}}' |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])') || exit 1
python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text" > /tmp/probe-body.json
curl -fsS --noproxy '*' -u "$auth" -X POST "$base/api/session/$sid/prompt" \
  -H 'content-type: application/json' -d @/tmp/probe-body.json > /dev/null || exit 1
rm -f /tmp/probe-body.json
curl -fsS --noproxy '*' -u "$auth" -X POST "$base/api/experimental/session/$sid/wait" \
  -o /dev/null || exit 1
curl -fsS --noproxy '*' -u "$auth" "$base/api/session/$sid/message" |
  python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["data"])[-1500:])'
SCRIPT
