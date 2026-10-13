---
name: secret-exposure-procedure
description: Handle suspected secret exposure: confirm, contain, rotate, and record, without spreading the secret.
---

# Secret exposure procedure

## When to use

Use the moment a secret may have leaked into code, logs, artifacts, or
chat. Speed matters; panic does not.

## Procedure

1. Confirm with `gitleaks` without quoting the secret value anywhere.
2. Contain: remove the exposure from the tree and every copy you
   control; never paste the value into reports or chat.
3. Rotate the secret and record the rotation, not the value.

## Commands

- `gitleaks detect --source . -v`

## Good result

Exposure removed, secret rotated, report describes the leak and the fix
without ever containing the value.
