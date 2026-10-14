---
name: test-strategy
description: Turn acceptance criteria into a test plan: what is covered, at which level, and what is deliberately not covered.
---

# Test strategy

## When to use

Use before writing tests for a task. A plan keeps unit, integration, and
e2e work from overlapping or leaving holes.

## Procedure

1. Map each acceptance criterion to a test level (unit for logic,
   integration for wiring, e2e for user-visible behavior).
2. Name what is deliberately not covered and why (cost, flakiness,
   covered elsewhere).
3. Write the failing tests first, then watch the implementation turn
   them green.

## Good result

Every criterion has a test at exactly one level; gaps are listed, not
accidental.
