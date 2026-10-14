---
name: playbook-selection
description: Choose the playbook whose gates fit the mission's risk, and record why the others did not fit.
---

# Playbook selection

## When to use

Use once per mission, before writing the plan. Revisit only when the
objective changes shape.

## Procedure

1. Read the available playbooks and their gates (review, QA judges,
   verify, approval thresholds).
2. Match gates to risk: user-facing or data-touching work takes the full
   gates; docs-only work takes the light path.
3. Record the choice and the rejected alternatives with one line of reason
   each in the decision log.

## Good result

One playbook named, its gates listed in the plan, and no gate skipped or
weakened to fit the schedule.

## Fleet tools

Start with `fleet_roster` (who is available and healthy) and
`fleet_mission_create` (which returns the repository's ownership summary).
The plan you submit must keep every task's paths inside its owner's
grant; `fleet_plan_submit` refuses anything outside, and that refusal is
a planning error, not a negotiation.
