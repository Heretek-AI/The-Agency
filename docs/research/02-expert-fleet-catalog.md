# The Agency — Expert Fleet Catalog

Research date: 2026-10-12. Companion to `01-architecture-analysis.md`. Config snippets use the OpenCode **v2** schema (verified against `review/opencode`, version 2.0.26).

The roster has 25 experts: 14 core experts that stay running and 11 extended experts that the Dispatcher starts on demand.

It was revised after the design review recorded in section 3 of `01-architecture-analysis.md`. The two QA judges were added, every expert now runs on one model, write scopes come from an approved ownership map per repository, and experts reach the internet only through an allowlist proxy.

---

## 1. Conventions shared by every expert

### 1.1 Model tiers

Every expert runs on one model, set by `AGENCY_MODEL`, with one key in `OPENCODE_API_KEY`. The model is an OpenCode Go id (`opencode-go/<model-id>`) or a Zen id (`opencode/<model-id>`). The exact string must match what `opencode models` prints, so the build verifies it.

The tier names stay in the manifest and in the cards below. They record which experts would get a stronger or cheaper model if the single variable is ever split, and all of them resolve to `AGENCY_MODEL` today.

| Tier | Intended for |
|---|---|
| Frontier | Planning, architecture, security, root-cause analysis |
| Standard | Implementation work and QA judgement |
| Fast | Reconnaissance, docs, high-volume low-risk tasks |
| Review | The reviewer. A different model family than the authors would give independent failure modes. |

Which model to choose is an open question the eval suite answers. Under OpenCode Go's usage caps the choice also decides how many missions fit in a window.

### 1.2 Access classes

| Class | `/work` mount | Where output goes | Enforced by |
|---|---|---|---|
| `ro` | read-only | Reports and files under `/artifacts/<taskId>/` | The mount itself |
| `scoped` | read-write | Commits on the task branch inside the task worktree, limited to the expert's write globs | `edit` permission rules, plus the Dispatcher's check that every changed path matches the globs |

No expert holds git remote credentials, and no expert may push or merge. Landing happens in the Dispatcher, which also holds the bot token used to open draft pull requests.

The write globs listed for each expert below are starting proposals. For every registered repository the scout proposes an ownership map, a human approves it, and the approved copy in the fleet-side registry is what the Dispatcher enforces: it passes the task's allowed paths as session permissions and checks the resulting diff against them. Changes to shared files such as manifests and lockfiles are allowed but flagged for review.

### 1.3 Baseline for all experts

- **Image:** Ubuntu 24.04, non-root `agent` user, `tini`, `git`, `ripgrep`, `fd`, `jq`, `yq`, `curl`, Node LTS, Python 3 with `uv`, and the pinned `opencode` binary.
- **Built-in tools:** `read`, `glob`, `grep`, `shell`, `skill`, `webfetch`, `websearch`. `question` is denied because nobody is there to answer. `subagent` is allowed for `explore` only.
- **No `fleet` MCP server.** Experts cannot dispatch to each other. An expert that needs another expert says so in the handoff section of its result, and the Director routes it.
- **MCP budget:** at most three MCP servers per expert. Code Mode stays on (the v2 default), so MCP tools cost a catalog line each rather than a full schema.
- **Config is mounted read-only** and project config is disabled (`OPENCODE_DISABLE_PROJECT_CONFIG=1`).
- **Network:** experts sit on an internal network with no direct route out. An allowlist proxy is the only exit (the model provider, package registries, the remote MCP endpoints in use, and a configurable list of documentation hosts). Until Scraper Swarm is adopted, `webfetch` and `websearch` reach allowlisted hosts only.
- **Environment:** an expert reaches its task's throwaway stack (app, database, services) over the network through the environment runner. It never has access to a container daemon.

### 1.4 Baseline permission ruleset

Rules are evaluated last-match-wins and anything unmatched would `ask`, so the list starts with deny-all and never uses `ask`.

