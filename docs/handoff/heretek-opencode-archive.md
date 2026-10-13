# Handoff: archive `Heretek-OpenCode/heretek-opencode`

Steps for a human with owner access to `Heretek-OpenCode/heretek-opencode`.
Do not run these from a builder session, and do not modify that repository
from here: `SALVAGE_SRC` is read-only.

## 1. Place this README text at its root

> This repository is archived. It was the consolidation prototype that the
> 2026-10-12 audit (`Heretek-AI/The-Agency`, kept in
> `docs/audit/2026-10-12-heretek-opencode-audit.md`) found unsalvageable as a
> system: the Dispatcher never called OpenCode, tasks reported `done` with no
> checks and no merge, and the end-to-end scripts passed with no server
> running. The Agency is now built in `Heretek-AI/The-Agency` to the design
> in its `docs/prompts/`, with a defect register in `docs/audit/defects.md`.
> A few modules were carried over with their defects fixed; each is recorded
> with its source commit in `Heretek-AI/The-Agency`'s `docs/build-notes.md`.
> Nothing here is maintained. Do not start new work from this tree.

## 2. Archive it on GitHub

```sh
gh repo archive Heretek-OpenCode/heretek-opencode --yes
```

Confirm the repository page shows the "This repository was archived" banner.

## 3. Confirm nothing still reads it

```sh
grep -rn "Heretek-OpenCode/heretek-opencode" --include='*.md' --include='*.yaml' --include='*.json' .
```

The only remaining references should be historical (the audit, build notes,
this handoff note).
