---
name: mission-reporting
description: Close a mission with a report of what landed, what did not, and what a human should know.
---

# Mission reporting

## When to use

Use when every task is done, cancelled, or halted. Write it once, at the
end.

## Procedure

1. List landed tasks with their merge SHAs, and cancelled or halted tasks
   with their reasons.
2. Summarize verification: which checks ran green on the integration
   branch, and any follow-ups left open.
3. Name the assumptions made along the way and the risks carried forward.

## Good result

A human reading only the report knows what shipped, what did not, and
what to watch.

## Fleet tools

Recover with `fleet_mission_get` (objective, plan, every task status and
reason, decisions) after any compaction or restart. Close with
`fleet_mission_close`, which the Dispatcher refuses unless every code
change carries a landed SHA and the last integration verify is green;
write the summary only from landed evidence.
