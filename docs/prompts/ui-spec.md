# The Agency — Web UI Specification (Edition 3)

This document is the binding visual, structural, and behavioral specification for The Agency's web interface.
Every stage implementing or extending UI surfaces (**Stage 1e**, **Stage 2a**, **Stage 2b**, **Stage 3a**, **Stage 3b**, **Stage 4a**, and **Stage 5**) must strictly adhere to this contract.

---

## 1. Principles & Architectural Mandate

1. **One Unified Application:** The browser interacts with a single interface served by the Dispatcher at `agency.localhost` (or loopback via Caddy gateway). There are no disconnected web apps for day-to-day work: the Director's conversation, mission tracking, live diffs, and gate results live in one coherent workspace. Individual expert OpenCode web interfaces remain accessible only as a developer/debug fallback behind explicit admin links.
2. **Deterministic Control:** The UI never calls individual expert containers or OpenCode engines directly. All mutations, message exchanges, and plan modifications route strictly through the Dispatcher's authenticated REST and SSE API.
3. **Happy Middle Ground Aesthetic (Heretek Cyberpunk + Clean Utility):**
   - **Chrome & Pulse:** Rich cyberpunk aesthetic—dark backgrounds (`#0a0d12`, `#10151f`), neon accent glow (cyan `#00f0ff` for active/running, magenta `#ff0055` for critical/alerts, amber `#ffaa00` for human attention/warnings, emerald `#00ff66` for verified passes).
   - **Content & Readability:** Code diffs, log streams, and decision reviews use high-contrast, distraction-free neutral monospace surfaces (`#0d1117` / `#161b22`) with standard syntax highlighting. **No glowing text or low-contrast neon washes on code diffs or verification evidence.**
4. **Full Mobile Parity with Adaptive Layouts:** Every capability on desktop (reviewing plans, reading diffs, approving gates, watching SSE transcripts) is fully functional on mobile viewports. On smaller screens, complex side-by-side splits collapse cleanly into swipeable tabs and bottom sheets.
5. **Strict Performance Budget:** The interface must maintain smooth 60fps interaction even when streaming 14 concurrent expert SSE feeds. Heavy visual effects (canvas particle topologies, canvas glow filters) automatically throttle on mobile viewports and low-power devices, and fully respect `prefers-reduced-motion`.

---

## 2. Technology Stack

The UI lives under `dispatcher/web/` as a first-class workspace package:

- **Runtime & Build:** TypeScript, React 19, Vite (bundled with Bun).
- **Styling & Components:** Tailwind CSS, `shadcn/ui` primitives (Radix UI), Lucide icons.
- **Motion & Visuals:** Framer Motion (restrained to UI state transitions and drawer/sheet mechanics), Magic UI components (subtle border beams, glowing badges, animated grid backgrounds on dashboard heroes).
- **State & Data Fetching:** TanStack Query (React Query) for server state caching and optimistic updates, TanStack Router for type-safe routing.
- **Graph Visualization:** React Flow (`@xyflow/react`) for task graph and fleet topology rendering.
- **Diff & Code Display:** Monaco Editor (read-only) or `@primer/react` diff viewer with side-by-side and unified diff modes.
- **Quality & E2E:** Playwright for automated browser verification, `@axe-core/playwright` for accessibility auditing.

---

## 3. Information Architecture & Navigation

