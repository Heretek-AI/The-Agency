export type Role = "viewer" | "approver" | "admin";

export interface SessionUser {
  username: string;
  role: Role;
}

export interface FleetExpert {
  name: string;
  description: string;
  handles: string[];
  delegates: string[];
  access: string;
  health: string;
  load: number;
}

export interface MissionSummary {
  id: string;
  repo: string;
  objective: string;
  status: string;
  source: string;
  integrationBranch: string;
  directorSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  taskCounts: Record<string, number>;
}

/**
 * Wire shape for PUT /api/missions/:id/plan (same shape the MCP
 * `fleet_plan_submit` tool accepts): one object per work item.
 */
export interface PlanTaskInput {
  key: string;
  expert: string;
  title?: string;
  role?: string;
  objective: string;
  context?: string;
  constraints?: string;
  acceptance?: string[];
  paths?: string[];
  deps?: string[];
}

export interface TaskSummary {
  id: string;
  missionId: string;
  repo: string;
  title: string;
  kind: string;
  role: string;
  expert: string | null;
  deps: string[];
  trigger: string;
  status: string;
  attempts: number;
  reason: string | null;
  branch: string | null;
  headSha: string | null;
  landedSha: string | null;
  result: unknown;
}

export interface MissionDetail {
  mission: MissionSummary;
  plan: { director?: PlanTaskInput[]; approved?: boolean } | null;
  tasks: TaskSummary[];
  decisions: Array<Record<string, unknown>>;
}

export interface ChatMessage {
  id: string;
  role: string;
  text: string;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error !== "") message = body.error;
    } catch {
      // Keep the status text when the body is not JSON.
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  login(username: string, password: string): Promise<SessionUser> {
    return request<SessionUser>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  },

  me(): Promise<SessionUser> {
    return request("/api/auth/me");
  },

  fleet(): Promise<{ experts: FleetExpert[] }> {
    return request("/api/fleet");
  },

  usage(): Promise<{
    runningMissions: number;
    waitingHuman: number;
    maxConcurrent: number;
    note: string;
  }> {
    return request("/api/usage");
  },

  missions(): Promise<{ missions: MissionSummary[] }> {
    return request("/api/missions");
  },

  createMission(objective: string, repo?: string): Promise<{ id: string; status: string }> {
    return request("/api/missions", {
      method: "POST",
      body: JSON.stringify(repo === undefined ? { objective } : { objective, repo }),
    });
  },

  mission(id: string): Promise<MissionDetail> {
    return request(`/api/missions/${encodeURIComponent(id)}`);
  },

  approve(id: string): Promise<unknown> {
    return request(`/api/missions/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  reject(id: string, reason: string): Promise<unknown> {
    return request(`/api/missions/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },

  cancel(id: string): Promise<unknown> {
    return request(`/api/missions/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  updatePlan(id: string, tasks: PlanTaskInput[]): Promise<unknown> {
    return request(`/api/missions/${encodeURIComponent(id)}/plan`, {
      method: "PUT",
      body: JSON.stringify({ tasks }),
    });
  },

  chat(id: string): Promise<{ sessionId: string | null; messages: ChatMessage[] }> {
    return request(`/api/missions/${encodeURIComponent(id)}/chat`);
  },

  sendChat(id: string, message: string): Promise<{ ok: boolean; sessionId: string }> {
    return request(`/api/missions/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
  },

  taskDiff(taskId: string): Promise<{ taskId: string; diff: string; truncated: boolean }> {
    return request(`/api/tasks/${encodeURIComponent(taskId)}/diff`);
  },

  decide(taskId: string, decision: string, notes?: string): Promise<unknown> {
    return request(`/api/tasks/${encodeURIComponent(taskId)}/decide`, {
      method: "POST",
      body: JSON.stringify(notes === undefined ? { decision } : { decision, notes }),
    });
  },
};

export function roleAtLeast(role: Role, minimum: Role): boolean {
  const rank: Record<Role, number> = { viewer: 0, approver: 1, admin: 2 };
  return rank[role] >= rank[minimum];
}
