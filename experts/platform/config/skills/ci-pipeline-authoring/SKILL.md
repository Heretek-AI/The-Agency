---
name: ci-pipeline-authoring
description: Author CI workflows that are pinned, minimal-permissioned, and linted with actionlint.
---

# CI pipeline authoring

## When to use

Use for new or changed automation. CI that cannot fail loudly is worse
than no CI.

## Procedure

1. Pin every action by SHA, grant only the permissions each job needs.
2. Keep jobs hermetic: explicit checkouts, locked installs, no ambient
   credentials.
3. Run `actionlint` and fix every finding.

## Commands

- `actionlint .github/workflows/<name>.yml`
- `yamllint .github/workflows/<name>.yml`

## Good result

actionlint clean, SHA-pinned actions, least-privilege permissions, and a
green dry run where the platform allows one.
