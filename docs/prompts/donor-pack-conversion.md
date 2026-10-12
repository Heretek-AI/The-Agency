# Convert a donor repository into an expert pack

This prompt is run inside a **donor repository**, not inside The Agency. The message that starts the session names the donor: `godot-opencode`, `opencode-rea`, or `GDevelop-Unlocked`.

Attach `00-shared-context.md` from The Agency as well. Its sections 3 (operating rules), 4 (verification rules), and 5 (OpenCode v2 facts) apply here. Its repository layout and stage list do not.

## What a pack is

The Agency is a fleet of OpenCode v2 experts, one container each. A **pack** is an expert that lives in its own repository and is added to the fleet at a pinned commit. The fleet's validator checks the pack on disk and refuses it on any violation, so the pack has to be exact.

A pack is a directory with these top-level names and no others:

| Part | Content |
|---|---|
| `pack.yaml` | `name`, `version`, tested OpenCode version range, required environment variables, egress hosts, the roster entry, and optional extra permission rules and config keys |
| `Dockerfile` | Takes `ARG AGENCY_BASE_IMAGE`; its final stage is `FROM ${AGENCY_BASE_IMAGE}`; installs the toolchain, plugins, and MCP servers, all pinned |
| `config/agents/<name>.md` | The persona: frontmatter with `mode: primary` and a `description`, the system prompt as the body |
| `config/skills/<skill>/SKILL.md` | Skills, each a concrete procedure |
| `plugins/` | OpenCode plugins to enable, with their options |
| `mcp/` | Source of any MCP server the pack ships itself |
| `tests/smoke.sh` | Proves the expert starts headless, loads its agents and tools, and completes one scripted task |
| `README.md`, `LICENSE`, `NOTICE` | As usual |

`pack.yaml`, in outline:

```yaml
name: godot                       # a slug, unique in the fleet
version: 1.0.0
opencode: ">=2.0.26 <2.1.0"
requires_env: []                  # variables that must be set for the expert to start
egress: []                        # exact hostnames only; no wildcards, no IP literals
roster:
  profile: extended
  tier: standard
  access: scoped                  # ro | scoped
  description: "One sentence."
  handles:   ["..."]
  delegates: ["... -> <expert>"]
  proposed_writes: ["*.gd", "*.tscn"]   # empty for ro
  mcp: []
  skills: [scene-editing]
permissions: []                   # extra allow or deny rules for the pack's own tools, agents, MCP servers
config: {}                        # only keys the fleet allows, such as experimental.subagent_depth
```

The validator rejects a pack when:

1. a required field is missing;
2. any permission rule or plugin option can produce `ask`;
3. any version is unpinned;
4. it needs a container daemon;
5. it asks for egress to a wildcard host or an IP literal;
6. a top-level entry is outside the list above;
7. it contains a `*.patch` or `*.diff` file;
8. a file the manifest refers to does not exist;
9. the Dockerfile's final stage is not the fleet base image;
10. the name collides with a fleet expert or is not a slug;
11. `access` and `proposed_writes` disagree;
12. a skill has no procedure.

If The Agency's `packs/README.md` exists (its path is in `AGENCY_DIR`), it is the authority and overrides this summary. If `AGENCY_DIR` has `make pack-validate`, run it; otherwise check each of the twelve rules by hand and report validation as not performed by the tool.

## Rules for this work

