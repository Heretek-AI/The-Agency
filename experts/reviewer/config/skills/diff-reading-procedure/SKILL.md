---
name: diff-reading-procedure
description: Read the whole changed function, then its callers, then the tests, before judging a diff.
---

# Diff reading procedure

## When to use

Use for every review. Judging hunks in isolation misses the breakage.

## Procedure

1. Read each changed function whole, not just the changed lines.
2. Read the callers: who passes what, who depends on the old behavior.
3. Read the tests for the changed area and name a regression they would
   miss, if you can.

## Commands

- `git diff --stat`
- `git diff -U10 -- <file>`

## Good result

No finding surprises the author with context they had and you skipped;
the named-missed regression is either covered or filed.
