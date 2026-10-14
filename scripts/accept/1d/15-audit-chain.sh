#!/usr/bin/env bash
# 15-audit-chain: the audit log verifies and every landed merge commit's
# audit tip is anchored in it. Branches with no merges yet (probes that
# never landed) are reported, not failed.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
require_cmd bun
require_cmd git
cd "$root" || fail "cannot cd to $root"

[ -f state/audit/audit.jsonl ] || fail "no production audit log (run check 02 first)"
out=$(bun scripts/accept-helpers/audit-chain.ts state/audit 2>&1) ||
  fail "audit chain broken: $out"
[ -d workspace/demo/repo ] || fail "workspace/demo/repo missing (run check 02 first)"
merges=0
branches=0
while IFS= read -r branch; do
  [ -n "$branch" ] || continue
  branches=$((branches + 1))
  while IFS= read -r commit; do
    [ -n "$commit" ] || continue
    tip=$(git -C workspace/demo/repo log -1 --format=%B "$commit" |
      grep -oE '^Agency-Audit-Tip: [0-9a-f]+' | awk '{print $2}' || true)
    [ -n "$tip" ] || fail "landed commit $commit on $branch carries no Agency-Audit-Tip"
    bun scripts/accept-helpers/audit-chain.ts state/audit "$tip" >/dev/null 2>&1 ||
      fail "tip $tip of $commit is not anchored in the audit chain"
    merges=$((merges + 1))
  done < <(git -C workspace/demo/repo log --merges --format=%H "$branch" 2>/dev/null)
done < <(git -C workspace/demo/repo for-each-ref --format='%(refname:short)' 'refs/heads/fleet/integration/*')
echo "audit: $out; $merges landed merge(s) anchored across $branches branch(es)" >&2
pass
