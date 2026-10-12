# Stage 1b — Roster, renderer, network, and egress

Read `docs/prompts/00-shared-context.md` first. It is part of this prompt.

**Prerequisite:** `docs/reports/stage-1a.md` and its verification report exist with a PASS verdict. Read the "Spike" and "Fallbacks in force" sections of `docs/build-notes.md` and apply every fallback listed. Work on branch `stage-1b-roster`.

## Goal of this stage

Twelve expert containers, generated from `fleet.yaml`, running healthy on one machine with no route to the internet except an allowlist proxy that logs each request under the expert's name.

At the end of this stage `make up` brings all twelve to healthy and `make smoke` proves, per expert, its persona, skills, MCP servers, mounts, password, and egress.

There is still no Dispatcher. Nothing dispatches work to these experts yet.

## Not in this stage

The Dispatcher, the verifier, landing (Stage 1c). The `fleet` MCP server, REST, the Director's planning behaviour, the gateway, the dashboard (Stage 1d). `qa-functional` and `qa-adversarial` (Stage 2a). Extended experts (Stage 4a). No host port is published in this stage.

## Ask the user

Nothing new.

## Step 1 — `fleet.yaml` and its schema

- Write `fleet.yaml` to shared context 9.9 with all 25 experts from 9.10. Enable twelve: `director`, `scout`, `architect`, `product`, `frontend`, `backend`, `dba`, `platform`, `security`, `qa`, `reviewer`, `docs`.
- Take descriptions, `handles`, `delegates`, and skill names for the twelve from the salvaged `opencode-fleet/src/experts/catalog.ts`, checked against `docs/research/02-expert-fleet-catalog.md`. Write the other thirteen from the research catalog. Do not keep the TypeScript catalog.
- Put the schema in `dispatcher/src/fleet-schema.ts` (Zod). The renderer and, later, the Dispatcher both import it. It rejects unknown keys, an `access: ro` expert with `proposed_writes`, and a `scoped` expert without them.

Tests: the file validates; it has the 25 names in 9.10 and no others; exactly twelve are enabled; each schema rejection.

**Accept:** the tests pass.

## Step 2 — MCP registry

Write `mcp/registry.jsonc` to shared context 9.11.

- Every local server is pinned to an exact version and installed into the image at build time. No `npx -y <unpinned>` at run time.
- Verify that each package or endpoint exists before listing it. Record what you checked in `docs/build-notes.md`. One you cannot verify ships with `"disabled": true` and a note.
- `postgres`, `dbhub`, `figma`, and `linear` ship disabled as 9.11 says.
- `fleet` requires `FLEET_MCP_TOKEN`. That variable is not set until Stage 1d, so the Director's `fleet` server ends up disabled in this stage. That is correct here.

**Accept:** the registry validates against a schema test; build notes list the verification of each entry.

## Step 3 — Fleet protocol

Write `shared/FLEET_PROTOCOL.md` to shared context 9.8: the rules for every expert, and the `RESULT` and `VERDICT` formats with one example each. Write examples of your own; do not copy the ones in the shared context.

Test `protocol examples in FLEET_PROTOCOL.md parse`: extract each fenced example from the file and run it through `dispatcher/src/protocol.ts`.

**Accept:** the test passes.

## Step 4 — Renderer

`scripts/render.ts`. From `fleet.yaml`, `mcp/registry.jsonc`, and `shared/templates/`, generate:

- for each enabled expert: `experts/<name>/config/opencode.jsonc`, `config/AGENTS.md` (a copy of `shared/FLEET_PROTOCOL.md`), and `config/mcp-requirements.json`;
- `docker-compose.yml`;
- the proxy's allowlist configuration (step 6).

Generated files carry a "GENERATED, do not edit" header and are byte-for-byte reproducible. `--check` exits 1 when any generated file is stale or missing. `make render` and `make render-check` call it, and `make check` now includes `render-check`.

Generated `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "{env:AGENCY_MODEL}",
  "default_agent": "backend",
  "update": "disable",
  "share": "disabled",
  "snapshots": true,
  "agents": {
    "build":   { "disabled": true },
    "plan":    { "disabled": true },
    "general": { "disabled": true }
  },
  "permissions": [ /* baseline from shared context 9.6, then MCP allows */ ],
  "mcp": {
    "timeout": { "startup": 60000, "catalog": 30000, "execution": 300000 },
    "servers": { /* inlined from mcp/registry.jsonc */ }
  }
}
```

The renderer refuses to write, and exits 1, when:

- any permission rule in any input has the effect `ask`;
- the first rule of a generated list is not deny-all;
- an expert names a skill with no `experts/<name>/config/skills/<skill>/SKILL.md`;
- an expert names an MCP key missing from the registry;
- an expert uses a remote MCP host that is not on its egress allowlist.

Tests, on a small fixture fleet: output is stable across two runs; `--check` detects a hand-edited generated file; each refusal; a disabled expert produces no config and no service; the Director's ruleset differs as 9.6 says.