```jsonc
"permissions": [
  { "action": "*",                  "resource": "*",              "effect": "deny"  },
  { "action": "read",               "resource": "*",              "effect": "allow" },
  { "action": "glob",               "resource": "*",              "effect": "allow" },
  { "action": "grep",               "resource": "*",              "effect": "allow" },
  { "action": "skill",              "resource": "*",              "effect": "allow" },
  { "action": "webfetch",           "resource": "*",              "effect": "allow" },
  { "action": "websearch",          "resource": "*",              "effect": "allow" },
  { "action": "subagent",           "resource": "explore",        "effect": "allow" },
  { "action": "external_directory", "resource": "/work/*",        "effect": "allow" },
  { "action": "external_directory", "resource": "/artifacts/*",   "effect": "allow" },
  { "action": "edit",               "resource": "/artifacts/*",   "effect": "allow" },
  { "action": "read",               "resource": "*.env",          "effect": "deny"  },
  { "action": "read",               "resource": "*.env.*",        "effect": "deny"  },
  { "action": "read",               "resource": "*.env.example",  "effect": "allow" },
  { "action": "shell",              "resource": "*",              "effect": "allow" },
  { "action": "shell",              "resource": "git push*",      "effect": "deny"  },
  { "action": "shell",              "resource": "git merge*",     "effect": "deny"  },
  { "action": "shell",              "resource": "git rebase*",    "effect": "deny"  },
  { "action": "shell",              "resource": "git switch*",    "effect": "deny"  },
  { "action": "shell",              "resource": "git checkout*",  "effect": "deny"  },
  { "action": "shell",              "resource": "git worktree*",  "effect": "deny"  },
  { "action": "shell",              "resource": "git tag*",       "effect": "deny"  }
  // then, per expert: "<mcpserver>_*" allows.
  // Edit rules for repository paths are not static: the Dispatcher passes them per task
  // as session permissions, built from the repository's approved ownership map.
]
```

The shell deny rules are text matching and are easy to get around. They exist to stop accidents. The boundary that holds is the mount, the absence of credentials, and the Dispatcher's diff check.

---

## 2. MCP server registry

Each expert picks from this list. "Verified" means the launch command or key flag was confirmed against a current source during this research; "recall" means it comes from prior knowledge and the build must confirm it (`npm view`, `uvx --help`, or an HTTP probe) before enabling it. Pin every version.

| Key | Server | Launch | Auth | Safe default | Status |
|---|---|---|---|---|---|
| `fleet` | The Agency Dispatcher | remote `http://dispatcher:8080/mcp` | bearer token | Director only; `codemode: false`, `oauth: false` | built here |
| `context7` | Context7 library docs | remote `https://mcp.context7.com/mcp`, or `npx -y @upstash/context7-mcp` | optional API key | read-only | recall |
| `deepwiki` | DeepWiki repository Q&A | remote `https://mcp.deepwiki.com/mcp` | none | read-only | recall |
| `playwright` | Microsoft Playwright MCP | `npx -y @playwright/mcp --headless --isolated --no-sandbox` | none | isolated in-memory profile | verified |
| `chrome-devtools` | Chrome DevTools MCP | `npx -y chrome-devtools-mcp --headless --isolated` | none | isolated profile | recall |
| `serena` | Serena (LSP-backed symbol navigation and edits) | `uvx --from git+https://github.com/oraios/serena serena start-mcp-server --context ide-assistant --project <dir>` | none | has edit tools; give only to `scoped` experts | verified |
| `postgres` | Postgres MCP Pro (`crystaldba/postgres-mcp`) | `uvx postgres-mcp --access-mode=restricted`, DSN in `DATABASE_URI` | DSN | restricted (read-only) mode | project verified; flag is recall |
| `dbhub` | Bytebase DBHub (Postgres, MySQL, MariaDB, SQL Server, SQLite) | `npx -y @bytebase/dbhub --transport stdio --dsn <dsn> --readonly` | DSN | `--readonly` | project verified; flags are recall |
| `github` | GitHub MCP | remote `https://api.githubcopilot.com/mcp/` with a PAT header and toolset headers, or the `github-mcp-server stdio` binary | PAT | read-only, minimal toolsets | recall |
| `semgrep` | Semgrep | `semgrep mcp` (bundled with recent Semgrep CLI releases) | optional token | scans only | recall |
| `trivy` | Aqua Trivy MCP | `trivy plugin install mcp`, then `trivy mcp` | none | scans only | verified |
| `terraform` | HashiCorp Terraform MCP | `terraform-mcp-server` binary over stdio | optional HCP token | leave `ENABLE_TF_OPERATIONS` unset so plan and apply stay off | verified |
| `kubernetes` | `containers/kubernetes-mcp-server` | `npx -y kubernetes-mcp-server --read-only` | kubeconfig | `--read-only` | verified |
| `grafana` | `grafana/mcp-grafana` | `mcp-grafana` binary over stdio | `GRAFANA_URL` and a service account token | viewer-role token | verified |
| `sentry` | Sentry MCP | `npx -y @sentry/mcp-server` with an access token, or remote `https://mcp.sentry.dev/mcp` | token or OAuth | read scopes | recall |
| `figma` | Figma MCP | remote `https://mcp.figma.com/mcp` | OAuth | disabled until authorized | recall |
| `huggingface` | Hugging Face MCP | remote `https://huggingface.co/mcp` | token header | read scopes | recall |
| `linear` | Linear MCP | remote `https://mcp.linear.app/mcp` | OAuth | disabled until authorized | recall |
| `scraper-swarm` | Scraper Swarm gateway (Heretek-AI) | remote `POST /mcp` on the self-hosted gateway | scoped agent key | adopted later as the only web path, replacing built-in `webfetch` and `websearch` | README read, not tested |

