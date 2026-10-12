# Stage 4b — Expert packs

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-4a.md` and its verification report exist with a PASS verdict. Work on branch `stage-4b-packs`.

## Goal of this stage

Let outside projects ship experts. A pack is an expert that lives in its own repository and is added to the fleet as one unit, at a pinned commit, after passing a validator that cannot be talked past.

At the end of this stage an example pack validates, installs, builds, and passes its smoke test, and a set of deliberately bad variants are each rejected for the stated reason.

## Why this stage is strict

The monorepo copied three donor projects into itself as "packs". Their manifests pointed at files that did not exist, the checks passed anyway, one copy was a stub of the real project, and one carried a patch stack this project had decided to keep out. So here:

- This repository holds the contract, the tooling, and one example. It holds no donor code.
- An installed pack's files are not tracked in git. Only a lock entry is: where it came from, which commit, and a content hash.
- The validator checks what is on disk, not what the manifest claims.

## Not in this stage

Evals, the Scraper Swarm switch, the final pass (Stage 4c). Converting the donor repositories into packs is done inside those repositories with `donor-pack-conversion.md`, not here.

## Ask the user

- Optionally: a donor repository URL and a full commit SHA that already passes `pack-validate`, to install as a real pack in step 5. Without one, step 5 is reported as not performed.

## Step 1 — Contract

Write `packs/README.md` and `packs/schema/pack.schema.json`.

| Part | Content |
|---|---|
| `pack.yaml` | `name`, `version`, tested OpenCode version range, required environment variables, egress hosts, the roster entry (`profile`, `tier`, `access`, `proposed_writes`, `mcp`, `skills`, `description`, `handles`, `delegates`), optional extra `permissions` (allow or deny rules for the pack's own tools, agents, and MCP servers), and optional `config` (only `experimental.subagent_depth`, at most 3) |
| `Dockerfile` | Takes `ARG AGENCY_BASE_IMAGE`; its final stage is `FROM ${AGENCY_BASE_IMAGE}`; installs the toolchain, plugins, and MCP servers, all pinned |
| `config/agents/`, `config/skills/` | Persona and skills |
| `plugins/` | OpenCode plugins to enable, with their options |
| `mcp/` | Source of any MCP server the pack ships itself |
| `tests/smoke.sh` | Proves the expert starts headless, loads its agents and tools, and completes one scripted task |
| `README.md`, `LICENSE`, `NOTICE` | As usual |

Those nine names are the whole of a pack. Nothing else may sit at its top level.

A pack configures an expert. It does not modify third-party software, so it carries no patch files and no launcher or injector for another application.

**Plugins.** Find out from `review/opencode` how v2 resolves a plugin from a local directory, and install plugins into the image at build time. The config directory is read-only at run time, so nothing may be installed after start. Record what you found in `docs/build-notes.md`.

**Accept:** the schema validates the example pack from step 4 and rejects a `pack.yaml` with an unknown key.

## Step 2 — Validator

`scripts/pack-validate.ts <dir>` (`make pack-validate DIR=...`) exits 1, naming the file and the problem, when any of these is true:

1. A required field is missing, or `pack.yaml` fails the schema, including a `config` key outside the allowed one.
2. Any permission rule or plugin option can produce `ask`, or an extra permission rule reaches beyond the pack's own tools, agents, and MCP servers.
3. Any version is unpinned: a dependency range, an image tag without a digest or exact version, `latest`, an install command with no version.
4. It declares or needs access to a container daemon: a socket path, `privileged`, a daemon package installed in the Dockerfile.
5. It asks for egress to a wildcard host or an IP literal.
6. A top-level entry is outside the nine names in step 1.
7. It contains a `*.patch` or `*.diff` file anywhere.
8. A file the manifest refers to does not exist: an agent, a skill's `SKILL.md`, a plugin entry, an MCP server command that points into the pack, `tests/smoke.sh`.
9. The Dockerfile's final stage is not built `FROM` the fleet base image.
10. The pack's `name` collides with an expert already in `fleet.yaml`, or is not a slug.
11. `access` is `ro` and `proposed_writes` is not empty, or `scoped` and it is empty.
12. A skill has no procedure: a `SKILL.md` with only frontmatter.

Each rule is a separate function with its own test, and each test has a fixture pack that violates only that rule. Name the rule 8 test `pack with a missing referenced file is rejected`; the defect register refers to it.

**Accept:** twelve passing tests, one per rule, each failing when its rule is disabled (red proofs by toggling the rule).

## Step 3 — Intake

`scripts/pack-add.ts <path | git-url@commit[#subdir]>` (`make pack-add SRC=...`):

1. For a git source, require a full 40-character commit SHA. A branch or tag is refused.
2. Fetch into `state/pack-cache/`, outside the tracked tree.
3. Run the validator on the pack directory. Stop on failure.
4. Copy only the nine allowed names into `packs/installed/<name>/`, which is git-ignored.
5. Write or update the entry in `packs/packs.lock.yaml`, which is tracked: `name`, `source`, `commit`, `subdir`, a hash of the installed tree, and `enabled: false`.
6. Render, build the image, and run the pack's `tests/smoke.sh` against the pinned OpenCode version. A smoke failure removes the installed directory and the lock entry.

A human enables a pack by setting `enabled: true` in the lock file. No script does.

Also:

- `make packs-sync` re-creates `packs/installed/` from the lock file and fails if a fetched tree's hash differs from the locked one.
- The renderer merges roster entries from installed, enabled packs with `fleet.yaml`, as extended experts. It fails if a locked pack is missing from `packs/installed/` or its hash differs.
- A pack's egress hosts are added to that expert's allowlist only.

Tests: a branch name is refused; a failing validator stops intake and leaves no installed directory; the lock entry has the commit and hash; a changed installed file makes the renderer fail; `packs-sync` restores a deleted installed directory; an installed pack is `enabled: false` and produces no running service.

**Accept:** the tests pass.

## Step 4 — Example pack

`packs/examples/hello-expert/`: a minimal, complete pack used by the tests. One persona, one real skill, one tiny first-party plugin or MCP server, a smoke test that starts the expert and completes one scripted task.

Derive the bad variants for step 2's fixtures from it programmatically, so they cannot drift from the good one.

**Accept:** the example pack validates, is added, builds, and passes its smoke test; variants that contain an `ask` rule, an unpinned version, a daemon mount, a patch file, a stray top-level directory, and a reference to a missing file are each rejected with a message naming the problem.

## Step 5 — A real pack, if one is ready

If the user named a donor commit that passes `pack-validate`, add it with `pack-add`. Leave it disabled. Record the source and commit in the report.

Do not edit a donor pack to make it pass. If it fails validation, report the failures and stop; the fix belongs in the donor repository.

**Accept:** the pack is installed and disabled with a lock entry; or the step is reported as not performed.

## Step 6 — Roadmap

Write `docs/packs-roadmap.md`: what each planned pack needs before it can be added.

| Pack | Source | Needs first |
|---|---|---|
| `reverse-engineer` | `Heretek-AI/opencode-rea` | `runtime` set to `allow` or `deny` (its default is `ask`); the REA MCP server and target binaries in the container; `experimental.subagent_depth` raised for its three subagents |
| `godot` | `Heretek-AI/godot-opencode` | A headless Godot editor and the companion addon in the image; an exact `@opencode/plugin` pin |
| `gdevelop` | `Heretek-AI/opencode-gdevelop`, the plugin extracted from `GDevelop-Unlocked` | The extraction itself; stock GDevelop for its CLI tool. The editor patch stack is not part of this pack and never enters this repository. |

Skills from Claude Code plugins through `Heretek-AI/claude-4-opencode` follow the same build-time rule and are only described in the roadmap: pinned by commit, a per-expert allowlist, plugin hooks and plugin MCP servers off unless enabled explicitly.

**Accept:** the roadmap exists and matches the table.

## Acceptance checks for this stage

Under `scripts/accept/4b/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-validator-rules` | Twelve rule tests exist and passed. |
| `03-example-pack-end-to-end` | `pack-add` on the example validates, installs, builds, and passes smoke. |
| `04-bad-variants-rejected` | Each variant in step 4 is rejected with its reason. |
| `05-nothing-vendored` | `git ls-files packs/` lists only the README, the schema, the lock file, and `packs/examples/`. `packs/installed/` is ignored. No `*.patch` file exists in the repository. |
| `06-lock-integrity` | Editing a file under `packs/installed/` makes `make render` fail. |
| `07-disabled-by-default` | A freshly added pack has no running service and no entry in the Dispatcher's roster until enabled. |
| `08-real-pack` | Step 5. Skips when the user named no donor commit. |

## Report

Write `docs/reports/stage-4b.md` in the format of shared context 4.4. Then stop.
