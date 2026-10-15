/**
 * In-memory per-session state shared by telemetry, taint tracking, task budgets,
 * memory upkeep and the context budget (which ranks content by the files a session touches).
 */

export interface TaintSource {
  tool: string
  resource: string
  at: string
}

export interface BreakerIncident {
  tool: string
  target: string
  error: string
  at: string
}

export interface SessionState {
  sessionID: string
  agent?: string
  startedAt: number
  toolCalls: number
  toolFailures: number
  breakerFires: number
  turns: number
  /** Most-recent-last list of files read or mutated in this session. */
  touchedFiles: string[]
  taint: TaintSource[]
  /** Open circuit-breaker incidents waiting for a successful retry on the same target. */
  openIncidents: BreakerIncident[]
  /** Lesson IDs injected into this session's context. */
  injectedLessons: Set<string>
  /** Board task this session claimed via `tools.org.claim_task`. */
  taskId?: string
}

const sessions = new Map<string, SessionState>()
const MAX_TOUCHED = 50

export function getSessionState(sessionID: string | undefined): SessionState {
  const sid = sessionID ?? "default"
  let state = sessions.get(sid)
  if (!state) {
    state = {
      sessionID: sid,
      startedAt: Date.now(),
      toolCalls: 0,
      toolFailures: 0,
      breakerFires: 0,
      turns: 0,
      touchedFiles: [],
      taint: [],
      openIncidents: [],
      injectedLessons: new Set(),
    }
    sessions.set(sid, state)
  }
  return state
}

export function listSessionStates(): SessionState[] {
  return Array.from(sessions.values())
}

export function resetSessionStates(): void {
  sessions.clear()
}

export function touchFile(state: SessionState, file: string): void {
  const idx = state.touchedFiles.indexOf(file)
  if (idx >= 0) state.touchedFiles.splice(idx, 1)
  state.touchedFiles.push(file)
  if (state.touchedFiles.length > MAX_TOUCHED) state.touchedFiles.shift()
}

/** Best-effort file path a tool call operates on. */
export function eventTargetPath(event: any): string | undefined {
  const input = event?.input
  if (!input || typeof input !== "object") return undefined
  for (const key of ["path", "filePath", "file", "target"]) {
    if (typeof input[key] === "string" && input[key]) return input[key]
  }
  return undefined
}

export function isFailedEvent(event: any): boolean {
  return event?.status === "error"
}
