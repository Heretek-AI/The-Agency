import * as http from "node:http"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { loadBoard, verifyReleaseReady } from "../board/board.js"
import { listEpistemicSources } from "../epistemic/dialectic.js"
import { detectDomainPacks } from "../packs/index.js"
import { listTelemetryFiles } from "../host/telemetry.js"

function escapeHtml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function generateSwarmDashboardHtml(rootDir: string): Promise<{
  dashboardPath: string
  readyToShip: boolean
  taskCount: number
  contractCount: number
  uxScore: number | null
}> {
  const [board, readiness, epistemicSources, packs, telemetry] = await Promise.all([
    loadBoard(rootDir),
    verifyReleaseReady(rootDir),
    listEpistemicSources(rootDir),
    detectDomainPacks(rootDir),
    listTelemetryFiles(rootDir).catch(() => []),
  ])

  let uxScorecard: any = null
  try {
    const rawUx = await fs.readFile(path.join(rootDir, ".opencode", "artifacts", "ux-scorecard.json"), "utf8")
    uxScorecard = JSON.parse(rawUx)
  } catch {
    // Optional UX scorecard
  }

  const projectTitle = board.project?.name ?? path.basename(path.resolve(rootDir))
  const projectVision = board.project?.vision ?? "Autonomous Multi-Agent Engineering Workspace"
  const archetype = board.project?.aestheticArchetype ?? "High-Craft Technical Dark"

  const tasksByStatus = {
    pending: board.tasks.filter((t) => t.status === "pending"),
    in_progress: board.tasks.filter((t) => t.status === "in_progress" || t.status === "ready_for_qa"),
    qa_rejected: board.tasks.filter((t) => t.status === "qa_rejected"),
    verified: board.tasks.filter((t) => t.status === "verified"),
  }

  const renderTaskCard = (t: any) => {
    const latestReceipt = Array.isArray(t.qaReceipts) && t.qaReceipts.length > 0 ? t.qaReceipts[t.qaReceipts.length - 1] : null
    const badgeClass =
      latestReceipt?.verdict === "PASS"
        ? "badge-pass"
        : latestReceipt?.verdict === "REJECT"
          ? "badge-reject"
          : "badge-neutral"
    const badgeLabel = latestReceipt ? `QA: ${latestReceipt.verdict}` : "QA: PENDING"
    return `<div class="card task-card">
      <div class="card-header">
        <span class="mono-id">${escapeHtml(t.id)}</span>
        <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
      </div>
      <div class="card-title">${escapeHtml(t.title)}</div>
      <div class="card-meta">
        <span>Role: <strong>${escapeHtml(t.owner)}</strong></span>
        ${t.worktree ? `<span class="mono-tag">${escapeHtml(t.worktree)}</span>` : ""}
      </div>
      <div class="card-paths">${(t.ownedPaths ?? []).map((p: string) => `<code>${escapeHtml(p)}</code>`).join(" ")}</div>
    </div>`
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SwarmOS v1.0 Command Center — ${escapeHtml(projectTitle)}</title>
  <style>
    :root {
      --surface-0: #0D0E11;
      --surface-1: #14161B;
      --surface-2: #1C1F26;
      --surface-3: #252932;
      --text-primary: #F3F4F6;
      --text-secondary: #9CA3AF;
      --text-muted: #6B7280;
      --border-subtle: rgba(255, 255, 255, 0.08);
      --accent-emerald: #10B981;
      --accent-amber: #F59E0B;
      --accent-rose: #F43F5E;
      --accent-sky: #38BDF8;
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-6: 24px;
      --space-8: 32px;
      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 10px;
      --font-sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
      --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--surface-0);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      padding: var(--space-6);
      font-variant-numeric: tabular-nums;
    }
    .shell { max-width: 1440px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-6); }
    header.topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: var(--space-4) var(--space-6);
      background: var(--surface-1);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
    }
    .brand { display: flex; flex-direction: column; gap: var(--space-1); }
    .brand h1 { font-size: 18px; font-weight: 600; letter-spacing: -0.02em; }
    .brand p { color: var(--text-secondary); font-size: 13px; }
    .status-pill {
      display: inline-flex; align-items: center; gap: var(--space-2);
      padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600;
      font-family: var(--font-mono);
    }
    .status-ready { background: rgba(16, 185, 129, 0.14); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .status-blocked { background: rgba(245, 158, 11, 0.14); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.35); }
    .metrics-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4);
    }
    .metric-card {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md); padding: var(--space-4);
      display: flex; flex-direction: column; gap: var(--space-1);
    }
    .metric-label { color: var(--text-secondary); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .metric-value { font-size: 24px; font-weight: 600; font-family: var(--font-mono); }
    .metric-sub { color: var(--text-muted); font-size: 12px; }
    .kanban {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4);
    }
    .kanban-col {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md); padding: var(--space-4);
      display: flex; flex-direction: column; gap: var(--space-3); min-height: 260px;
    }
    .col-header {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-secondary); padding-bottom: var(--space-2);
      border-bottom: 1px solid var(--border-subtle);
    }
    .card {
      background: var(--surface-2); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); padding: var(--space-3);
      display: flex; flex-direction: column; gap: var(--space-2);
    }
    .card-header { display: flex; justify-content: space-between; align-items: center; }
    .mono-id { font-family: var(--font-mono); font-size: 11px; color: var(--accent-sky); }
    .badge { font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; border-radius: var(--radius-sm); font-weight: 600; }
    .badge-pass { background: rgba(16, 185, 129, 0.16); color: #34D399; }
    .badge-reject { background: rgba(244, 63, 94, 0.16); color: #FB7185; }
    .badge-neutral { background: rgba(156, 163, 175, 0.14); color: #D1D5DB; }
    .card-title { font-weight: 500; font-size: 13px; color: var(--text-primary); }
    .card-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); }
    .card-paths { display: flex; flex-wrap: wrap; gap: 4px; }
    code { font-family: var(--font-mono); font-size: 11px; background: var(--surface-3); padding: 1px 5px; border-radius: 3px; color: #E5E7EB; }
    .bottom-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
    .panel {
      background: var(--surface-1); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md); padding: var(--space-4);
      display: flex; flex-direction: column; gap: var(--space-3);
    }
    .panel h2 { font-size: 14px; font-weight: 600; color: var(--text-primary); border-bottom: 1px solid var(--border-subtle); padding-bottom: var(--space-2); }
    ul.clean-list { list-style: none; display: flex; flex-direction: column; gap: var(--space-2); font-size: 13px; color: var(--text-secondary); }
    @media (max-width: 960px) {
      .metrics-grid, .kanban, .bottom-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1>SwarmOS v1.0 — The Agency Command Center · ${escapeHtml(projectTitle)}</h1>
        <p>${escapeHtml(projectVision)} · Archetype: <code>${escapeHtml(archetype)}</code></p>
      </div>
      <div class="status-pill ${readiness.ready ? "status-ready" : "status-blocked"}">
        ${readiness.ready ? "RELEASE GATE: READY TO SHIP" : `RELEASE GATE: ${readiness.blockers.length} BLOCKER(S)`}
      </div>
    </header>

    <section class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Locked Contracts</span>
        <span class="metric-value">${board.contracts.length}</span>
        <span class="metric-sub">Architect Gate 1 Invariants</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Verified Tasks</span>
        <span class="metric-value">${readiness.verifiedTasks.length} / ${board.tasks.filter((t) => t.status !== "superseded").length}</span>
        <span class="metric-sub">Signed Adversarial QA Receipts</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Visual UI/UX Judge</span>
        <span class="metric-value">${uxScorecard ? `${uxScorecard.score}/100 (${escapeHtml(uxScorecard.grade)})` : "Not Run"}</span>
        <span class="metric-sub">${uxScorecard ? (uxScorecard.passed ? "Passed >= 85 Threshold" : "Needs Visual Remediation") : "Run tools.ui.score_ux"}</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Epistemic Sources & Packs</span>
        <span class="metric-value">${epistemicSources.length} src · ${packs.recommendedPacks.length} pack</span>
        <span class="metric-sub">Active Packs: ${escapeHtml(packs.recommendedPacks.join(", ") || "core")}</span>
      </div>
    </section>

    <section class="kanban">
      <div class="kanban-col">
        <div class="col-header"><span>Pending</span><span>${tasksByStatus.pending.length}</span></div>
        ${tasksByStatus.pending.map(renderTaskCard).join("") || `<div class="metric-sub">No pending tasks.</div>`}
      </div>
      <div class="kanban-col">
        <div class="col-header"><span>In Progress / Ready QA</span><span>${tasksByStatus.in_progress.length}</span></div>
        ${tasksByStatus.in_progress.map(renderTaskCard).join("") || `<div class="metric-sub">No active tasks.</div>`}
      </div>
      <div class="kanban-col">
        <div class="col-header"><span>QA Rejected</span><span>${tasksByStatus.qa_rejected.length}</span></div>
        ${tasksByStatus.qa_rejected.map(renderTaskCard).join("") || `<div class="metric-sub">Zero rejected tasks.</div>`}
      </div>
      <div class="kanban-col">
        <div class="col-header"><span>Verified (PASS)</span><span>${tasksByStatus.verified.length}</span></div>
        ${tasksByStatus.verified.map(renderTaskCard).join("") || `<div class="metric-sub">No verified tasks yet.</div>`}
      </div>
    </section>

    <section class="bottom-grid">
      <div class="panel">
        <h2>Locked Architecture Contracts</h2>
        <ul class="clean-list">
          ${board.contracts.map((c) => `<li><code>${escapeHtml(c.id)}</code> — <strong>${escapeHtml(c.title)}</strong> (${escapeHtml(c.files.join(", "))})</li>`).join("") || "<li>No contracts locked yet.</li>"}
        </ul>
      </div>
      <div class="panel">
        <h2>100-Point UI/UX Scorecard Breakdown</h2>
        <ul class="clean-list">
          ${
            uxScorecard?.breakdown
              ? Object.entries(uxScorecard.breakdown)
                  .map(([k, v]: [string, any]) => `<li><strong>${escapeHtml(k)}</strong>: <code>${v.score}/${v.max}</code></li>`)
                  .join("")
              : "<li>Run <code>tools.ui.score_ux</code> to populate live 6-axis UI/UX metrics.</li>"
          }
        </ul>
      </div>
      <div class="panel">
        <h2>Epistemic Cache & Telemetry</h2>
        <ul class="clean-list">
          <li><strong>Verified SHA-256 Sources</strong>: ${epistemicSources.length}</li>
          <li><strong>Detected Domain Packs</strong>: ${escapeHtml(packs.recommendedPacks.join(", ") || "none")}</li>
          <li><strong>Recorded Telemetry Sessions</strong>: ${Array.isArray(telemetry) ? telemetry.length : 0}</li>
        </ul>
      </div>
    </section>
  </div>
</body>
</html>`

  const outDir = path.join(rootDir, ".opencode", "artifacts")
  await fs.mkdir(outDir, { recursive: true })
  const dashboardPath = path.join(outDir, "swarm-dashboard.html")
  await fs.writeFile(dashboardPath, html, "utf8")

  return {
    dashboardPath,
    readyToShip: readiness.ready,
    taskCount: board.tasks.length,
    contractCount: board.contracts.length,
    uxScore: uxScorecard?.score ?? null,
  }
}


const activeServers = new Map<string, { url: string; port: number; server: http.Server }>()

export async function startSwarmWebUIServer(rootDir: string, preferredPort = 4310): Promise<{
  url: string
  port: number
  dashboardPath: string
}> {
  const key = path.resolve(rootDir)
  const existing = activeServers.get(key)
  const rendered = await generateSwarmDashboardHtml(rootDir)
  if (existing) {
    return { url: existing.url, port: existing.port, dashboardPath: rendered.dashboardPath }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = req.url ?? "/"
      if (reqUrl.startsWith("/api/state")) {
        const [board, readiness, epistemicSources, packs] = await Promise.all([
          loadBoard(rootDir),
          verifyReleaseReady(rootDir),
          listEpistemicSources(rootDir),
          detectDomainPacks(rootDir),
        ])
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" })
        res.end(JSON.stringify({ board, readiness, epistemicSources, packs }))
        return
      }
      const latest = await generateSwarmDashboardHtml(rootDir)
      const html = await fs.readFile(latest.dashboardPath, "utf8")
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(html)
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(err?.message ?? err) }))
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", () => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        resolve(typeof addr === "object" && addr ? addr.port : preferredPort)
      })
    })
    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address()
      resolve(typeof addr === "object" && addr ? addr.port : preferredPort)
    })
  })

  const url = `http://127.0.0.1:${port}`
  activeServers.set(key, { url, port, server })
  return { url, port, dashboardPath: rendered.dashboardPath }
}

export function registerDashboardTools(editor: any, rootDir: string) {
  editor.add({
    name: "serve_dashboard",
    description:
      "Start a live local HTTP + JSON API server (`http://127.0.0.1:4310`) serving The Agency SwarmOS Command Center WebUI and `/api/state`.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: {
      type: "object",
      properties: {
        port: { type: "number", description: "Preferred local port (default 4310)" },
      },
    },
    output: { type: "object" },
    execute: async (input: { port?: number }) => {
      const res = await startSwarmWebUIServer(rootDir, input?.port ?? 4310)
      return {
        output: res,
        content: `SwarmOS Live Command Center WebUI running at ${res.url} (file: ${res.dashboardPath})`,
      }
    },
  })
  editor.add({
    name: "render_dashboard",
    description:
      "Generate the self-contained 'The Agency' SwarmOS Live Command Center WebUI HTML5 dashboard at `.opencode/artifacts/swarm-dashboard.html`.",
    options: { namespace: "org", codemode: true, pinned: true },
    input: { type: "object", properties: {} },
    output: { type: "object" },
    execute: async () => {
      const res = await generateSwarmDashboardHtml(rootDir)
      return {
        output: res,
        content: `Generated SwarmOS Command Center WebUI -> ${res.dashboardPath}`,
      }
    },
  })
}
