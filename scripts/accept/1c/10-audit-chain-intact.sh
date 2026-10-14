#!/usr/bin/env bash
# 10-audit-chain-intact: after the live runs, the live engine's audit log
# verifies and the landed commit's `Agency-Audit-Tip` is found in it.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
cd "$root" || fail "cannot cd to $root"

audit_dir="/tmp/opencode/1c-live-docs/audit"
[ -f "$audit_dir/audit.jsonl" ] \
  || fail "no live-docs audit log (run check 08 first): $audit_dir/audit.jsonl"

repo="$root/workspace/demo/repo"
[ -d "$repo" ] || fail "demo repo missing: $repo"
branch=$(git -C "$repo" for-each-ref --sort=-committerdate \
  --format='%(refname:short)' 'refs/heads/fleet/integration/m-live-docs-*' \
  | head -1) || fail "cannot list integration branches"
[ -n "$branch" ] || fail "no live-docs integration branch (run check 08 first)"
landed=$(git -C "$repo" rev-parse "$branch") || fail "cannot resolve $branch"
message=$(git -C "$repo" log -1 --format=%B "$landed") || fail "cannot read $landed"
tip=$(echo "$message" | grep -oE '^Agency-Audit-Tip: [0-9a-f]+' | awk '{print $2}' || true)
[ -n "$tip" ] || fail "landed commit $landed carries no Agency-Audit-Tip"

out=$(bun scripts/accept-helpers/audit-chain.ts "$audit_dir" "$tip" 2>&1) \
  || fail "audit chain check failed: $out"
echo "audit: $out; branch $branch at $landed"
pass
