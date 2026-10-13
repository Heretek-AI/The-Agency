---
name: data-safety-checklist
description: Run the safety checklist before any migration lands: backup, reversibility, row counts.
---

# Data safety checklist

## When to use

Use before every migration, without exception.

## Procedure

1. Confirm a restorable backup exists and say where it is.
2. Confirm the down migration works (applied, not just written).
3. Sanity-check row counts before and after on the scratch run.

## Good result

All three boxes checked with evidence; anything unchecked blocks the
landing.
