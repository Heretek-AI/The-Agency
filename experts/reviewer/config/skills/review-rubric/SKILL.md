---
name: review-rubric
description: Judge diffs on correctness, regressions, maintainability, test adequacy, and conventions, in that order.
---

# Review rubric

## When to use

Use for every review. Score the code, not the author.

## Procedure

1. Correctness: does the code do what the brief says, including edge
   cases?
2. Regressions: what neighboring behavior could this break, and do tests
   cover it?
3. Maintainability and conventions: would the repo's own patterns accept
   this?
4. Test adequacy last: do the tests prove the first three?

## Good result

Findings ordered by the rubric, each anchored to a line; approval means
all four hold.
