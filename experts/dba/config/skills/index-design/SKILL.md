---
name: index-design
description: Design the smallest index that fixes the plan, considering write cost and existing indexes.
---

# Index design

## When to use

Use after query-plan-review names the problem. Every index taxes writes.

## Procedure

1. List the existing indexes on the table; extend or replace before
   adding.
2. Order composite columns by selectivity and the query's equality-then-
   range shape.
3. Confirm use with `EXPLAIN` and note the write-cost tradeoff.

## Good result

One index, used by the plan, with its cost stated; no duplicate coverage.
