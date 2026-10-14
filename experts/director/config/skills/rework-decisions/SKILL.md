---
name: rework-decisions
description: Decide accept or rework from the evidence in RESULT and VERDICT blocks, staying inside the playbook's rework budget.
---

# Rework decisions

## When to use

Use when a task result or judge verdict returns. Never accept work whose
evidence you have not checked.

## Procedure

1. Match every acceptance criterion against quoted evidence (commands,
   exit codes, observed output). Unmatched criteria fail the task.
2. For failures, decide: retry the same brief (flaky or incomplete),
   rewrite the brief (wrong slice), or escalate to a human (budget spent
   or scope wrong).
3. Count attempts against the playbook's budget (three attempts, one
   replan, two more, then halt for a human) and say the count aloud.

## Good result

Each decision cites the evidence, the attempt number, and what changes
next; nothing is accepted on trust.