Three practical notes:

- **OAuth-only remote servers** need an interactive `opencode mcp auth <name>` with a callback, which is awkward in a headless container. They ship with `"disabled": true`. Prefer servers that take a token in a header or environment variable.
- **Servers distributed as Docker images** cannot be launched with `docker run` from inside an expert, because experts have no Docker socket. Install the binary in the expert image, or run the server as its own compose service and reference it as `type: "remote"`.
- **A server with no credentials configured stays disabled.** An expert should never start with a failing MCP server in its catalog.

---

## 3. Core fleet (always running)

### 3.1 `director` — Orchestrator

- **Role:** Leads each mission. Picks a playbook, writes the plan and the task briefs, reads results, decides accept or rework within the playbook's limits, and reports. There is one Director session per mission; for triggered missions the Dispatcher creates it.
- **Handles:** Decomposition, briefs, sequencing, reading results and diffs, rework decisions, the final report. It cannot skip a playbook gate, and landing is done by the Dispatcher, not by the Director.
- **Delegates:** Everything else. It never edits files, and its shell is limited to read-only git commands.
- **Model:** Frontier. **Access:** `ro`.
- **MCP:** `fleet` only.
- **Skills:** `task-decomposition` (slice by owner and write path), `dispatch-brief` (objective, context, constraints, acceptance criteria), `playbook-selection`, `rework-decisions`, `mission-reporting`.
- **Permissions:** baseline minus `shell *`; allow `shell` for `git log*`, `git status*`, `git diff*`, `git show*`; allow `fleet_*`; deny `subagent`.

### 3.2 `scout` — Reconnaissance and research

- **Role:** Cheap, fast context gathering so other experts and the Director do not spend their context on it.
- **Handles:** Code maps ("where does X live, who calls it"), dependency and stack inventories, summaries of unfamiliar modules, external research briefs with sources.
- **Delegates:** Any judgement call about design, and every change.
- **Model:** Fast. **Access:** `ro`.
- **MCP:** `context7`, `deepwiki`.
- **Skills:** `codebase-mapping`, `research-brief` (claims with sources and confidence).
- **Image tools:** `ast-grep`, `scc`, `tree`.

### 3.3 `architect` — System design

- **Role:** Owns structure: module boundaries, data flow, API contracts at the design level, technology choices, and the decision record.
- **Handles:** ADRs, architecture docs and diagrams, design reviews of proposed changes, breaking large work into components with interfaces. It also breaks the tie when the two QA judges disagree, and its decision is recorded with reasons.
- **Delegates:** Implementation to the builders; detailed contract files to `api`; threat modeling to `security`.
- **Model:** Frontier. **Access:** `scoped`.
- **Writes:** `docs/adr/*`, `docs/architecture/*`.
- **MCP:** `context7`, `deepwiki`.
- **Skills:** `adr-writing`, `c4-modeling`, `tradeoff-analysis` (options, criteria, decision, consequences), `interface-first-decomposition`.
- **Image tools:** `scc`, `dependency-cruiser`, `madge`.

### 3.4 `product` — Requirements

- **Role:** Turns intent into testable requirements.
- **Handles:** User stories, acceptance criteria in Given/When/Then form, scope cuts, backlog slicing, issue grooming.
- **Delegates:** Technical design to `architect`; estimates to the owning builder.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** `docs/product/*`, `docs/requirements/*`.
- **MCP:** `github` (issues toolset, read-only by default), `linear` (disabled by default).
- **Skills:** `user-story-writing`, `acceptance-criteria`, `scope-slicing`.
- **Image tools:** `gh`.

