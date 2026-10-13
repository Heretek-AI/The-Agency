---
name: component-implementation
description: Build a UI component following repo patterns, with colocated tests and verified rendering.
---

# Component implementation

## When to use

Use for new or changed UI. Match the repo's component shape before
inventing a new one.

## Procedure

1. Read two neighboring components for props, state, and styling
   conventions.
2. Implement the component with its loading, empty, and error states.
3. Add colocated tests for behavior and render it to check the output.

## Commands

- `pnpm test src/components/<name>.test.tsx`
- `bunx prettier --check src/components/<name>.tsx`

## Good result

The component behaves in all four states, tests cover them, and the diff
touches only the frontend roots.
