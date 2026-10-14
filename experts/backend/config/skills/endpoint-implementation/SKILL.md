---
name: endpoint-implementation
description: Implement an endpoint with validation, typed errors, logging, and a hurl-proven request.
---

# Endpoint implementation

## When to use

Use for new or changed server behavior. Check with dba first when the
shape of stored data changes.

## Procedure

1. Validate input at the boundary; reject unknown fields rather than
   ignoring them.
2. Return typed errors with stable codes and log with request context.
3. Write a hurl file proving the happy path and one failure path, and run
   it against the running service.

## Commands

- `hurl --test tests/api/<name>.hurl`
- `http POST :3000/<path> field=value`

## Good result

Both hurl runs green; logs show the request id; unknown fields get a 400,
not a silent pass.