### 3.5 `frontend` — UI engineering

- **Role:** Implements user interfaces.
- **Handles:** Components, client state, styling, client-side data fetching, accessibility in the implementation, colocated component tests, visual verification with screenshots.
- **Delegates:** API changes to `backend`; end-to-end suites to `qa`; design-system decisions and audits to `design`.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** the project's frontend roots (default `web/*`, `apps/web/*`, `src/components/*`, `src/pages/*`, `src/app/*`, `src/styles/*`, `public/*`).
- **MCP:** `playwright`, `context7`; `figma` disabled by default.
- **Skills:** `component-implementation`, `a11y-in-implementation`, `visual-verification` (before and after screenshots into `/artifacts`), `frontend-state-conventions`.
- **Image tools:** `pnpm`, `bun`, Chromium with Playwright system dependencies, `@axe-core/cli`.

### 3.6 `backend` — Services and APIs

- **Role:** Implements server-side behavior.
- **Handles:** Endpoints, business logic, integrations, background jobs, colocated unit tests, error handling and logging in application code.
- **Delegates:** Schema changes and migrations to `dba`; pipelines and deployment to `platform`; contract files to `api`.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** the project's backend roots (default `src/*`, `server/*`, `api/*`, `services/*`, `internal/*`, `pkg/*`, `cmd/*`, `lib/*`).
- **MCP:** `context7`, `serena`; `dbhub` read-only against the dev database, disabled until a DSN is set.
- **Skills:** `endpoint-implementation`, `error-handling-conventions`, `dependency-addition-policy`, `test-with-the-change`.
- **Image tools:** `pnpm`; language toolchains chosen by build args (`go`, `rustup`, JDK); `hurl`, `httpie`, `make`.

### 3.7 `dba` — Persistence

- **Role:** Owns the data layer.
- **Handles:** Schema design, reversible migrations (expand then contract), index design, query review with `EXPLAIN`, data-safety checks, seed data.
- **Delegates:** Application query code to `backend`; database provisioning to `platform`. It works against the dev database only.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** `migrations/*`, `db/*`, `prisma/*`, `schema/*`, `*.sql`.
- **MCP:** `postgres` in restricted mode, or `dbhub` for other engines. Both ship disabled: a task's database lives in its own throwaway stack and its address reaches the expert as a session variable, which an MCP server started with the container may not see. Until that is shown to work, the DBA uses `psql` with the task's `DATABASE_URL`.
- **Skills:** `migration-authoring`, `query-plan-review`, `index-design`, `data-safety-checklist`.
- **Image tools:** `psql`, `pg_dump`, `sqlite3`, `mysql` client, `sqlfluff`, `atlas`.

### 3.8 `platform` — DevOps and infrastructure

- **Role:** Owns build, delivery, and runtime definitions.
- **Handles:** Dockerfiles, compose files, CI/CD workflows, infrastructure as code, Kubernetes manifests and Helm charts, build scripts.
- **Delegates:** Application code to the builders; applying to real environments and rotating secrets to a human.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** `Dockerfile*`, `*compose*.yml`, `.github/*`, `.gitlab-ci.yml`, `infra/*`, `deploy/*`, `k8s/*`, `helm/*`, `terraform/*`, `Makefile`, `scripts/*`.
- **MCP:** `terraform`; `kubernetes` read-only, disabled until a kubeconfig is mounted; `github` actions toolset, read-only.
- **Skills:** `dockerfile-hardening`, `ci-pipeline-authoring`, `iac-plan-review`, `k8s-manifest-conventions`.
- **Image tools:** `hadolint`, `actionlint`, `shellcheck`, `shfmt`, `yamllint`, `terraform` or `tofu`, `tflint`, `kubectl`, `helm`, `kustomize`, `kubeconform`, Docker CLI with buildx.
- **Note:** No access to a container daemon. Building images and running stacks happen in the environment runner, which only the Dispatcher can call.

### 3.9 `security` — Application security

