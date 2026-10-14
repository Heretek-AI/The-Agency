---
name: a11y-in-implementation
description: Build accessibility into the implementation: labels, focus, contrast, and keyboard paths, checked with axe.
---

# Accessibility in implementation

## When to use

Use for every user-facing change. Accessibility retrofits cost more than
building it in.

## Procedure

1. Label every control programmatically; keep a visible focus order that
   follows the visual order.
2. Check contrast for new color pairs and keep a keyboard path for every
   pointer action.
3. Run the axe CLI against the changed screens and fix violations before
   claiming done.

## Commands

- `axe https://localhost:3000/<page> --exit`

## Good result

No new axe violations; keyboard-only walkthrough reaches and operates
every changed control.