**Accept:** the tests pass; `make render-check` passes on the real tree.

## Step 5 — Experts

For each of the twelve, write by hand:

**`experts/<name>/Dockerfile`:** `FROM` the base image; that expert's tools from 9.10 at pinned versions; browsers installed at build time; local MCP servers installed at build time.

**`experts/<name>/config/agents/<name>.md`:** frontmatter with `mode: primary` and a `description`; the persona as the body. A persona is complete when it covers:

- who the expert is and what it owns;
- what it must hand off, and to which expert;
- how it works: the order it does things in, and how it verifies its own output by running it;
- its access class in plain words (what it may edit, where reports go);
- that it ends with the `RESULT` block from its fleet protocol.

Write each from the matching section of `docs/research/02-expert-fleet-catalog.md`. The five-line prompts in the salvaged catalog are not sufficient and must not be copied as the persona. Explain the reasons behind constraints; do not shout them.

**Skills:** each name in `fleet.yaml` gets `config/skills/<skill>/SKILL.md` with `name` and `description` frontmatter and a concrete procedure: when to use it, the steps, the commands, and what a good result looks like. A skill that only restates its title is not a skill.

**The Director** gets its identity, its read-only boundaries, and its git inspection commands here. Its planning and `fleet_*` workflow are written in Stage 1d, when those tools exist. Do not describe tools it does not have yet.

**Accept:** all twelve images build; every Dockerfile is free of floating versions; every skill named in `fleet.yaml` has a `SKILL.md` with a procedure.

## Step 6 — Networks and the egress proxy

- Network `fleet` is `internal: true`. Experts attach only to it.
- Network `outside` is a normal bridge. Only the egress proxy attaches to both in this stage.
- `egress/`: a forward proxy with:
  - a global allowlist in `egress/allowlist.txt`: `opencode.ai` and the provider hosts the spike observed, the package registries the toolchains use, the remote MCP hosts in the registry, and a documented list of documentation hosts;
  - per-expert additions from `fleet.yaml`;
  - a per-expert identity, from proxy credentials `PROXY_PW_<NAME>`;
  - one log line per request with the expert's name, the host and port, and allowed or denied;
  - `CONNECT` only to ports 443 and 80; destinations that resolve to private, loopback, link-local, or metadata addresses denied whatever the allowlist says.
- Choose the proxy software and record why in `docs/build-notes.md`. Squid supports per-user credentials, ACLs, and logged usernames directly. Smokescreen is available as a salvaged, commit-pinned Dockerfile (shared context 2.3) but as salvaged it has no ACL and no role mapping; if you choose it you must add both. Whichever you choose is pinned and must meet every bullet above.
- Each expert gets `HTTP_PROXY`, `HTTPS_PROXY`, and a `NO_PROXY` listing loopback and the fleet's internal service names. Apply the spike's answer to question 10.

**Accept:** covered by checks `07` and `08` below.

## Step 7 — Compose

The renderer generates one service per enabled expert in this shape:

```yaml
x-expert: &expert
  restart: unless-stopped
  working_dir: /work
  networks: [fleet]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  pids_limit: 1024
  healthcheck:
    test: ["CMD-SHELL", "curl -fsS --noproxy '*' -u opencode:$$OPENCODE_PASSWORD http://127.0.0.1:4096/api/info >/dev/null"]
    interval: 15s
    timeout: 5s
    retries: 10
    start_period: 30s

services:
  backend:
    <<: *expert
    build:
      context: .
      dockerfile: experts/backend/Dockerfile
      args: { OPENCODE_VERSION: "${OPENCODE_VERSION}", AGENT_UID: "${AGENT_UID}", AGENT_GID: "${AGENT_GID}" }
    environment:
      AGENCY_EXPERT: backend
      OPENCODE_CONFIG_DIR: /etc/agency
      OPENCODE_DISABLE_PROJECT_CONFIG: "1"
      OPENCODE_CLIENT: agency
      OPENCODE_PASSWORD: ${PW_BACKEND}
      AGENCY_MODEL: ${AGENCY_MODEL}
      HTTP_PROXY: http://backend:${PROXY_PW_BACKEND}@egress:3128
      HTTPS_PROXY: http://backend:${PROXY_PW_BACKEND}@egress:3128
      NO_PROXY: localhost,127.0.0.1,dispatcher,verifier
    env_file:
      - path: .env.provider          # OPENCODE_API_KEY
        required: true
      - path: secrets/backend.env
        required: false
    volumes:
      - ./experts/backend/config:/etc/agency:ro,z
      - ${AGENCY_WORKSPACE:-./workspace}:/work:rw,z     # ":ro,z" for ro experts
      - artifacts:/artifacts
      - backend-data:/home/agent/.local/share/opencode
      - backend-state:/home/agent/.local/state/opencode
      - backend-cache:/home/agent/.cache
    cpus: 2
    mem_limit: 4g
```

