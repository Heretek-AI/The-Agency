# Stage 1e — Web UI foundation: unified app, embedded chat, mission control, and Playwright verification

Read `docs/prompts/00-shared-context.md` and `docs/prompts/ui-spec.md` first. Both are part of this prompt.

**Prerequisite:** `docs/reports/stage-1d.md` and its verification report exist with a PASS verdict. Work on branch `stage-1e-web-ui`.

## Goal of this stage

Construct the production Web UI foundation in `dispatcher/web/` according to `docs/prompts/ui-spec.md`.

At the end of this stage, a user navigates to `http://agency.localhost:${AGENCY_HTTP_PORT}` in a browser, logs in with role-based credentials, chats with the Director directly inside the embedded interface, watches real-time streaming transcripts and task pipelines, reviews diffs, edits and approves plans, and controls missions on both desktop and mobile viewports.

This completes Wave 1 (Fleet Core & Interface).

## Not in this stage

The rich "Alive" layer—interactive canvas particle topology, multi-transcript streaming wall, live Squid egress feed, audit blockchain visualizer, and PWA push notifications (built in Stage 5). Playbooks and dual QA judges (Stage 2a). Ephemeral environment runner (Stage 2b). Multi-repo triggers (Stage 3a).

## Ask the user

Nothing new.

## Step 1 — Workspace scaffolding and toolchain integration

Set up `dispatcher/web/` as a workspace package under the root `package.json`:
- **Build Tool:** Vite + React 19 + TypeScript.
- **Dependencies:** Tailwind CSS, `@radix-ui/*` primitives, `lucide-react`, `@xyflow/react` (React Flow), `@tanstack/react-query`, `@tanstack/react-router`, `clsx`, `tailwind-merge`, and initial Magic UI components (`border-beam`, `shimmer-button`, `animated-grid-pattern`).
- **Build Integration:** `bun run --cwd dispatcher/web build` outputs static distribution files to `dispatcher/dist/web/`, which the Dispatcher HTTP server serves at `/`.
- **Quality Gates:** All `.ts` and `.tsx` files in `dispatcher/web/` must be included in `tsconfig.json`, pass `oxlint`, pass Prettier, and be covered by root `make check`.

**Accept:** `bun run --cwd dispatcher/web build` succeeds; `make check` exits 0.

## Step 2 — Heretek design system ("Happy Middle Ground")

Implement the design tokens defined in `docs/prompts/ui-spec.md` Section 5:
- **Dark Theme Obsidian Base:** `#07090e` base, `#0d1118` cards/panels, subtle `#1f2937` borders.
- **Neon Chrome Accents:** Cyber cyan (`#00f0ff`) for active streams and running nodes, amber (`#ffb700`) for human attention and waiting gates, electric magenta (`#ff0055`) for failures, terminal green (`#00ff66`) for verified passes.
- **Strict Readability for Content:** Diffs, logs, and verification evidence render on clean, distraction-free neutral dark backgrounds (`#161b22`) using high-contrast syntax highlighting. **No neon glows or visual distortion on code.**
- Global `prefers-reduced-motion` CSS hooks to disable animations cleanly.

**Accept:** visual tokens match `ui-spec.md`; contrast ratio for code diffs and text meets WCAG AA standards.

## Step 3 — Authentication, sessions, and role gating

Implement the client auth provider communicating with `/api/auth/*`:
- **Login View:** Dedicated login form with username and password, clean error handling on invalid credentials.
- **Session State:** Stores authenticated user profile and active role (`viewer`, `approver`, `admin`).
- **Role Gating Primitives:** `<RequireRole role="...">` components that either hide unauthorized actions or render them disabled with an informative elevation tooltip (e.g., "Approver role required to approve plans").
- **Top Bar Integration:** Displays current user avatar, login name, and colored role badge.

**Accept:** logging in sets session; invalid login displays error; viewer cannot click approval buttons.

## Step 4 — App shell, navigation, and command palette

Construct the persistent application shell:
- **Left Sidebar:** Nav items for `Home/Inbox`, `Missions`, `Fleet`, `Repos` (placeholder for 3a), `Queue & Usage` (placeholder for 3b), `Audit Log`, and `Settings`.
- **Top Utility Bar:**
  - Real-time **Fleet Pulse** chip (fetches `/api/fleet`, shows healthy expert count).
  - **Go Quota Meter** chip (displaying usage window headroom).
  - **Attention Inbox Bell** badge (reflects count of missions in `waiting-human`).
  - **Command Palette (`Ctrl+K` / `Cmd+K`):** Dialog for fast keyboard navigation to missions, experts, or quick actions.