- **Role:** Finds and explains security problems. It does not fix them.
- **Handles:** Threat models, SAST triage, dependency and container scanning, secret scanning, security review of diffs, IaC misconfiguration review. Output is a severity-ranked report plus SARIF.
- **Delegates:** Fixes to the owning expert, with a suggested patch in the report.
- **Model:** Frontier. **Access:** `ro`.
- **MCP:** `semgrep`, `trivy`.
- **Skills:** `threat-modeling` (STRIDE per trust boundary), `sast-triage` (confirm reachability before reporting), `dependency-risk-review`, `secret-exposure-procedure`, `security-report-format`.
- **Image tools:** `semgrep`, `trivy`, `gitleaks`, `osv-scanner`, `syft`, `grype`, `checkov`.

### 3.10 `qa` — Test author

- **Role:** Writes the tests a change is judged by, independently of the builder.
- **Handles:** Failing acceptance tests written from the brief before the build lands, integration and end-to-end tests, fixtures, flake triage, coverage gap analysis, reproducing reported defects as failing tests.
- **Delegates:** Production-code fixes to the owning expert; the pass or fail judgement to the two QA judges.
- **Model:** Standard. **Access:** `scoped`.
- **Writes:** `tests/*`, `test/*`, `e2e/*`, `*.test.*`, `*.spec.*`, `*__tests__*`, `playwright.config.*`, `vitest.config.*`, `jest.config.*`.
- **MCP:** `playwright`.
- **Skills:** `test-strategy`, `e2e-authoring`, `flake-triage`, `coverage-gap-analysis`, `bug-report-format`.
- **Image tools:** `pnpm`, Chromium with Playwright dependencies, `pytest` through `uv`.

### 3.11 `reviewer` — Code review

- **Role:** Independent review of a task's diff before it is integrated.
- **Handles:** Correctness, regressions, maintainability, test adequacy, adherence to repo conventions. Output is a verdict (approve or request changes) with findings by severity and `file:line`.
- **Delegates:** Deep security analysis to `security`; the fixes to the author.
- **Model:** Review tier. **Access:** `ro`.
- **MCP:** none by default, which gives it the leanest context in the fleet. `github` pull-request toolset is available but disabled.
- **Skills:** `review-rubric`, `diff-reading-procedure` (read the whole changed function, then its callers), `review-report-format`.
- **Image tools:** `delta`, `difftastic`, `scc`.

### 3.12 `docs` — Technical writing

- **Role:** Owns user-facing and developer-facing documentation.
- **Handles:** README, guides, tutorials, API reference prose, troubleshooting pages. Every command it documents gets run first.
- **Delegates:** ADRs to `architect`; requirements to `product`; changelog and release notes to `release`.
- **Model:** Fast, raised to Standard for conceptual guides. **Access:** `scoped`.
- **Writes:** `docs/guides/*`, `docs/reference/*`, `docs/tutorials/*`, `README*`, `CONTRIBUTING*`, `mkdocs.yml`.
- **MCP:** `context7`.
- **Skills:** `docs-structure` (tutorial, how-to, reference, explanation), `reference-from-source`, `verify-what-you-document`.
- **Image tools:** `markdownlint-cli2`, `vale`, `lychee`, `prettier`.

### 3.13 `qa-functional` — Functional judge

- **Role:** Decides whether the change does what the brief and its acceptance criteria say. Its verdict blocks landing.
- **Handles:** Running the acceptance tests and the application in the task's environment stack, checking each criterion, and returning a verdict with evidence per criterion.
- **Delegates:** Fixes to the author. It writes nothing to the repository.
- **Model:** Standard. **Access:** `ro`.
- **MCP:** `playwright`.
- **Skills:** `criterion-by-criterion-verification`, `verdict-format`.
- **Image tools:** `pnpm`, Chromium with Playwright dependencies, `hurl`.

### 3.14 `qa-adversarial` — Adversarial judge

- **Role:** Tries to break the change. Its verdict blocks landing.
- **Handles:** Edge cases, invalid and hostile input, concurrency, error paths, and regressions in neighbouring behavior. Every failure comes with reproduction steps.
- **Delegates:** Fixes to the author. It writes nothing to the repository.
- **Model:** Standard. **Access:** `ro`.
- **MCP:** `playwright`.
- **Skills:** `adversarial-test-design`, `regression-probing`, `verdict-format`.
- **Image tools:** `pnpm`, Chromium with Playwright dependencies, `hurl`.

The two judges run in separate containers and never see each other's verdict. When they disagree, the architect decides.

---

## 4. Extended fleet (started on demand)

