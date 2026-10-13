/**
 * Typed REST client for the OpenCode v2 engine (pinned 2.0.26). This is the
 * only module that knows the OpenCode API; every later Dispatcher caller
 * goes through it. (Stage 1c extends it to the full operation list.)
 */

export interface OpenCodeClientOptions {
  baseUrl: string;
  /**
   * Server password for `opencode serve` Basic auth (username is always
   * `opencode`; see OPENCODE_PASSWORD). Sent as
   * `Authorization: Basic base64("opencode:<password>")` on every request.
   */
  password?: string;
  /** Injectable fetch for testability. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Poll interval (ms) used by the wait() fallback path. */
  pollIntervalMs?: number;
}

export interface CreateSessionBody {
  title?: string;
  agent?: string;
  location: { directory: string };
  permissions?: unknown;
  metadata?: Record<string, unknown>;
}

export interface PromptResult {
  inboxId: string;
  raw: unknown;
}

export interface FileDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface OpenCodeMessage {
  id: string;
  role: string;
  [key: string]: unknown;
}

export class OpenCodeError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "OpenCodeError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_POLL_MS = 1000;

export class OpenCodeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly authHeader: string | null;

  constructor(options: OpenCodeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
    this.authHeader =
      options.password !== undefined && options.password !== ""
        ? `Basic ${btoa(`opencode:${options.password}`)}`
        : null;
  }

  private headers(body: unknown): Record<string, string> | undefined {
    const out: Record<string, string> = {};
    if (body !== undefined) out["content-type"] = "application/json";
    if (this.authHeader !== null) out["authorization"] = this.authHeader;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res: Response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { status: 204, data: undefined as T };
    const text: string = await res.text();
    if (!res.ok)
      throw new OpenCodeError(`opencode ${method} ${path} failed: ${res.status}`, res.status, text);
    const parsed: unknown = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, data: parsed as T };
  }

  /** Enqueue a prompt; returns the inbox item (async admission, not an answer). */
  async prompt(sessionId: string, msg: string): Promise<PromptResult> {
    const { data } = await this.request<{ data: { id?: string } & Record<string, unknown> }>(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      { text: msg },
    );
    const inbox = data?.data ?? {};
    return { inboxId: typeof inbox.id === "string" ? inbox.id : "", raw: inbox };
  }

  /**
   * Race-free idle barrier. Uses POST experimental wait; on 404/501
   * (endpoint missing) falls back to polling the message list. Any other
   * non-2xx status throws.
   */
  async wait(sessionId: string, timeoutMs: number): Promise<void> {
    const deadline: number = Date.now() + timeoutMs;
    const waitPath = `/api/experimental/session/${encodeURIComponent(sessionId)}/wait`;
    try {
      const controller = new AbortController();
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await this.fetchImpl(`${this.baseUrl}${waitPath}`, {
          method: "POST",
          headers: this.headers(undefined),
          signal: controller.signal,
        }).then(async (res: Response) => {
          if (res.status === 404 || res.status === 501)
            throw new OpenCodeError("wait unavailable", res.status, "");
          if (res.status === 204) return;
          if (!res.ok)
            throw new OpenCodeError(
              `opencode POST ${waitPath} failed: ${res.status}`,
              res.status,
              await res.text(),
            );
        });
        return;
      } finally {
        clearTimeout(timer);
      }
    } catch (err: unknown) {
      if (!(err instanceof OpenCodeError) || (err.status !== 404 && err.status !== 501)) {
        if (err instanceof OpenCodeError) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new OpenCodeError("wait timed out", 408, "");
        }
      }
      // Fall through to polling fallback.
    }
    await this.pollUntilIdle(sessionId, deadline);
  }

  private async pollUntilIdle(sessionId: string, deadline: number): Promise<void> {
    let lastCount = -1;
    let stableRounds = 0;
    for (;;) {
      if (Date.now() >= deadline) throw new OpenCodeError("wait timed out", 408, "");
      const messages: OpenCodeMessage[] = await this.listMessages(sessionId);
      if (messages.length === lastCount) {
        stableRounds += 1;
        if (stableRounds >= 2) return;
      } else {
        stableRounds = 0;
        lastCount = messages.length;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  async diff(sessionId: string): Promise<FileDiff[]> {
    const { data } = await this.request<{ data: FileDiff[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/diff`,
    );
    return data?.data ?? [];
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionId)}/interrupt`);
  }

  async listMessages(sessionId: string): Promise<OpenCodeMessage[]> {
    const { data } = await this.request<{ data: OpenCodeMessage[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/message`,
    );
    const items: unknown = data?.data;
    return Array.isArray(items) ? (items as OpenCodeMessage[]) : [];
  }

  /**
   * Readiness probe. Upstream v2 exposes no `/api/health`, and `GET /api/info`
   * is unwrapped: it returns `{ version, ... }` directly (verified live),
   * unlike the session operations below, which wrap their payloads in
   * `{ data }`.
   */
  async info(): Promise<{ ok: boolean; version?: string; raw: unknown }> {
    const res: Response = await this.fetchImpl(`${this.baseUrl}/api/info`, {
      method: "GET",
      headers: this.headers(undefined),
    });
    const text: string = await res.text();
    if (!res.ok)
      throw new OpenCodeError(`opencode GET /api/info failed: ${res.status}`, res.status, text);
    const parsed: unknown = text.length > 0 ? (JSON.parse(text) as unknown) : {};
    const version: unknown = (parsed as Record<string, unknown> | undefined)?.["version"];
    return { ok: true, version: typeof version === "string" ? version : undefined, raw: parsed };
  }

  /** Create a session; resolves with the new id. */
  async createSession(body: CreateSessionBody): Promise<{ id: string; raw: unknown }> {
    const { data } = await this.request<{ data: { id?: string } & Record<string, unknown> }>(
      "POST",
      "/api/session",
      body,
    );
    const info: { id?: string } & Record<string, unknown> = data?.data ?? {};
    if (typeof info.id !== "string" || info.id === "") {
      throw new OpenCodeError(
        "opencode POST /api/session returned no session id",
        200,
        JSON.stringify(data),
      );
    }
    return { id: info.id, raw: info };
  }

  /** Retrieve a session by id (`GET /api/session/{id}`). */
  async getSession(sessionId: string): Promise<unknown> {
    const { data } = await this.request<{ data: unknown }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}`,
    );
    return data?.data;
  }

  /** Delete a session (`DELETE /api/session/{id}` → 204). */
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/api/session/${encodeURIComponent(sessionId)}`);
  }
}
