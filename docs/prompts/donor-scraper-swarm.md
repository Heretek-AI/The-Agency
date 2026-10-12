# Bring the contract client and guard plugin home to `scraper-swarm`

This prompt is run inside the `scraper-swarm` repository, not inside The Agency.

Attach `00-shared-context.md` from The Agency as well. Its sections 3 (operating rules), 4 (verification rules), and 5 (OpenCode v2 facts) apply here. Its repository layout and stage list do not.

## Background

A monorepo, `heretek-opencode`, copied this project and rewrote parts of it. Most of that is being discarded, and the monorepo will be archived. Two pieces are new work that exists nowhere else and belongs here:

- `packages/opencode-gateway/packages/contract-client`: a TypeScript package with Zod schemas for the four gateway tools, a typed MCP client, SSRF helpers, a circuit breaker, a cache, and golden-fixture checks. This repository's issue #19 asks for the contract as a package.
- `packages/opencode-gateway/packages/opencode-guard`: the OpenCode plugin rewritten against the v2 plugin API. This repository's issue #18 asks for that rewrite; `packages/opencode-plugin` here is the older one.

One piece must stay behind: the monorepo's `apps/gateway`, a TypeScript rewrite of the gateway. Its `search`, `extract_structured`, and `research_report` tools return invented results ("Result 1 for …", `https://example.com/r1`, `extracted:<field>`, "Synthesis pending engine results") as successes. The real gateway is the Python one in this repository.

That matters for the fixtures. Golden fixtures in the monorepo may have been recorded against those placeholder backends. A fixture is only worth having if it came from the real gateway.

The salvage source is `heretek-opencode` at commit `14f297a`. Its path is in `SALVAGE_SRC` (by default `../Heretek-AI-opencode/rebuild_staging`). It is read-only.

## Ask the user

- The URL of a running gateway to test against, and an API key scoped for testing. A stack is already running on the development host. Do not restart, reconfigure, or stop it.
- Which engines are deployed there, so that a missing engine is reported as not deployed instead of failing.

Without a gateway to test against, steps 1 and 3 can be done and step 2's live conformance is reported as not performed. The package is not ready for release in that state; say so.

## Rules

- Work on a new branch, `repatriate-contract-client`. Commit locally. Never push or tag. Tags and pushes to `main` are human-only in this repository.
- Use this repository's own tooling. It is a pnpm workspace with Python under `uv`; the monorepo used Bun. Convert tests to the runner this repository already uses instead of adding a second one.
- Run the existing test suites first and record the baseline. They pass the same way at the end.
- Shared context section 4 applies. In particular: a conformance test that cannot reach the gateway exits 77 and is reported as skipped; it does not pass.

## Step 1 — Contract client

1. Copy `$SALVAGE_SRC/packages/opencode-gateway/packages/contract-client` to `packages/contract-client`. Add it to the workspace. Pin every dependency exactly.
2. Port its tests to this repository's test runner. All of them run in CI.
3. Compare the monorepo's `contract/v1/fixtures` with this repository's `contract/` directory. This repository's fixtures are the source of truth where both exist. Report every difference.
4. Reject any fixture that contains a placeholder marker: `Result 1 for`, `example.com/r`, `extracted:`, `Synthesis pending engine results`. Add a test that fails if one ever appears.
5. Re-derive each fixture's content hash from its bytes and fail on a mismatch.

**Accept:** the package's tests pass under this repository's runner; the placeholder-marker test passes and was shown red once; the fixture comparison is in the report.

## Step 2 — Conformance against the real gateway

Write a conformance suite, run by its own command, that uses the contract client against the gateway the user named:

- `initialize` negotiates a supported protocol version and returns the contract header;
- `tools/list` returns the tools for the key's scopes;
- each of `search`, `fetch`, `extract_structured`, and `research_report` returns a response the package's schemas accept, with a provenance envelope whose content hash matches its content;
- a request to a private address is denied with the documented error code;
- a wrong key is refused.

For each tool, assert that the result is real: `search` results do not match the placeholder markers and their URLs are not all on one example domain; `fetch` content matches a direct fetch of a stable page closely enough to show it was retrieved.

A tool whose engine the user said is not deployed is reported as skipped for that reason. Any other failure is a failure.

If the real gateway's responses do not fit the package's schemas, the gateway is the authority for contract v1. Change the package, and list each change in the report. Do not change the gateway to fit the package without the user's say.

Where a fixture is missing, record it from a real response and note the gateway version it came from.

**Accept:** the conformance suite passes against the running gateway, with skips only for engines not deployed; or it is reported as not performed.

## Step 3 — Guard plugin

1. Copy `$SALVAGE_SRC/packages/opencode-gateway/packages/opencode-guard` to `packages/opencode-guard`. Pin `@opencode/plugin` exactly at 2.0.26. Port its tests.
2. Keep `packages/opencode-plugin` until the new one is proven, then remove it in its own commit so the history shows the replacement.
3. Prove it in a real OpenCode 2.0.26 instance, in a container, with a config that loads the plugin:
   - the gateway appears in `/api/mcp` as a connected server;
   - a built-in web fetch to an arbitrary URL is blocked with the guard's message;
   - a gateway tool call goes through.
4. The pure guard logic matches text. The audit of the monorepo found that `curl https://host/x` was blocked while `curl host/x`, `scp file user@host:`, and a redirect to `/dev/tcp/…` were allowed. Add tests for those three and close them. Then state in the plugin's README, plainly, that this is a guard against accidents and that the boundary is network policy: the expert must have no route out except the gateway.

**Accept:** the tests pass, including the three new cases, each shown red before the fix; the three live observations are in the report with their evidence.

## Step 4 — What not to bring

Do not copy from the monorepo:

- `apps/gateway` (the TypeScript rewrite);
- `deploy/`, `catalog/`, or `apps/panel-api`. They are copies of this repository's own files. `apps/panel-api` differs from this repository's in two places: diff them, and report whether either difference is a fix worth taking. Take nothing without reviewing it.

Add a test or CI check that fails if any tool handler in this repository returns one of the placeholder markers.

**Accept:** none of those directories was copied; the placeholder check exists and passes.

## Step 5 — Release readiness note

Write `docs/contract-v1-readiness.md`: what issues #18, #19, and #20 asked for, what now exists, what the conformance run showed, and what remains before a `v1.0.0` tag. Creating the tag is for the owner.

The Agency will consume this gateway through its MCP contract only, behind a switch (`AGENCY_WEB_MODE=swarm`). Note in the readiness document the tool names, the header, and the URL and key variables it will need, so the two projects agree.

## Acceptance

The work is finished when:

- the baseline test suites pass as before;
- `packages/contract-client` and `packages/opencode-guard` exist with their tests passing under this repository's runner;
- the conformance suite ran against the real gateway, or is reported as not performed;
- no fixture and no handler contains a placeholder marker, and the check for that can fail;
- the guard was observed working in OpenCode 2.0.26;
- nothing from the "not to bring" list was copied;
- the running stack on the host was not touched;
- nothing was pushed or tagged.

Write `docs/reports/repatriation.md` with: what was brought and from which commit, the baseline and final test results, the fixture differences, the conformance results per tool, schema changes made to fit the real gateway, the three guard cases, what was not performed, and what is left for the owner.
