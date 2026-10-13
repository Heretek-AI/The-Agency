---
name: reference-from-source
description: Generate reference prose from the source code, never from memory, and re-check it when the source changes.
---

# Reference from source

## When to use

Use for API references, CLIs, and configuration docs. Memory drifts; the
source does not.

## Procedure

1. Read the implementation (flags, defaults, shapes) and quote it.
2. Write each entry with its default, its constraints, and one example.
3. Diff the docs against the source again before finishing.

## Good result

Every documented flag, field, and default matches the code; examples run
as written.
