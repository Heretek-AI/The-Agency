---
name: test-with-the-change
description: Ship tests with the change: failing first where possible, covering the new behavior and its errors.
---

# Test with the change

## When to use

Use for every behavior change. A change without its test is unfinished.

## Procedure

1. Write the test for the new behavior first; watch it fail for the
   right reason.
2. Implement, then cover the error paths the change introduces.
3. Run the focused suite and the neighboring suites before committing.

## Commands

- `bun test <file>`
- `pnpm test -- <name>`

## Good result

The new tests fail without the change and pass with it; neighbors stay
green.
