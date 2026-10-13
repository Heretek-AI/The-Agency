---
name: coverage-gap-analysis
description: Measure coverage gaps and close the ones that hide risk, rather than chasing a percentage.
---

# Coverage gap analysis

## When to use

Use after the suites run green. Coverage is a map of untested code, not
a grade.

## Procedure

1. Generate the coverage report and list the uncovered lines in changed
   code.
2. Judge each gap: error paths and branching logic get tests; generated
   or trivial code gets a written pass.
3. Add the tests and re-run.

## Good result

Changed code's risky lines covered; deliberate passes listed with
reasons.
