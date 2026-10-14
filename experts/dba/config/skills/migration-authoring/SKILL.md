---
name: migration-authoring
description: Write reversible migrations, expand-then-contract, proven up and down on a scratch database.
---

# Migration authoring

## When to use

Use for every schema change. Irreversible migrations need a
recorded way back before they land.

## Procedure

1. Write the expand step (new tables, columns, or indexes) without
   touching the old shape.
2. Migrate reads, then writes, then contract the old shape in a separate
   step.
3. Apply up and down on a scratch database and keep the logs.

## Commands

- `psql "$DATABASE_URL" -f migrations/<n>_up.sql`
- `psql "$DATABASE_URL" -f migrations/<n>_down.sql`

## Good result

Up and down both apply cleanly; the application works at every
intermediate step.
