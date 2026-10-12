# Stage 1a — Spike and base image

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-0.md` and `docs/reports/stage-0-verification.md` exist and the verification verdict is PASS. Work on branch `stage-1a-spike`.

## Goal of this stage

Settle, by experiment against a real OpenCode 2.0.26 container, every fact the rest of the build depends on, and produce the base image all experts are built from.

At the end of this stage `scripts/spike.sh` runs the whole session flow against a container built from `images/base`, and `docs/build-notes.md` holds a recorded answer, with evidence, to each of fifteen questions.

The monorepo skipped this step, and most of what went wrong there traces back to building on assumptions it would have corrected. Do not shorten it.

## Not in this stage

`fleet.yaml`, the renderer, per-expert images, the egress proxy, the compose file (Stage 1b). Any Dispatcher code (Stage 1c). Write the minimal hand-made configuration the spike needs under `spike/` and nothing more.

## Ask the user

- The `OPENCODE_API_KEY` value (OpenCode Go or Zen) and the model id for `AGENCY_MODEL`. The user places the key in `.env.provider` themselves; never ask them to paste it into the conversation, and never print it.
- Docker or Podman. Both are installed on the development host.

This stage cannot complete without the key. Questions 1, 7 to 11, and 15 need a model to answer. If the user does not supply one, do steps 0 and 1, report the rest as not performed, and stop.

## Step 0 — Preflight

Write `scripts/preflight.sh`. It checks and prints a table of:

- the container runtime and its version; Compose at 2.24 or newer;
- SELinux mode;
- that `.env.provider` exists with mode `0600` and a non-empty `OPENCODE_API_KEY` (report present or absent, never the value);
- that the OpenCode v2 install script URL is reachable;
- a free loopback port for `AGENCY_HTTP_PORT`, starting at 8080 and counting up (8080 is taken on the development host);
- for Stage 2b only, as information: whether user namespaces are enabled and which kernel is running.

It exits 1 on any failed requirement and never prints a secret. Put the chosen port in `.env.example` as the suggested value and record the table in `docs/build-notes.md`.

**Accept:** `scripts/preflight.sh` exits 0; removing `.env.provider` makes it exit 1 (red proof).

## Step 1 — Base image

**`images/base/Dockerfile`**, starting from the salvaged `opencode-distro/Dockerfile` (shared context 2.3):

- `ubuntu:24.04` pinned by digest; record the digest in `versions.env`.
- Packages: `ca-certificates curl git jq ripgrep fd-find tini unzip xz-utils openssh-client python3 tar`, plus `yq`, Node LTS, and `uv`, each at a pinned version.
- User `agent` from build arguments `AGENT_UID` and `AGENT_GID`. The base image already has a uid 1000 user; rename it as the salvaged file does when the ids collide.
- `/work`, `/artifacts`, `/etc/agency`, and the XDG data, state, and cache directories exist and are owned by `agent`.
- OpenCode installed with the v2 install script at `OPENCODE_VERSION`, moved to `/usr/local/bin/opencode`, and checked with `opencode --version` in the build.
- `git config --system --add safe.directory '*'`.
- `HEALTHCHECK`: `curl -fsS --noproxy '*' -u "opencode:$OPENCODE_PASSWORD" http://127.0.0.1:4096/api/info`.
- Entrypoint `tini -- /usr/local/bin/entrypoint.sh`. Runs as `agent`.
- No secret appears in any layer, build argument, or `ENV`.

**`images/base/entrypoint.sh`:**

1. If `OPENCODE_PASSWORD` or `OPENCODE_API_KEY` is empty, print which variable is missing and exit 64. Never print a value.
2. Set the git identity to `<AGENCY_EXPERT> (The Agency)` with an address under `agency.invalid`.
3. If `/etc/agency/mcp-requirements.json` exists: for every MCP server whose required variables are not all set, put its complete config with `"disabled": true` into an overlay exported as `OPENCODE_CONFIG_CONTENT`. A later config document replaces a server entry whole, so the overlay must carry the full entry.
4. Apply any fallbacks recorded under "Fallbacks in force" in `docs/build-notes.md`.
5. `exec opencode serve --hostname 0.0.0.0 --port 4096`.

Add `make build-base`.

**Accept:**

- The image builds. Its Dockerfile contains no `latest` and no unpinned `FROM`.
- Started with no password, the container exits with a non-zero status within five seconds and its log names the variable.
- Started with both variables, it becomes `healthy`, runs as the uid passed in `AGENT_UID`, and `opencode --version` inside it prints the pinned version.
- Neither secret appears in `docker history` or `docker inspect` of the image.

## Step 2 — Spike

Create `spike/config/` (mounted read-only at `/etc/agency`): an `opencode.jsonc` with the deny-all baseline from shared context 9.6 and one agent, `spike`. Create a throwaway git repository with a worktree as the workspace, mounted at `/work` with `:z`.

Write `scripts/spike.sh`. From a clean state it builds nothing but starts one container from the base image, then with `curl` or `opencode api` exercises: `/api/info`, `/openapi.json`, creating a session at the worktree directory with a `permissions` array, prompt, wait, messages, diff, and a permission request that is listed and then rejected. It tears the container down by name on exit, including on failure. It exits non-zero on the first unexpected response; there is no tolerant path.

