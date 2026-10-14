---
name: security-report-format
description: Write severity-ranked security reports plus SARIF, with evidence and suggested patches.
---

# Security report format

## When to use

Use for every security review. Findings without evidence are opinions.

## Procedure

1. Rank each finding blocker, major, or minor with `file:line` and the
   scanner output quoted.
2. Suggest a concrete patch per finding for the owning expert.
3. Emit SARIF alongside the human-readable report under
   `/artifacts/<taskId>/`.

## Good result

The owner can fix every finding from the report alone; the SARIF loads in
standard viewers without errors.
