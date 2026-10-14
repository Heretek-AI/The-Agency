---
name: iac-plan-review
description: Review infrastructure plans line by line: what changes, what is destroyed, what drifts.
---

# IaC plan review

## When to use

Use before approving any infrastructure change. Plans are read, not
skimmed.

## Procedure

1. Run `terraform validate`, `tflint`, and the plan; read the full plan
   output.
2. Flag every destroy, every in-place replacement of stateful resources,
   and every drift from the last applied state.
3. Approve only when each flagged item has a written reason.

## Commands

- `terraform validate`
- `tflint --minimum-failure-severity=warning`
- `terraform plan -out=plan.bin`

## Good result

Each change itemized with its blast radius; destroys named, never
surprising.
