---
name: codebase-mapping
description: Answer where something lives, who calls it, and how big it is, with file pointers for every claim.
---

# Codebase mapping

## When to use

Use when someone asks where behavior lives or what depends on what. Do not
use to propose redesigns.

## Procedure

1. Find candidates with `ast-grep -p '<pattern>'` and `rg -l '<symbol>'`
   before opening files.
2. Read the definitions and their callers; count with `scc` when size
   matters to the question.
3. Write the map: the files, the call edges, entry points, and anything
   surprising (dead code, duplicated logic).

## Commands

- `ast-grep -p 'function $NAME($$$)' src/`
- `rg -n '<symbol>' --type ts`
- `scc --by-file src/`

## Good result

A reader can open exactly the files listed and see the behavior; no claim
lacks a `file:line` pointer.
