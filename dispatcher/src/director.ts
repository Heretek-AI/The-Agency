import { Engine } from "./engine.js";
import { MissionStatuses } from "./model.js";
import { OpenCodeClient } from "./opencode.js";

/**
 * Director session management (Stage 1d, Step 3). One Director session
 * per mission: created on demand, correlated through the mission's
 * `directorSessionId`, and woken with a queued `[fleet]` prompt when a
 * task reaches a terminal state. When no session exists the Director
 * falls back to `fleet_wait`.
 */

export const DIRECTOR_WAKE_PREFIX = "[fleet]";

export interface DirectorClients {
  director: OpenCodeClient;
}

export class DirectorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectorError";
  }
}

function wakeText(
  missionId: string,
  taskId: string,
  expert: string,
  role: string,
  status: string,
): string {
  return (
    `${DIRECTOR_WAKE_PREFIX} Task ${taskId} (${expert}, ${role}) is ${status}. ` +
    `Mission ${missionId} needs your attention; call fleet_mission_get.`
  );
}

/**
 * Return the mission's Director session id, creating the session when
 * the mission has none or the recorded one is gone. The id is persisted
 * on the mission so later calls and restarts correlate to the same
 * session.
 */
export async function ensureDirectorSession(
  engine: Engine,
  clients: DirectorClients,
  missionId: string,
  locationDirectory: string,
): Promise<string> {
  const view = engine.getMission(missionId);
  const known = view.mission.directorSessionId;
  if (known !== undefined && known !== "") {
    try {
      await clients.director.sessionInfo(known);
      return known;
    } catch {
      // The recorded session is gone; create a replacement below.
    }
  }
  const created = await clients.director.createSession({
    agent: "director",
    title: `director for ${missionId}`,
    location: { directory: locationDirectory },
    metadata: { mission: missionId, role: "director" },
  });
  await engine.setDirectorSession(missionId, created.id);
  return created.id;
}

/** The session id a mission correlates to, if any. */
export function correlatedSession(engine: Engine, missionId: string): string | undefined {
  const mission = engine.getMission(missionId).mission;
  return mission.directorSessionId;
}

export interface WakeOutcome {
  woken: boolean;
  sessionId?: string;
  /** Set when no session exists: the Director uses fleet_wait instead. */
  fallback?: string;
}

/**
 * Wake the Director about a terminal task. Sends a queued prompt so an
 * actively reasoning Director is not interrupted. Returns a fallback
 * marker when the mission has no session.
 */
export async function wakeDirector(
  engine: Engine,
  clients: DirectorClients,
  taskId: string,
): Promise<WakeOutcome> {
  const holder = engine.listMissionIds().flatMap((id) => engine.getMission(id).tasks);
  const task = holder.find((t) => t.id === taskId);
  if (task === undefined) throw new DirectorError(`unknown task ${taskId}`);
  const view = engine.getMission(task.missionId);
  const sessionId = view.mission.directorSessionId;
  if (sessionId === undefined || sessionId === "")
    return { woken: false, fallback: "no director session; use fleet_wait" };
  await clients.director.prompt(
    sessionId,
    wakeText(task.missionId, task.id, task.expert ?? task.role, task.role, task.status),
    "queue",
  );
  return { woken: true, sessionId };
}

/**
 * Build the engine wake-up hook: when the runner finishes an expert
 * task, look the mission up and queue the Director prompt. Mission
 * wake-ups for approvals and halts go through the same path with the
 * mission's most recent terminal task.
 */
export function directorWakeHook(
  engine: Engine,
  clients: DirectorClients,
): (taskId: string) => void {
  return (taskId: string) => {
    wakeDirector(engine, clients, taskId).catch(() => {});
  };
}

/** True when the mission currently needs the Director: approval or halt. */
export function missionNeedsDirector(engine: Engine, missionId: string): boolean {
  const status = engine.getMission(missionId).mission.status;
  return status === MissionStatuses.waitingHuman || status === MissionStatuses.halted;
}
