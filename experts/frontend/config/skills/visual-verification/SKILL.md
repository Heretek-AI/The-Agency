---
name: visual-verification
description: Verify UI changes with before-and-after screenshots stored under /artifacts/<taskId>/.
---

# Visual verification

## When to use

Use for every visible change. Screenshots are the evidence that the UI did
what the criteria say.

## Procedure

1. Capture the before state of each affected screen.
2. Implement, then capture the after state at the same viewport.
3. Compare them side by side; unexpected shifts are bugs until proven
   otherwise.

## Good result

Before/after pairs under `/artifacts/<taskId>/` show exactly the intended
change and nothing else.
