---
name: error-handling-conventions
description: Handle errors the repo's way: typed errors, stable codes, no swallowed failures, no secret leakage.
---

# Error handling conventions

## When to use

Use in every handler and integration you touch. Match the file's neighbors
before reaching for a new pattern.

## Procedure

1. Use the repo's error type with a stable machine-readable code.
2. Never swallow: log with context or return, and assert the path in a
   test.
3. Scrub secrets and personal data from messages, logs, and responses.

## Good result

Every failure path logs once with context, returns a documented code, and
leaks nothing sensitive.