The shell consists of a persistent collapsible sidebar, a top utility status bar, and a main dynamic workspace:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [LOGO] The Agency  │ Fleet Pulse: 14 Core OK │ Go Usage: $3.40/12.00 │ User: Admin [Ctrl+K] │
├───────────────┬──────────────────────────────────────────────────────────────────┤
│ ❖ Home/Inbox  │ [Main Dynamic Workspace Area]                                    │
│ ☵ Missions    │                                                                  │
│ ☲ Fleet       │ (Mission Split View / Inbox Feed / Topology Map / Settings)      │
│ ⎇ Repos       │                                                                  │
│ ⏱ Queue/Usage │                                                                  │
│ ⚿ Audit Log   │                                                                  │
│ ⚙ Settings    │                                                                  │
└───────────────┴──────────────────────────────────────────────────────────────────┘
```

### 3.1 Top Status Bar
- **Fleet Pulse Indicator:** Live heartbeat chip showing total running, idle, and faulted experts.
- **Usage Meter Chip:** Real-time gauge of current 5-hour OpenCode Go window consumption (e.g., `$3.40 / $12.00`), color-coded (green < 50%, amber 50-80%, red > 80%).
- **Notification Inbox Bell:** Unread badge counter for items in `waiting-human` status (plan approvals, blocked expert questions, halted replans).
- **Command Palette (`Ctrl+K` / `Cmd+K`):** Quick jump to any mission, repository, expert, or action (`New Mission`, `Pause All`, `Inspect Audit`).
- **User Profile & Role Badge:** Current authenticated user login with badge (`Viewer`, `Approver`, `Admin`).

### 3.2 Primary Views
1. **Home / Inbox:**
   - Unified triage feed: pending plan approvals, expert questions with response inputs, halted missions with resume forms, and ready-to-merge draft PR links.
   - High-level mission pulse cards (active missions with progress bars).
2. **Missions (List & Kanban Toggle):**
   - **Kanban View:** Columns for `Planning`, `Awaiting Approval`, `Executing`, `Verifying & QA`, `Landed`, and `Completed`.
   - **List View:** Filterable table by repository, playbook, trigger source, and status.
3. **Mission Detail View (The Core Workspace):**
   - **Left Panel (Director Chat):** Full conversation thread with the Director. Real-time streaming responses, Markdown rendering with copyable code snippets, input box with auto-expanding textarea, action buttons for quick commands.
   - **Right Panel (Mission Mechanics - Tabbed/Split):**
     - *Pipeline Tab:* Interactive pipeline visualization per work item: `Tests (Red)` ➔ `Build` ➔ `Verify` ➔ `Dual QA (Functional & Adversarial)` ➔ `Review` ➔ `Security` ➔ `Land`. Live pulsing on running steps; side-by-side verdict cards with findings.
     - *Task Graph Tab:* React Flow visualization of dependencies, attempt counts, and branch tips.
     - *Diff & Changes Tab:* Unified or split diff viewer of current task branch vs integration branch.
     - *Artifacts & Logs Tab:* Live streaming SSE transcript of selected task, raw execution logs, and rendered reports.
4. **Fleet View:**
   - Grid of all 25 experts (14 core, 11 extended).
   - Real-time container metrics (status, memory, CPU, active session count, assigned worktree).
   - Extended experts display start/stop controls (for `Admin`).
   - Deep-link to native OpenCode web UI for advanced container inspection.
5. **Repositories View:**
   - Registered repositories list with active branches and triggers.
   - Onboarding wizard: view scout-proposed `ownership.yaml`, platform-proposed `checks.yaml` and `env.compose.yml`, baseline run results, and inline editor for human approval.
6. **Queue & Usage View:**
   - Priority queue backlog (Chat ➔ GitHub ➔ API ➔ Schedule).
   - Go Quota Ledger: visual timeline of 5-hour rolling windows, weekly/monthly projections, and countdown timer until quota reset if paused.
7. **Audit Log Explorer:**
   - Interactive timeline of the hash-chained JSONL log (`seq`, `actor`, `event`, `prevHash`, `hash`).
   - Verification badge (confirms current chain integrity against git commit anchors).
   - Event filter (filter by mission ID, actor, or event type).
8. **Settings View:**
   - Autonomy Dial control (`advisory`, `balanced`, `full`) with explanation.
   - User account management (for `Admin`).
   - Trigger configuration and webhook status.

---

## 4. Roles & Access Control

Authentication uses HTTP-only secure session cookies backed by argon2-hashed credentials in `state/registry/allowlist.yaml`.
Every API endpoint and UI action enforces role restrictions:

| Capability | Viewer | Approver | Admin |
| :--- | :---: | :---: | :---: |
| View missions, transcripts, diffs, fleet status, audit log | ✓ | ✓ | ✓ |
| Send messages to Director in Mission Chat | ✓ | ✓ | ✓ |
| Approve or Reject Mission Plans | ✗ | ✓ | ✓ |
| Inline-edit work items on pending plans before approval | ✗ | ✓ | ✓ |
| Answer blocked expert questions | ✗ | ✓ | ✓ |
| Submit resume notes for halted missions | ✗ | ✓ | ✓ |
| Manually trigger task retry or replan (within rework caps) | ✗ | ✓ | ✓ |
| Cancel or interrupt running tasks / missions | ✗ | ✓ | ✓ |
| Trigger one-click draft Pull Request creation | ✗ | ✓ | ✓ |
| Approve repository onboarding proposals & edit registry | ✗ | ✗ | ✓ |
| Adjust Autonomy Dial & Queue Priorities | ✗ | ✗ | ✓ |
| Start, stop, or restart expert containers manually | ✗ | ✗ | ✓ |
| Manage user accounts and tokens | ✗ | ✗ | ✓ |

UI elements representing forbidden actions are either hidden or clearly disabled with a tooltip explaining required role elevation.

---

## 5. Visual Design System ("Happy Middle Ground")

### 5.1 Color Palette
- **Backgrounds:**
  - Base App: `#07090e` (Deep Obsidian)
  - Card / Panel Surface: `#0d1118` (Dark Slate)
  - Code / Diff Canvas: `#161b22` (Neutral Terminal Dark)
  - Border Lines: `#1f2937` with subtle neon accents on active elements
- **Cyberpunk Accents (Chrome & Status Only):**
  - Cyber Cyan: `#00f0ff` (Active tasks, running streams, primary focus)
  - Electric Magenta: `#ff0055` (Failures, scope violations, critical alerts)
  - Warning Amber: `#ffb700` (Human attention needed, waiting approval, quota warning)
  - Terminal Green: `#00ff66` (Verified passes, clean landing, audit anchor verified)
  - Purple/Violet: `#a855f7` (Director identity, AI orchestration events)