Then settle each question. For each, save the commands and trimmed output to `docs/evidence/1a/spike/q<nn>.log` and write the answer, and the fallback if it applies, in the "Spike" section of `docs/build-notes.md`.

| # | Question | Fallback if the answer is no |
|---|---|---|
| 1 | Does `opencode serve` pick up `OPENCODE_API_KEY` from the environment, and is the `AGENCY_MODEL` id listed by `opencode models`? | `opencode auth import` in the entrypoint; correct the id |
| 2 | Can server logs reach container stdout (`--print-logs`, or tailing the data `log` directory)? | Tail the files from the entrypoint |
| 3 | Does a read-only workspace mount leave sessions, snapshots, and `session.diff` working? | Mount read-write and fail any `ro` task whose worktree changed |
| 4 | Does `serve` start with a read-only `OPENCODE_CONFIG_DIR`? | Bake config into the image, owned by root, mode `0444` |
| 5 | Is disabling the built-in `build`, `plan`, and `general` agents safe? | Mark them `hidden` |
| 6 | Is `@opencode/client@<version>` installable and usable from Bun, and is it better than the salvaged `fetch` client? | Keep the salvaged client (the default) |
| 7 | Are rules passed in `session.create`'s `permissions` evaluated after the agent's rules, so a per-task `edit` allow takes effect over the deny-all baseline, and an `edit` outside it is refused? | Static `edit` globs from `fleet.yaml` |
| 8 | What does a session emit when the provider refuses a request for quota or rate limit, and does it say when the limit resets? Read `packages/schema/src/session-error.ts` and provoke an error with an invalid key to see the shape. | Treat any repeated provider refusal as a limit and probe on a timer |
| 9 | Does `Session.Info` report cost and token counts for the chosen model? | Count steps and tokens only |
| 10 | With `HTTPS_PROXY` set and no direct route out, do provider calls and remote MCP servers work? Test on an `internal: true` network with a throwaway forward proxy. | Check `NODE_USE_ENV_PROXY` and similar switches; as a last resort allow the provider host by a routed exception and document it |
| 11 | Do SSE events for an MCP tool call carry the session id and the tool output, so the Dispatcher can match a `fleet_mission_create` call to its session? | The Director polls with `fleet_wait` |
| 12 | With project config disabled, is the repository's own `AGENTS.md` still loaded? | Nothing needed; the envelope tells the expert to read it |
| 13 | Does the web app accept `?auth_token=<base64("opencode:<password>")>` on first navigation? | Manual sign-in per expert UI |
| 14 | Under the pinned Bun: does `@modelcontextprotocol/sdk`'s Streamable HTTP server transport serve a tool list and a tool call to OpenCode's own MCP client (the spike container configured with a remote server pointing at a ten-line Bun MCP server)? Does `bun:sqlite` in WAL mode work on a `:z` volume? | Run the Dispatcher on Node 24 LTS with `node:sqlite`; tests stay on Bun |
| 15 | After `PUT /api/session/{id}/environment` with one variable, does a `shell` call in that session see it, and does a second session not see it? | The Dispatcher writes `/artifacts/<taskId>/env` and the envelope tells the expert to source it |

Rules for the answers:

- An answer is "yes", "no", or "partly", followed by what you observed. "Expected to work" is not an answer.
- Questions 3, 4, 7, 10, 14, and 15 decide the shape of later stages. For each of those, the evidence must show both the positive case and a negative case (for 7: an allowed edit succeeds and a disallowed edit is refused).
- Any fallback you adopt goes under "Fallbacks in force", one line each, so later stages apply it.
- If an observation contradicts shared context section 5, record it under "Proposed corrections" and follow what you observed.

**Accept:** `scripts/spike.sh` exits 0 from a clean state and leaves no container behind; all fifteen rows have an answer and an evidence file; "Fallbacks in force" is complete.

## Acceptance checks for this stage

Under `scripts/accept/1a/`:

| Check | Passes when |
|---|---|
| `01-preflight` | `scripts/preflight.sh` exits 0. |
| `02-base-image-pinned` | The Dockerfile has a digest-pinned `FROM` and no floating versions; the image builds. |
| `03-entrypoint-fails-closed` | No password, then no API key: each makes the container exit non-zero and name the variable. |
| `04-healthy-nonroot` | With credentials the container is healthy and runs as `AGENT_UID`. |
| `05-spike-end-to-end` | `scripts/spike.sh` exits 0. Skips only if `.env.provider` has no key. |
| `06-spike-answers-complete` | Fifteen answers, fifteen evidence files, each non-empty; the six shape-deciding questions each show a negative case. |
| `07-no-secret-leak` | The key's value appears nowhere in the repository, in `docs/evidence/`, in container logs captured by the spike, or in image metadata. |
| `08-no-containers-left` | After the spike, no container with the spike's name prefix exists. |

A skip of `05` means this stage is not complete; say so plainly in the report.

## Report

Write `docs/reports/stage-1a.md` in the format of shared context 4.4. Include the fifteen answers as a table and the "Fallbacks in force" list. Then stop.