### 4.1 `api` — Contracts

- **Role:** Owns machine-readable interface contracts.
- **Handles:** OpenAPI, GraphQL, and protobuf definitions; contract linting; breaking-change detection; contract tests; mock servers.
- **Delegates:** Implementing the contract to `backend`; consuming it to `frontend`.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `openapi/*`, `proto/*`, `graphql/*`, `*.graphql`, `contracts/*`.
- **MCP:** `context7`.
- **Skills:** `openapi-design-rules`, `breaking-change-review`, `contract-testing`.
- **Image tools:** `spectral`, `oasdiff`, `buf`, `schemathesis`, `hurl`, `prism`.

### 4.2 `sre` — Reliability and observability

- **Role:** Owns how the system is observed and operated.
- **Handles:** SLOs, alert rules, dashboards as code, runbooks, incident timelines and postmortems, capacity notes.
- **Delegates:** Instrumentation inside application code to the builders; infrastructure changes to `platform`.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `ops/*`, `monitoring/*`, `alerts/*`, `dashboards/*`, `docs/runbooks/*`.
- **MCP:** `grafana`, `sentry`. Both stay disabled until tokens exist.
- **Skills:** `slo-definition`, `symptom-based-alerting`, `runbook-format`, `postmortem-format`.
- **Image tools:** `promtool`, `amtool`, `logcli`.

### 4.3 `performance` — Performance engineering

- **Role:** Measures, then recommends.
- **Handles:** Benchmarks, load tests, profiling, performance budgets, regression reports with numbers and method.
- **Delegates:** The optimization itself to the owning builder, unless it is confined to benchmark code.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `bench/*`, `perf/*`, `k6/*`.
- **MCP:** `chrome-devtools`.
- **Skills:** `benchmark-methodology` (warm-up, variance, environment notes), `load-test-design`, `perf-report-format`.
- **Image tools:** `k6`, `hyperfine`, `lighthouse`, `py-spy`, Chromium.

### 4.4 `debugger` — Root-cause analysis

- **Role:** Explains why something is broken.
- **Handles:** Reproduction, bisection, instrumentation, a written hypothesis log, a root-cause report with the minimal failing case.
- **Delegates:** The fix to the owning expert.
- **Model:** Frontier. **Access:** `scoped`. **Writes:** `tests/repro/*` only.
- **MCP:** `chrome-devtools`; `sentry` disabled until a token exists.
- **Skills:** `hypothesis-driven-debugging`, `minimal-repro`, `bisect-procedure`, `rca-report-format`.
- **Image tools:** `gdb`, `strace`, `ltrace`, language debuggers matching the build args.

### 4.5 `refactor` — Mechanical change at scale

- **Role:** Behavior-preserving restructuring.
- **Handles:** Codemods, renames, module moves, dependency and framework upgrades, dead-code removal. Characterization tests come first.
- **Delegates:** Any change that alters behavior to the owning builder.
- **Model:** Standard. **Access:** `scoped`. **Writes:** the union of the `frontend` and `backend` roots.
- **MCP:** `serena`.
- **Skills:** `behavior-preserving-refactor`, `codemod-authoring`, `upgrade-playbook`.
- **Image tools:** `ast-grep`, `comby`, `jscodeshift`, `knip`, `ruff`.

### 4.6 `data` — Data engineering and analytics

- **Role:** Owns pipelines and analytical models.
- **Handles:** Transformations, dbt models, warehouse schemas, data quality tests, analytical SQL.
- **Delegates:** Operational database schema to `dba`; pipeline infrastructure to `platform`.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `data/*`, `pipelines/*`, `dbt/*`, `analytics/*`, `notebooks/*`.
- **MCP:** `dbhub` read-only against the warehouse.
- **Skills:** `dbt-modeling-conventions`, `data-quality-tests`, `idempotent-pipelines`.
- **Image tools:** `duckdb`, `dbt-core`, `sqlfluff`, `polars` through `uv`.

### 4.7 `ml` — AI and ML engineering

- **Role:** Owns model-facing code.
- **Handles:** Prompts, evaluation suites, retrieval pipelines, model client code, serving wrappers. Evals are written before prompt changes.
- **Delegates:** Compute and serving infrastructure to `platform`; upstream data to `data`.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `ml/*`, `models/*`, `evals/*`, `prompts/*`.
- **MCP:** `huggingface`, `context7`.
- **Skills:** `eval-first-development`, `prompt-versioning`, `rag-design-checklist`.
- **Image tools:** Python with `uv`, `promptfoo`, `jupyter nbconvert`.