- **Full Mobile Adaptation:** On viewports under 768px, sidebar collapses to a slide-over sheet and bottom navigation dock.

**Accept:** navigation switches views without full page reloads; `Ctrl+K` triggers palette; mobile layout collapses sidebar.

## Step 5 — Core views: Inbox, Missions, and Detail Workspace

Implement the primary functional views:

1. **Home / Inbox View:**
   - Cards displaying missions requiring action: plan approvals, blocked questions, and halted missions.
   - Quick action triggers: Approve button, Reject dialog with reason input, and Resume note form.
2. **Missions View:**
   - **Kanban Board:** Columns for `Planning`, `Awaiting Approval`, `Executing`, `Verifying`, `Landed`, and `Done`. Drag-and-drop or status badge movements.
   - **List View:** Searchable table with status filters and quick links.
3. **Mission Detail View (Unified Split Workspace):**
   - **Left Panel (Embedded Director Chat):**
     - Full transcript conversation with Director.
     - Real-time token streaming via SSE (`/api/missions/:id/chat/events`).
     - Auto-expanding message textarea with markdown support.
   - **Right Panel (Mission Mechanics):**
     - *Pipeline Tab:* Interactive pipeline showing tasks, current status, attempt counts, and `RESULT`/`VERDICT` cards.
     - *Task Graph Tab:* React Flow diagram of task dependency graph.
     - *Diff Viewer Tab:* Unified and split diff of task branch vs integration branch with additions/deletions stats.
     - *Artifacts & Logs Tab:* Real-time SSE streaming transcript of individual expert tasks.
   - *Plan Inline Editor:* When plan is in `waiting-human`, approvers can click "Edit Plan", adjust work items, titles, paths, and acceptance criteria inline, and save via `PUT /api/missions/:id/plan` before approving.
4. **Fleet View:**
   - Card grid for 12 core experts showing status, memory/CPU, active tasks, and direct links to debug web UIs.

**Accept:** user can create mission, chat with Director in embedded pane, view streaming updates, edit plan, and approve in UI.

## Step 6 — Playwright automated acceptance suite

Implement end-to-end browser tests under `dispatcher/web/test/e2e/` (runnable via `make accept-ui` and `scripts/accept/1e/*.sh`):

1. **Auth & Roles:**
   - Login as `viewer`: Verify view-only access; assert Approve/Reject buttons are disabled with tooltip.
   - Login as `approver`: Submit plan approval; assert status transition to `running`.
2. **Director Chat & Live SSE:**
   - Send chat message in Mission Detail view; assert user message appears, Director response streams via SSE, and task graph updates live without refresh.
3. **Plan Inline Editing:**
   - Open pending plan, edit a work item title and path, save; assert updated plan data is persisted and rendered.
4. **Diff Rendering & Readability:**
   - Inspect diff viewer on a task with changes; assert green/red styling, no overflow, high contrast.
5. **Mobile Viewport Parity:**
   - Set viewport to `375x667` (mobile): verify bottom navigation works, chat is usable, and approval actions can be executed.
6. **Axe Accessibility Audit:**
   - Run `@axe-core/playwright` across Home, Missions, Mission Detail, and Fleet views; assert 0 violations.

**Accept:** all Playwright tests pass; red proofs recorded.

## Acceptance checks for this stage

Under `scripts/accept/1e/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` (including web typecheck, oxlint, and prettier) exits 0. |
| `02-web-build` | Static assets build cleanly and are served by Dispatcher at `/`. |
| `03-auth-and-roles-ui` | Playwright test verifies login, session persistence, role badges, and viewer action gating. |
| `04-director-chat-embedded` | Playwright test verifies sending a chat message and receiving streaming SSE responses in embedded UI. |
| `05-plan-edit-and-approval` | Playwright test verifies editing plan work items and approving via UI. |
| `06-live-pipeline-and-diff` | Playwright test verifies pipeline status chips and diff viewer rendering. |
| `07-mobile-parity-375px` | Playwright test verifies complete mission workflow on 375px viewport. |
| `08-accessibility-axe` | Automated axe audit reports zero WCAG 2.1 AA violations. |
| `09-fleet-view-core-12` | Fleet view renders all 12 core experts with live health from API. |

Checks `04` to `07` skip only without a provider key.

## Report

Write `docs/reports/stage-1e.md` in the format of shared context 4.4, with committed Playwright screenshot evidence under `docs/evidence/1e/`. Then stop.
