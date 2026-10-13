---
name: adr-writing
description: Record a significant decision as an ADR with context, options, decision, and consequences.
---

# ADR writing

## When to use

Use when a decision constrains future work (boundaries, contracts,
technology, data shape). Do not write ADRs for routine implementation
choices.

## Procedure

1. State the context and the forces in tension (two to four sentences).
2. List the serious options with their costs, not just the winner.
3. Record the decision and its consequences, including what becomes
   harder and how to revisit it.

## Good result

A reader six months later understands what was decided, why, and what
would overturn it; the file lives under `docs/adr/`.
