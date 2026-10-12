# Build notes (Stage 0 and beyond)

Running log of facts, salvage provenance, spike answers, and fallbacks.
Stage reports in `docs/reports/` quote evidence; this file records context.

## Preflight

- Date: 2026-10-12 (UTC).
- Branch: `stage-0-salvage` (worktree `/home/john/Projects/The-Agency/worktrees/wave-0-salvage/`).
- Bun: 1.4.2. git: 2.56.0. Docker: 29.9.0. SELinux: Enforcing.
- `opencode` binary on PATH: yes (`/home/linuxbrew/.linuxbrew/bin/opencode`, v2.0.27; pin is 2.0.26).
- Salvage source: `SALVAGE_SRC=/home/john/Projects/Heretek-AI-opencode/rebuild_staging/` (read-only, never written).
- Salvage commit: `14f297a` (verified with `git -C "$SALVAGE_SRC" rev-parse --short HEAD`).
- Working tree at branch-off held only the prompt series, `docs/research/`, `docs/audit/`, and untracked `review/`.

## Salvage

Salvage commit for every row: `14f297a`. (Table completed in Step 11.)

| Source (`$SALVAGE_SRC/packages/…`) | Destination (this repo) | Changes made |
| ---------------------------------- | ----------------------- | ------------ |

## Spike

Not in Stage 0. Recorded in Stage 1a.

## Fallbacks in force

None yet. (Stage 0 builds no fallbacks; the polling `wait` fallback in the
client is specified behavior, not a fallback under this heading.)

## Proposed corrections

- The fake OpenCode server must serve `GET /openapi.json` (the real spec file),
  but that path is not itself listed in the spec's 118 paths. The route
  self-check therefore exempts exactly that one route and checks every other
  served route against the spec. Justification: a file cannot list itself as an
  API operation; the exemption is documented in the fake's source.
