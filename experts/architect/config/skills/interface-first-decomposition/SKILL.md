---
name: interface-first-decomposition
description: Break large work into components by defining their interfaces and data flow before any internals.
---

# Interface-first decomposition

## When to use

Use when a task spans more than one component or more than one expert.
Small tasks do not need this ceremony.

## Procedure

1. Name the components and draw the data flow between them.
2. Write each interface: operations, shapes, and error behavior.
3. Check each interface against its callers (one realistic flow walked
   end to end) before approving implementation.

## Good result

Builders can work in parallel on the interfaces; integration surprises
show up on paper, not at merge time.
