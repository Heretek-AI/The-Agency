---
name: dependency-addition-policy
description: Justify each new dependency with need, alternatives, maintenance, and exact pinning.
---

# Dependency addition policy

## When to use

Use before adding any dependency. The cheapest dependency is the one not
added.

## Procedure

1. Show the need cannot be met with what is already installed.
2. Compare two alternatives on maintenance (releases, issues, bus
   factor) and record the comparison.
3. Pin the exact version in the manifest and lockfile; no ranges, no
   `latest`.

## Good result

The manifest diff has one entry with a recorded reason; `install` is
reproducible from the lockfile.
