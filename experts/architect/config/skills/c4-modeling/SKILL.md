---
name: c4-modeling
description: Draw the system at context, container, and component level before discussing internals.
---

# C4 modeling

## When to use

Use when a design discussion keeps sliding between levels of abstraction.
Stop at the level that answers the question.

## Procedure

1. Context: the system, its users, and the external systems it talks to.
2. Containers: the deployable services and stores, and the protocols
   between them.
3. Components only for the container under design: responsibilities and
   interfaces, no code.

## Good result

One diagram per level, each box named with its responsibility; the design
question is answerable at exactly one level.
