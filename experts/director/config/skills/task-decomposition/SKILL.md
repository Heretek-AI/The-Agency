---
name: task-decomposition
description: Slice a mission into tasks by owner and write path, each with one expert, a small file set, and explicit dependencies.
---

# Task decomposition

## When to use

Use when turning an approved objective into a task plan. Do not use for
single-file fixes that one expert can own outright.

## Procedure

1. List the repository areas the objective touches (`git status`, `git log
   --oneline -10`, and the ownership map).
2. Slice by owner and write path: one task per expert, each with the
   smallest file set that stands alone.
3. Order tasks by dependency (interface tasks before implementations,
   builders before the test author, everything before review).
4. Record anything that does not fit one expert as a risk, not as a vague
   shared task.

## Good result

Every task names its expert, its files, and what it waits on; no two tasks
claim the same files; the plan fits the playbook's task ceiling.

## Fleet tools

Submit the sliced plan with `fleet_plan_submit`: each entry carries `key`,
`expert`, `title`, `objective`, `context`, `constraints`, `acceptance[]`,
`paths[]`, and `deps[]`. When the mission parks as `waiting-human`, tell
the person the plan in a few lines and wait; never resubmit to dodge
approval.
