---
name: e2e-authoring
description: Write deterministic end-to-end tests with isolated state, explicit waits, and Playwright traces on failure.
---

# E2E authoring

## When to use

Use for user-visible behavior across the stack. Keep e2e suites small:
they are the slowest tests in the repo.

## Procedure

1. Isolate state per test (fresh fixtures, cleanup after).
2. Wait for conditions, never for fixed sleeps.
3. Capture traces or screenshots on failure into `/artifacts/<taskId>/`.

## Commands

- `pnpm exec playwright test e2e/<name>.spec.ts`
- `pnpm exec playwright show-trace /artifacts/<taskId>/trace.zip`

## Good result

Green three runs in a row counts as stable; failures carry traces that
reproduce the break.
