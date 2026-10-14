---
name: query-plan-review
description: Review query plans with EXPLAIN before approving indexes or query changes.
---

# Query plan review

## When to use

Use when a query is slow, new, or touched by a migration. Do not add
indexes on suspicion.

## Procedure

1. Run `EXPLAIN (ANALYZE, BUFFERS)` on the realistically-sized dataset.
2. Read the plan: sequential scans, nested loops over large sets, and
   misestimated rows are the suspects.
3. Propose the smallest index that fixes the plan and re-run to confirm.

## Good result

Before/after plans quoted; the new index is used and nothing else
regressed.
