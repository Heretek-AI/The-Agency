#!/usr/bin/env bash
# Agency base-image entrypoint (Stage 1a, Step 1).
# 1. Refuse to start when a credential is empty (fail-closed, exit 64).
# 2. Set the git identity for this expert.
# 3. Disable MCP servers whose required variables are unset, via an
#    OPENCODE_CONFIG_CONTENT overlay that carries each disabled server's
#    complete config (a later config document replaces a server entry whole).
#    A malformed requirements file refuses to start instead of serving
#    with servers that should have been disabled.
# 4. Apply the fallbacks recorded under "Fallbacks in force" (none yet).
# 5. Serve OpenCode.
set -u

if [ -z "${OPENCODE_PASSWORD:-}" ]; then
  echo "entrypoint: refusing to start: OPENCODE_PASSWORD is empty" >&2
  exit 64
fi
if [ -z "${OPENCODE_API_KEY:-}" ]; then
  echo "entrypoint: refusing to start: OPENCODE_API_KEY is empty" >&2
  exit 64
fi

expert="${AGENCY_EXPERT:-agent}"
git config --global user.name "$expert (The Agency)"
git config --global user.email "$expert@agency.invalid"

# Fleet config is mounted read-only at /etc/agency; make it the global
# config directory unless the caller chose otherwise.
: "${OPENCODE_CONFIG_DIR:=/etc/agency}"
export OPENCODE_CONFIG_DIR

# MCP overlay: /etc/agency/mcp-requirements.json maps each server to its
# required variables plus its complete config. Servers with unmet
# requirements are republished here with "disabled": true. A malformed
# requirements file is a configuration error: refuse to start rather than
# serve with servers that should have been disabled.
req_file="/etc/agency/mcp-requirements.json"
if [ -f "$req_file" ]; then
  if ! overlay=$(python3 - "$req_file" <<'PY'
import json, os, sys
with open(sys.argv[1]) as fh:
    req = json.load(fh)
disabled = {}
for name, entry in req.get("mcpServers", {}).items():
    requires = entry.get("requires", [])
    if all(os.environ.get(var) for var in requires):
        continue
    config = dict(entry.get("config", {}))
    config["disabled"] = True
    disabled[name] = config
if disabled:
    print(json.dumps({"mcp": {"servers": disabled}}))
PY
  ); then
    echo "entrypoint: refusing to start: cannot read MCP requirements from $req_file" >&2
    exit 64
  fi
  if [ -n "$overlay" ]; then
    export OPENCODE_CONFIG_CONTENT="$overlay"
  fi
fi

# Fallbacks in force (docs/build-notes.md): Q6 (keep salvaged client) and
# Q8 (probe-on-timer) are Dispatcher-side and need no entrypoint switch;
# no entrypoint fallback is in force in Stage 1a.

exec opencode serve --hostname 0.0.0.0 --port 4096