- Work on a new branch, `agency-pack`. Commit locally. Never push, tag, or open a pull request. Never create a repository on GitHub.
- The pack is a subdirectory named `pack/` at the repository root. The fleet adds it as `<git-url>@<commit>#pack`.
- **Everything the image needs is inside `pack/`.** Either the source lives there, or a build step writes it there and `make pack-check` (or the repository's equivalent) fails when the copy is stale. The fleet builds with `pack/` as the only build context.
- The existing tests of the repository keep passing. Run them before you start and record the baseline; run them again at the end.
- Do not weaken a test or a check to get through. Shared context section 4 applies: a check that cannot fail is not a check.
- A persona or skill is written for a headless expert that nobody can answer. It says how to verify work by running it, and when to report `blocked`.
- The persona ends with the `RESULT` block from the fleet protocol (shared context 9.8).

## Generic steps

1. **Inventory.** List what the repository ships: plugins, MCP servers, agents, skills, companion assets, binaries it expects on the host. For each, say whether the expert needs it at run time.
2. **Headless readiness.** Find every place the plugin or its agents can raise a permission prompt, ask a question, or wait for a GUI. Each becomes `allow` or `deny`, or the persona is told to report `blocked`.
3. **Pins.** Pin `@opencode/plugin` and every other dependency to an exact version. Pin every binary the Dockerfile downloads, with a checksum.
4. **Write `pack/`.** Manifest, Dockerfile, persona, two to five skills, plugin entries, smoke test.
5. **Smoke test.** `pack/tests/smoke.sh` exits 0, 1, or 77 (shared context 4.3). Without a model: the expert is healthy, `/api/agent` lists the persona, `/api/skill` lists the skills, the plugin's tools are registered. With a provider key: one prompt that must use one of the pack's tools, asserting on the tool's effect in the workspace, not on the model's words.
6. **Validate** against the twelve rules.
7. **Report.** `docs/agency-pack-report.md`: what the pack contains, the baseline and final test results, each validator rule and how it is met, what was not performed, and the commit to give the fleet.

## Donor: `godot-opencode`

- The plugin is in `packages/plugin`; the Godot editor addon is in `companion/addons/godot_opencode`.
- No package pins `@opencode/*` today. Add the exact pin and make the plugin build against it.
- The image needs a headless Godot 4.x editor at a pinned version with a checksum, and the companion addon. Work out, by running it, how the addon reaches a project the expert is editing: installed into the task's project, or loaded from a fixed path. Record what you found.
- **Recover the monorepo's changes.** `heretek-opencode` at commit `14f297a` has a copy of this plugin with differences: `packages/opencode-packs/packs/pack-godot/src/guard.ts`, `plugin-entry.ts`, `tools.ts`, a changed `index.ts`, changes under `companion/`, and 21 test files. Diff each against this repository. Adopt what is correct and tested, one reviewed change at a time, and write down what you took and what you left and why. Do not bulk-copy. That copy's manifest points at `./mcp/godot.js`, which does not exist; do not carry that over.
- Suggested roster entry: `name: godot`, `extended`, `scoped`, proposed writes covering `*.gd`, `*.tscn`, `*.tres`, `*.gdshader`, `project.godot`, `addons/*`.
- Smoke: `godot --headless --version` prints the pin; the plugin handshake with the addon succeeds against a fixture project inside the pack's tests.

## Donor: `opencode-rea`

- The plugin's `runtime` option defaults to `ask`. The pack sets it to `allow` or `deny`. Find every other option that can prompt.
- The expert needs the REA MCP server and its target tooling in the container (`rea-agents` is pinned at 6.4.0 in this repository). Verify with the repository's own `rea doctor --client opencode --json` inside the built image.
- It uses three subagents. Request `experimental.subagent_depth` under `config` in `pack.yaml`, and `subagent` allows for exactly those three agent ids under `permissions`.
- Analysis is read-only. Suggested roster entry: `name: reverse-engineer`, `extended`, `ro`. Findings go to `/artifacts/<taskId>/`.
- The monorepo's `pack-rea` is a 107-line stub. Ignore it; this repository is the source of truth.
- Smoke: the readiness check reports ready inside the image; the three subagents are listed; with a key, one prompt analyses a small fixture binary and writes a report.

## Donor: `GDevelop-Unlocked` — extract the plugin into its own repository

This repository holds two unrelated things:

1. A modified GDevelop editor: `patches/`, `launcher/`, `packages/ai-studio`, `packages/opencode-provider`, `web-userscript/`, and `packages/unlock-shim/generation-shim.mjs`.
2. An OpenCode plugin: `packages/opencode-gdevelop` (`index.mjs`, `tools.mjs`, `agents.mjs`), which works on stock GDevelop project files.

The plugin's only tie to the rest is `packages/unlock-shim/control-shim.mjs`. Despite its location, that file is a zero-dependency library that reads and writes stock `game.json` projects and formats stock headless CLI commands. It has nothing to do with the editor modifications.

The Agency takes item 2 and never item 1. The clean way to guarantee that is to give the plugin its own repository, so no checkout of the pack ever contains the patch stack.

**Do this:**

1. **Baseline.** In `GDevelop-Unlocked`, run `npm test` and record the result.
2. **Create the new repository locally** at `../opencode-gdevelop` with `git init`. Do not create it on GitHub and do not push. Copy the files below at the current commit and record that commit and the source repository in the new README as provenance. Preserving history with `git filter-repo` is welcome if the tool is installed; it is not required.

   | From `GDevelop-Unlocked` | To `opencode-gdevelop` |
   |---|---|
   | `packages/opencode-gdevelop/index.mjs`, `tools.mjs`, `agents.mjs` | `src/` |
   | `packages/unlock-shim/control-shim.mjs` | `src/project-control.mjs` |
   | `tests/integration/opencode-plugin-tools.test.mjs`, `opencode-plugin-agent.test.mjs` | `tests/integration/` |
   | `tests/unit/opencode-control-shim.test.mjs` | `tests/unit/project-control.test.mjs` |
   | `LICENSE` | `LICENSE` (MIT, as in the source) |

3. **Rename and rewire.** `control-shim` becomes `project-control` in file names, imports, and error-message prefixes. Keep the exported function names. The package keeps zero dependencies; `@opencode/plugin` stays a host-provided peer, pinned exactly in `peerDependencies`.
4. **Independence test.** Add `tests/independence.test.mjs`, which fails if:
   - any file in the new repository contains `unlock`, `patches/`, `launcher`, `ai-studio`, `CustomAIClient`, `SubscriptionChecker`, `hasValidSubscriptionPlan`, `watermark`, `GDevelop-Heretek`, or `api.gdevelop.io`;
   - `package.json` has any entry under `dependencies` or `devDependencies`;
   - any import resolves outside the repository or to anything but `node:` builtins and the peer.

   Show it red once (add one of the strings, run it, remove it).
5. **The CLI tool.** `gdevelop_cli_run` only formats a headless command; the host is expected to spawn it. Find out, by trying it in a container, whether stock GDevelop at a pinned release can run that command without a display. If it can, install that release in the pack image with a checksum. If it cannot, leave it out, and have the persona report `blocked` for anything that needs a running editor. Record what you tried. Do not assume either way.
6. **Write `pack/`** in the new repository, following the generic steps.
   - `scripts/build-pack.mjs` copies `src/` into `pack/plugins/gdevelop/`; `npm run pack:check` fails when the copy is stale.
   - Roster entry: `name: gdevelop`, `extended`, `scoped`. Derive `proposed_writes` from the project layouts `project-control.mjs` handles (single-file `game.json` and the split-folder layout).
   - No egress hosts. No MCP servers.
   - Turn the `gdevelop-architect` subagent prompt in `agents.mjs` into the primary persona, and write skills for reading a project before changing it, adding scenes and objects, authoring events, and verifying a change by re-reading the project and checking it still parses.
7. **Point `GDevelop-Unlocked` at the new repository.** On branch `agency-pack` there: find every importer of `control-shim.mjs` and of `packages/opencode-gdevelop`. Replace the two with a git dependency on `opencode-gdevelop` pinned to the new repository's commit, or, if a git dependency does not suit this repository's tooling, keep a vendored copy guarded by a hash check that names the upstream commit. `packages/unlock-shim` keeps only `generation-shim.mjs`. Do not change `patches/`, `launcher/`, or `packages/ai-studio`. `npm test` passes as before.
8. **Reports** in both repositories. In the new one, give the commit to hand to the fleet and the result of each validator rule. Say plainly that publishing the new repository is a step for the owner.

The editor's own use of OpenCode, through `packages/opencode-provider`, is the opposite direction: the editor is a client of an OpenCode server. It stays in `GDevelop-Unlocked` and is not part of any pack.

## Acceptance

For any donor, the work is finished when:

- the repository's existing tests pass, as at the baseline;
- `pack/` contains only the allowed names and every file `pack.yaml` refers to;
- each of the twelve validator rules is met, with the evidence in the report;
- `pack/tests/smoke.sh` passes without a model, and with a model if a key was available, or that part is reported as not performed;
- for the GDevelop extraction: the independence test passes and was shown red once, and `GDevelop-Unlocked`'s tests pass with the plugin consumed from the new repository;
- nothing was pushed.
