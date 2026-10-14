---
name: frontend-state-conventions
description: Follow the repo's client-state conventions: where state lives, how it loads, and how errors surface.
---

# Frontend state conventions

## When to use

Use before adding state, fetching, or caching to a component. New
state machinery needs architect approval first.

## Procedure

1. Find where sibling components keep equivalent state (local, lifted, or
   shared) and do the same.
2. Keep loading and error states with the data, never in a distant
   wrapper the reader cannot see.
3. Reuse the repo's fetch and cache helpers instead of adding new ones.

## Good result

State lives where a reader expects it; no parallel fetching stacks, no
orphaned loading flags.