### 4.8 `mobile` — Mobile engineering

- **Role:** Implements mobile clients.
- **Handles:** React Native, Flutter, Kotlin, and Swift source; platform conventions; offline behavior.
- **Delegates:** Backend changes to `backend`; store submission to a human.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `mobile/*`, `apps/mobile/*`, `android/*`, `ios/*`.
- **MCP:** `context7`.
- **Skills:** `platform-guidelines`, `offline-first-patterns`, `store-release-checklist`.
- **Image tools:** Node; Android command-line tools and Flutter behind build args.
- **Limit:** A Linux container has no Xcode and no iOS simulator, and an Android emulator needs KVM passthrough. Treat this expert as code-only unless a device farm is wired in.

### 4.9 `design` — UX, design system, accessibility

- **Role:** Owns the design system and audits the experience.
- **Handles:** Design tokens, component usage guidance, WCAG audits, heuristic UX reviews, interface copy.
- **Delegates:** Component implementation to `frontend`.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `design/*`, `docs/design/*`, `tokens/*`.
- **MCP:** `playwright`; `figma` disabled until authorized.
- **Skills:** `wcag-audit-procedure`, `design-token-conventions`, `ux-heuristic-review`, `ui-copy-style`.
- **Image tools:** `@axe-core/cli`, `pa11y`, `lighthouse`, Chromium.

### 4.10 `release` — Release management

- **Role:** Owns what ships and how it is described.
- **Handles:** Version decisions, changelog, release notes, tagging, dependency update batches, release checklists.
- **Delegates:** Fixes found during release checks to the owning expert; pushing and opening the draft pull request to the Dispatcher; merging and publishing to a human.
- **Model:** Standard. **Access:** `scoped`. **Writes:** `CHANGELOG*`, `release/*`, `.release-please*`, version manifests.
- **MCP:** `github` (repos, pull requests, releases). Write tools need an explicit token.
- **Skills:** `semver-decision`, `changelog-authoring`, `release-checklist`.
- **Image tools:** `gh`, `git-cliff`.
- **Permissions:** the only expert whose ruleset re-allows `git tag*`.

### 4.11 `compliance` — Licensing and privacy

- **Role:** Checks obligations rather than vulnerabilities.
- **Handles:** License inventory and compatibility, SBOM generation, PII data-flow review, mapping controls to a checklist.
- **Delegates:** Remediation to the owning expert; legal judgement to a human.
- **Model:** Standard. **Access:** `ro`.
- **MCP:** none.
- **Skills:** `license-compatibility-review`, `sbom-generation`, `pii-dataflow-review`.
- **Image tools:** `syft`, `trivy` (license scanning), `reuse`.

---

## 5. Expert packs

An expert pack is an expert that lives outside this repository and is added to a fleet as one unit. The layout under `experts/<name>/` is already nearly a pack, so the contract is small:

| Part | Content |
|---|---|
| `pack.yaml` | Name, version, the OpenCode version range it was tested against, required environment variables, and its roster entry (profile, tier, access, proposed write globs, MCP servers) |
| `Dockerfile` | Built on the fleet base image; installs the pack's toolchain, plugin, and any MCP server it needs, all pinned |
| `config/agents/`, `config/skills/` | Persona and skills |
| `plugins` | OpenCode plugins to enable, with their options |
| `tests/` | A smoke test proving the expert starts headless, loads its agents and tools, and completes one scripted task |

A pack is accepted only if it runs with no `ask` permission anywhere, starts without interactive setup, and passes its smoke test on the fleet's pinned OpenCode version.

Planned first packs, all from the organization's own projects and all to be adopted after the core system works:

| Pack | Source | What it needs first |
|---|---|---|
| `reverse-engineer` | `opencode-rea` | Its `runtime` option set to `allow` or `deny` (the default is `ask`); the REA MCP server and target binaries available in the container; `experimental.subagent_depth` raised so its three subagents can run |
| `godot` | `godot-opencode` | A headless Godot editor with the companion addon in the image |
| `gdevelop` | the `opencode-gdevelop` plugin inside `GDevelop-Unlocked` | The plugin packaged on its own. The premium-gating patch stack is not part of the pack. |