- Every bind mount carries `:z`. For rootless Podman add `userns_mode: "keep-id"` to services with bind mounts.
- Browser experts get `shm_size: 1g` and `mem_limit: 6g`.
- No service has `ports`, `privileged`, a daemon socket, host networking, or added capabilities.
- The whole of `/work` is mounted, never one worktree (shared context 9.1).

Write `scripts/init-env.sh` now, from the salvaged `studio init`: it creates `.env` (host uid and gid, the chosen `AGENCY_HTTP_PORT`, a random value for every `PW_<NAME>`, `PROXY_PW_<NAME>`, and token in shared context 9.13) and a placeholder `.env.provider`, both mode `0600`, never overwriting an existing file. Implement `make init`, `build`, `up`, `down`, `ps`, `logs`.

**Accept:** `docker compose config -q` passes; `make up` brings all twelve experts and the proxy to healthy.

## Step 8 — Workspace and a minimal registry

- `scripts/workspace-init.sh <repoId> <git-url | path | --demo>` clones into `workspace/<repoId>/repo` and creates `trees/` and `landing/`. `--demo` copies `fixtures/demo-repo` and runs `git init`. It refuses repositories with submodules or LFS for now and says why.
- `fixtures/demo-repo`: a small HTTP service with tests, a linter, and a formatter, all runnable offline after one install.
- `state/registry/<repoId>/` holds the control files. In this stage they are copied by hand for the demo repository from `registry.example/demo/`:

```yaml
# repo.yaml
id: demo
defaultBranch: main
planApprovalAbove: 3        # tasks; plans larger than this wait for a human

# ownership.yaml
version: 1
experts:
  backend: { writes: ["src/*"] }
  qa:      { writes: ["tests/*", "*.test.*"] }
  docs:    { writes: ["README*", "docs/*"] }
shared:    ["package.json", "pnpm-lock.yaml"]     # allowed for any scoped expert, flagged for review
protected: [".github/*"]                          # no expert may change these

# checks.yaml
version: 1
setup:  ["pnpm install --frozen-lockfile"]
checks:
  - { id: format,    run: "pnpm format:check", timeoutSec: 300 }
  - { id: lint,      run: "pnpm lint",         timeoutSec: 300 }
  - { id: typecheck, run: "pnpm typecheck",    timeoutSec: 600 }
  - { id: test,      run: "pnpm test",         timeoutSec: 900 }
```

Put Zod schemas for these three files in `dispatcher/src/registry-schema.ts`, with tests. The registry directory is not mounted into any expert.

**Accept:** `make workspace ARGS="demo --demo"` produces the clone; a fixture repository with a submodule is refused; the example control files validate.

## Step 9 — Smoke

`scripts/smoke.sh` (`make smoke`) checks every enabled expert and fails on the first expert that misses any item. It makes no model calls.

- The container is `healthy` and runs as `AGENT_UID`.
- `/api/agent` lists its persona; `/api/skill` lists every skill `fleet.yaml` names for it.
- `/api/mcp` shows each server as connected or disabled; none failed.
- The OpenCode log contains no line with `configuration normalization diagnostic`.
- `/etc/agency` is not writable. For a `ro` expert `/work` is not writable; for a `scoped` expert it is.
- It accepts its own password and rejects another expert's.

**Accept:** `make smoke` passes for all twelve.

## Acceptance checks for this stage

Under `scripts/accept/1b/`:

| Check | Passes when |
|---|---|
| `01-render-check` | `make render-check` exits 0. |
| `02-compose-config` | `docker compose config -q` exits 0. |
| `03-compose-hardening` | Parsed from the generated file: every expert has `cap_drop: [ALL]`, `no-new-privileges`, `pids_limit`, `cpus`, `mem_limit`, only the `fleet` network, no `ports`; every bind has `:z`; config mounts are read-only; `ro` experts mount `/work` read-only; nothing mounts a daemon socket or sets `privileged`. |
| `04-images-pinned-and-built` | Twelve images build; no Dockerfile has a floating version. |
| `05-up-healthy` | After `make up`, twelve experts and the proxy are healthy. |
| `06-smoke` | `make smoke` exits 0. |
| `07-egress-allow-deny` | From inside two different experts: a request to an allowlisted host succeeds; a request to a host not on the list fails; both appear in the proxy log with the right expert's name and the right verdict. |
| `08-no-direct-route` | From inside an expert, a request that bypasses the proxy to an external address fails, and a request through the proxy to a private or metadata address is denied. |
| `09-unique-passwords` | Every expert rejects every other expert's password. |
| `10-protocol-examples-parse` | The step 3 test passes. |
| `11-workspace-demo` | Step 8's Accept line. |
| `12-no-published-ports` | No container in the project has a host port binding. |

Red proofs worth the effort here: stop the proxy for `07`; attach an expert to `outside` for `08`; give two experts the same password for `09`; hand-edit a generated file for `01`.

## Report

Write `docs/reports/stage-1b.md` in the format of shared context 4.4. Include the proxy choice and why, MCP servers left disabled and why, and any expert tool you could not pin or install. Then stop.
