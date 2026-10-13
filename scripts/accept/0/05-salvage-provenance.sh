#!/usr/bin/env bash
# 05-salvage-provenance: every destination in the build-notes salvage table
# exists, and every handled source exists at 14f297a in SALVAGE_SRC.
set -u
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
cd "$root" || fail "cannot cd to $root"

salvage_src="${SALVAGE_SRC:-$root/../Heretek-AI-opencode/rebuild_staging}"
# Inside a git worktree the donor checkout sits two levels higher.
[ -d "$salvage_src" ] || salvage_src="$root/../../../Heretek-AI-opencode/rebuild_staging"
[ -d "$salvage_src" ] || fail "SALVAGE_SRC missing: tried default and worktree-relative paths"
head=$(git -C "$salvage_src" rev-parse --short HEAD 2>/dev/null || true)
[ "$head" = "14f297a" ] || fail "SALVAGE_SRC is at ${head:-unknown}, want 14f297a"

sources=(
  packages/opencode-fleet/src/util/hash.ts
  packages/opencode-fleet/src/util/redact.ts
  packages/opencode-fleet/src/util/exec.ts
  packages/opencode-fleet/src/state/journal.ts
  packages/opencode-fleet/src/dag/graph.ts
  packages/opencode-fleet/src/lanes/worktree.ts
  packages/opencode-fleet/src/gates/runner.ts
  packages/opencode-fleet/src/judges/reports.ts
  packages/opencode-sdk/src/host/client.ts
  packages/opencode-sdk/test/host-live.test.ts
  packages/opencode-sdk/src/testkit/index.ts
)
for s in "${sources[@]}"; do
  git -C "$salvage_src" cat-file -e "14f297a:$s" 2>/dev/null || fail "source missing at 14f297a: $s"
done

# Destinations come from the salvage table, so the table must list them all.
table=$(awk '/^## Salvage/,/^## Spike/' docs/build-notes.md)
dests=$(echo "$table" | grep -o '`\(dispatcher\|verifier\|scripts\)/[^`]*`' | tr -d '`' | sort -u || true)
[ -n "$dests" ] || fail "salvage table in docs/build-notes.md lists no destinations"
while IFS= read -r d; do
  [ -f "$d" ] || fail "salvage destination missing: $d"
done <<<"$dests"

# Step 0 gate (stage prompt Step 0 Accept): branch plus Preflight fields.
# Folded into this check so the 01-10 numbering contract is preserved.
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
[ "$branch" = "stage-0-salvage" ] || fail "expected branch stage-0-salvage, on ${branch:-unknown}"
grep -q '^## Preflight' docs/build-notes.md || fail "docs/build-notes.md has no Preflight section"
for field in "Bun:" "Docker:" "SELinux:" "14f297a" "stage-0-salvage"; do
  grep -qF "$field" docs/build-notes.md || fail "docs/build-notes.md Preflight missing $field"
done

# Step 11 gate (stage prompt Step 11): the handoff note for a human exists
# and names the archive steps without running them.
note="docs/handoff/heretek-opencode-archive.md"
[ -f "$note" ] || fail "handoff note missing: $note"
grep -qi "human" "$note" || fail "handoff note does not mark its steps for a human"
grep -qF "gh repo archive" "$note" || fail "handoff note missing the archive command"

pass