Skills from Claude Code plugins, through `claude-4-opencode`, follow the same rule of build-time only: pinned by commit, chosen per expert from an allowlist, with plugin hooks and plugin MCP servers off unless enabled explicitly.

---

## 6. Roles deliberately not given their own expert

| Role | Covered by | Why |
|---|---|---|
| Project manager, scrum master | `director`, `product` | Coordination is the Director's whole job. |
| FinOps, cloud cost | `platform`, `sre` | Too little distinct tooling to justify a container. |
| Internationalization | `frontend`, `docs` | Mostly conventions; better as a skill. |
| Developer experience, tooling | `platform`, `refactor` | Same write paths and tools. |
| Accessibility specialist | `design` | Same browser tooling and audit workflow. |
| Game engines, reverse engineering | expert packs (section 5) | They arrive as packs rather than as built-in experts. |
| Embedded, hardware | none | Add as a pack when a project needs one. |

---

## 7. Assignment matrix

The Tier column is the intended tier if models are ever split. Today every expert uses the one configured model.

| Expert | Profile | Tier | Access | MCP servers |
|---|---|---|---|---|
| `director` | core | Frontier | ro | `fleet` |
| `scout` | core | Fast | ro | `context7`, `deepwiki` |
| `architect` | core | Frontier | scoped | `context7`, `deepwiki` |
| `product` | core | Standard | scoped | `github`, `linear`* |
| `frontend` | core | Standard | scoped | `playwright`, `context7`, `figma`* |
| `backend` | core | Standard | scoped | `context7`, `serena`, `dbhub`* |
| `dba` | core | Standard | scoped | `postgres`* or `dbhub`* |
| `platform` | core | Standard | scoped | `terraform`, `kubernetes`*, `github` |
| `security` | core | Frontier | ro | `semgrep`, `trivy` |
| `qa` | core | Standard | scoped | `playwright` |
| `qa-functional` | core | Standard | ro | `playwright` |
| `qa-adversarial` | core | Standard | ro | `playwright` |
| `reviewer` | core | Review | ro | none (`github`*) |
| `docs` | core | Fast | scoped | `context7` |
| `api` | extended | Standard | scoped | `context7` |
| `sre` | extended | Standard | scoped | `grafana`*, `sentry`* |
| `performance` | extended | Standard | scoped | `chrome-devtools` |
| `debugger` | extended | Frontier | scoped | `chrome-devtools`, `sentry`* |
| `refactor` | extended | Standard | scoped | `serena` |
| `data` | extended | Standard | scoped | `dbhub`* |
| `ml` | extended | Standard | scoped | `huggingface`*, `context7` |
| `mobile` | extended | Standard | scoped | `context7` |
| `design` | extended | Standard | scoped | `playwright`, `figma`* |
| `release` | extended | Standard | scoped | `github` |
| `compliance` | extended | Standard | ro | none |

\* Ships disabled; enabled once its credential or endpoint is configured.

---

## Sources

- Local source: `review/opencode` (`packages/schema/src/config*`, `packages/core/src/permission.ts`, `packages/core/src/plugin/agent.ts`, `packages/core/src/tool/*`).
- [opencode-rea](https://github.com/Heretek-AI/opencode-rea), [godot-opencode](https://github.com/Heretek-AI/godot-opencode), [GDevelop-Unlocked](https://github.com/Heretek-AI/GDevelop-Unlocked), [claude-4-opencode](https://github.com/Heretek-AI/claude-4-opencode), [scraper-swarm](https://github.com/Heretek-AI/scraper-swarm), [Epistemic Swarm](https://github.com/Heretek-AI/IUMBTEMS) (READMEs and top-level docs only).
- [Top open-source Postgres MCP servers (Bytebase)](https://www.bytebase.com/blog/top-postgres-mcp-servers/)
- [Trivy MCP server plugin](https://glama.ai/mcp/servers/aquasecurity/trivy-mcp)
- [Playwright MCP Docker guide](https://www.mintlify.com/microsoft/playwright-mcp/guides/docker)
- [Best MCP servers for cloud infrastructure](https://www.fast.io/resources/best-mcp-servers-for-cloud-infrastructure.md)
- [Grafana MCP server: install the binary](https://grafana.com/docs/grafana/next/developer-resources/mcp/set-up/client-configuration-examples/)
- [Serena MCP server](https://playbooks.com/mcp/oraios-serena)
