# Stage 5 — Web UI Alive Layer: Real-time telemetry, multi-stream wall, topology map, and PWA

Read `docs/prompts/00-shared-context.md` and `docs/prompts/ui-spec.md` first. Both are part of this prompt.

**Prerequisite:** `docs/reports/stage-4c.md` and its verification report exist with a PASS verdict. Work on branch `stage-5-web-ui-alive`.

## Goal of this stage

Deliver the complete "Alive" visualization layer for The Agency Web UI, transforming the foundation built in Stage 1e and extended in Waves 2-4 into an extraordinary, real-time operations console.

At the end of this stage, the interface features an interactive fleet topology map with animated message flows, a multi-expert streaming transcript wall, a live Go usage meter, a real-time egress proxy traffic feed, an interactive audit chain block visualizer, full PWA capabilities with web push notifications, and verified 60fps performance on both desktop and mobile devices.

## Not in this stage

New agent logic or changes to deterministic dispatch rules. The backend fleet and engine are already complete and certified in Wave 4.

## Ask the user

Permission to generate and configure VAPID keys for Web Push notifications (or test against local fake push server).

## Step 1 — Interactive fleet topology map

In `dispatcher/web/src/components/topology/`:
- Implement the system-wide visual graph using React Flow (`@xyflow/react`):
  - **Nodes:** Gateway, Dispatcher, Director, 25 Experts, Verifier, Environment Runner, and Egress Proxy.
  - **Status Badges:** Dynamic node colors reflecting health, CPU/memory load, and active task assignments.
  - **Animated Edge Particles:** Animated neon particle flows along graph edges whenever tasks are dispatched, SSE tokens stream, verification checks run, or merges execute.
  - **Interactive Filtering:** Focus modes to highlight active mission paths, isolate a single repository's resources, or inspect a single expert.

**Accept:** topology graph renders all active services; dispatches animate edges in real time.

## Step 2 — Multi-expert streaming transcript wall

In `dispatcher/web/src/components/transcripts/`:
- A configurable grid view allowing operators to watch up to 6 expert sessions concurrently:
  - Token-by-token streaming via SSE.
  - Collapsible tool execution cards (`shell`, `edit`, `read`, `subagent`).
  - Inline mini-diffs when experts apply patches.
  - Smart auto-scroll that pauses smoothly when the user manually scrolls back to inspect output.
  - Quick-switch tabs for viewing any of the 25 experts on demand.

**Accept:** multiple expert streams render simultaneously without cross-talk or UI lockup.

## Step 3 — Real-time Go usage meter & quota countdown

In `dispatcher/web/src/components/usage/`:
- Real-time gauge and rolling timeline of OpenCode Go usage:
  - 5-hour, weekly, and monthly consumption meters.
  - Dynamic depletion visualization: animated filling/draining bar with projected pause horizon based on recent mission velocity.
  - Live countdown timer displayed prominently when the fleet is paused for provider usage limits, automatically clearing when the window resets.

**Accept:** meter reflects ledger updates; simulated pause displays live countdown timer.

## Step 4 — Egress proxy live feed

In `dispatcher/web/src/components/egress/`:
- Streaming terminal feed connected to Dispatcher's egress log relay:
  - Live log lines from Squid proxy tagged by expert container identity.
  - Visual status chips: Neon green for allowed CONNECT/GET requests, Electric magenta for denied out-of-allowlist requests.
  - Search and filter by domain, expert name, or HTTP status code.

**Accept:** outbound requests appear in feed within 500ms; denied requests highlight in magenta.

## Step 5 — Audit chain block visualizer

In `dispatcher/web/src/components/audit/`:
- Interactive block explorer representing the tamper-evident JSONL audit log:
  - Sequential block chain cards displaying `seq`, `actor`, `event`, and cryptographic hashes.
  - Animated block arrival when new audit transitions occur.
  - Visual verification check: confirms `sha256(prevHash + ":" + canonicalJson(event)) === hash` and highlights git commit anchor matches in green.
  - Deep-link from any landed task directly to its corresponding audit block.

**Accept:** audit visualizer correctly verifies chain; new events append cleanly with animation.

## Step 6 — Mobile refinement, PWA, and Web Push notifications

- **PWA Manifest & Service Worker:**
  - `manifest.webmanifest` configured with icons, standalone display mode, and theme color `#07090e`.
  - Service worker caching static assets for instant load and offline shell rendering.
- **Web Push Notifications:**
  - Integration with Web Push API for browser notifications when the tab is backgrounded:
    - Plan approval required.
    - Expert blocked with question.
    - Mission halted or failed.
    - Mission completed with ready draft PR.
- **Adaptive Performance Mode:**
  - Automatic degradation of canvas animations on mobile devices or when frame rate drops below 45fps.
  - Settings toggle: "High Fidelity (Full Glow & Particles)" vs "Efficiency (Clean High-Contrast)".
  - Full adherence to `prefers-reduced-motion`.

**Accept:** PWA installs on mobile; web push receives attention events; efficiency toggle disables particles.

## Step 7 — Playwright automated acceptance suite

Under `scripts/accept/5/` and `dispatcher/web/test/e2e/`:

1. **Topology & Animation:**
   - Playwright test triggers mission task; asserts topology map node transitions to active and edge animations activate.
2. **Multi-Transcript Concurrency:**
   - Stream 4 live sessions simultaneously; assert no dropped tokens and no main-thread freezing.
3. **Usage & Egress Streams:**
   - Assert usage meter updates from SSE events; assert egress feed displays Squid log entries with expert tags.
4. **Audit Visualizer Chain Integrity:**
   - Assert visualizer verifies genuine log and shows red broken-chain badge on simulated hash tampering.
5. **Mobile Viewport 60fps Profiling:**
   - Profile animation frame rate on emulated mobile viewport; assert sustained >= 55fps average with no layout thrashing.
6. **Axe Accessibility & PWA Audit:**
   - Lighthouse / Axe audit confirming 0 accessibility violations and 100% PWA criteria satisfaction.

**Accept:** all checks pass with red proofs.

## Acceptance checks for this stage

Under `scripts/accept/5/`:

| Check | Passes when |
|---|---|
| `01-make-check` | `make check` exits 0. |
| `02-topology-live` | Playwright verifies topology map node status and edge particle animations. |
| `03-multi-transcript-wall` | Multi-transcript view concurrently streams 4 expert sessions without errors. |
| `04-usage-meter-live` | Real-time usage meter renders Go 5-hour window and countdown on simulated pause. |
| `05-egress-feed-live` | Egress feed streams real-time Squid proxy events tagged by expert. |
| `06-audit-visualizer` | Audit chain explorer displays validated blocks and detects simulated tampering. |
| `07-pwa-and-push` | Service worker registers, manifest validates, and push notification triggers for attention items. |
| `08-performance-60fps` | Automated browser performance profile asserts sustained 60fps during multi-expert execution. |
| `09-all-stages-ui-reaccepted` | Complete system acceptance suite (`STAGE=all`) passes with all UI and fleet features operational. |

Checks `02` to `05` skip only without a provider key.

## Report

Write `docs/reports/stage-5.md` in the format of shared context 4.4, with screenshot galleries and performance benchmark logs under `docs/evidence/5/`. Then stop.
