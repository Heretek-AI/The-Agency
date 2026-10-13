---
name: sast-triage
description: Confirm reachability before reporting SAST findings; unreachable findings are not reported.
---

# SAST triage

## When to use

Use for every static-analysis finding. Scanner output is a suspect list,
not a report.

## Procedure

1. Reproduce the data flow: attacker-controlled source to sensitive sink,
   with the code path written out.
2. If the path is unreachable (dead code, validated earlier, impossible
   state), record it as dismissed with the reason.
3. Report only reachable findings, with the path quoted.

## Commands

- `semgrep --config auto <path>`
- `rg -n '<sink>' <path>`

## Good result

Every reported finding shows its path; dismissed ones show why; the
report contains no maybes.
