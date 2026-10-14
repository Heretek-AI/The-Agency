---
name: flake-triage
description: Triage flaky tests by quarantining with a written reason, then fixing the nondeterminism at its source.
---

# Flake triage

## When to use

Use when a test passes and fails without code changes. Deleting a flaky
test deletes its coverage.

## Procedure

1. Quarantine the test with the failure signature and the suspected
   cause written down.
2. Find the nondeterminism (time, ordering, shared state, real network)
   and remove it.
3. Re-run the suite repeatedly before un-quarantining.

## Commands

- `pnpm test -- --repeat-each=10 <file>`

## Good result

The test is deterministic again with the cause documented, or it stays
quarantined with an owner and a date.
