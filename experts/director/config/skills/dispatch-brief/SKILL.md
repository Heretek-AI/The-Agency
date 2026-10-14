---
name: dispatch-brief
description: Write a task brief with objective, context, constraints, and numbered acceptance criteria an expert can execute alone.
---

# Dispatch brief

## When to use

Use for every task handed to an expert. A brief that assumes hallway
knowledge produces hallway results.

## Procedure

1. State the objective in one paragraph: what changes and why.
2. Add only the context the expert needs: pointers to files, the decision
   being implemented, prior results it builds on.
3. List constraints: granted paths, the branch and worktree, what is out
   of scope, and where artifacts go (`/artifacts/<taskId>/`).
4. Write acceptance criteria as a numbered list, each one checkable by
   running something.

## Good result

The expert can start without asking anything; each criterion names its
check (`bun test tests/x.test.ts`, not "tests pass").

## Fleet tools

A brief is the `objective`, `context`, `constraints`, `acceptance`, and
`paths` of one `fleet_plan_submit` entry. Read the repository first
(`fleet_roster` for who does what, `git log` and `git diff` for the
ground truth); the expert sees only the brief, never this conversation.