- **High-Contrast Text & Diffs:**
  - Standard Text: `#e6edf3` (High readability off-white)
  - Muted Text: `#8b949e` (Secondary labels)
  - Diff Added: Background `#033a16`, Text `#7ee787` (Neutral green, zero glow)
  - Diff Removed: Background `#490202`, Text `#ffa198` (Neutral red, zero glow)

### 5.2 Typography
- **Headings & Badges:** `Geist` or `Inter`, tracking-wide, uppercase micro-headers for system telemetry (`TEXT-XS FONT-MONO TRACKING-WIDER`).
- **Body & Chat:** Clean sans-serif (`Inter`, `system-ui`) with 1.5 line height for conversational clarity.
- **Code, Logs & Diffs:** Pinned monospace font (`JetBrains Mono`, `Fira Code`, or `ui-monospace`).

---

## 6. Mobile Experience & Full Parity Guidelines

1. **Responsive Viewport Target:** Full functionality tested and verified down to 375px width (iPhone SE / standard Android).
2. **Layout Adaptation:**
   - Split views (Director Chat + Pipeline) collapse into a bottom navigation bar or swipeable tabs: `[Chat]` | `[Pipeline]` | `[Diff]` | `[Logs]`.
   - Action buttons (Approve, Reject, Resume) dock persistently at the bottom of the viewport with safe-area insets.
   - Large tables (Audit log, Fleet grid) switch to responsive card stacks on screens narrower than 768px.
3. **PWA Capabilities:**
   - Manifest configured for home screen installation (`standalone` display).
   - Web Push API integration for critical attention notifications (e.g., "Mission #104 requires plan approval").

---

## 7. Stage Integration Map

The Web UI evolves progressively across build stages without throwaway code:

| Stage | What is Added to the UI |
| :--- | :--- |
| **Stage 1d** | Backend API foundations: Director chat proxy (`/api/missions/:id/chat`), auth & role checking middleware, plan editing endpoint (`PUT /api/missions/:id/plan`), SSE event relay. |
| **Stage 1e** | **The Web UI Foundation:** React + Vite app shell, Heretek theme, login & role session handling, Home/Inbox, Mission List & Detail (embedded Director chat + task pipeline + diff viewer), Fleet core grid, mobile layout, Playwright test suite. |
| **Stage 2a** | Enhanced Work Item Pipeline view: side-by-side dual QA verdicts (`qa-functional` vs `qa-adversarial`), tiebreak display, red-proof test badge, bounded rework counter (`attempt 2/3`), resume form with required note. |
| **Stage 2b** | Ephemeral Environment Stack panel: per-task stack status, live port mappings, service logs, and volume cleanup indicators. |
| **Stage 3a** | Repository Onboarding Wizard: review & edit scout/platform proposals (`ownership.yaml`, `checks.yaml`, `env.compose.yml`), baseline results inspector, registry editor for approved repos. |
| **Stage 3b** | Notification Center & Operations: full inbox connection to event bus, Go Quota Ledger view (rolling 5h window), priority queue manager, and live backup/restore status. |
| **Stage 4a** | Extended Fleet Management: dynamic container lifecycle badges (`running`, `stopped`, `starting`), on-demand start/stop buttons for Admins. |
| **Stage 5** | **The Alive Layer:** Interactive React Flow fleet topology map, multi-expert streaming transcript wall, animated pipeline particle effects, real-time egress proxy feed, audit chain block visualizer, PWA web push, 60fps performance optimization. |

---

## 8. Verification & Acceptance Criteria (Playwright Suite)

UI quality is never verified by "inspecting that a file exists" or "checking that bare HTML renders".
Every UI stage must pass an automated Playwright suite (`make accept-ui`):

1. **Authentication & Role Isolation:**
   - Log in as `viewer`: Attempting to submit a plan approval or edit registry triggers 403 Forbidden and displays a disabled state in UI.
   - Log in as `approver`: Successfully edit a pending plan and click `Approve`; assert plan transitions to `running`.
   - Log in as `admin`: Access settings and container controls.
2. **Live SSE Communication:**
   - During an active task, Playwright asserts that the Director chat panel and task log stream text tokens in real time without page refresh.
3. **Diff & Verification Display:**
   - Assert that code diffs render without horizontal overflow, displaying accurate syntax highlighting and additions/deletions counts.
4. **Mobile Viewport Test:**
   - Run complete suite with viewport `375x667`: verify bottom action dock is visible, tabs switch cleanly, and text remains readable without clipping.
5. **Accessibility Audit:**
   - Automated `@axe-core/playwright` scan on all primary views reports zero violations of WCAG 2.1 AA standards.
6. **Performance Budget:**
   - Frame rate profiler asserts sustained 60fps during live transcript streaming on desktop and graceful fallback on mobile emulation.
