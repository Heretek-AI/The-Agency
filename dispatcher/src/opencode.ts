/**
 * Typed REST client for the OpenCode v2 engine (pinned 2.0.26). This is the
 * only module that knows the OpenCode API; every later Dispatcher caller
 * goes through it. (Stage 1c: extended to the full operation list.)
 *
 * Operation table (method + path, `{param}` form as in openapi.json):
 * - info: GET /api/info (unwrapped `{version, ...}`, unlike the rest)
 * - createSession: POST /api/session
 * - sessionInfo: GET /api/session/{sessionID}
 * - deleteSession: DELETE /api/session/{sessionID}
 * - prompt: POST /api/session/{sessionID}/prompt (+ optional delivery)
 * - waitIdle: POST /api/experimental/session/{sessionID}/wait, 204 when idle;
 *   polling fallback only on 404/501
 * - interrupt: POST /api/session/{sessionID}/interrupt
 * - messages: GET /api/session/{sessionID}/message
 * - diff: GET /api/session/{sessionID}/diff
 * - pendingPermissions: GET /api/session/{sessionID}/permission
 * - replyPermission: POST /api/session/{sessionID}/permission/{requestID}/reply
 * - setEnvironment: PUT /api/session/{sessionID}/environment {variables}
 * - subscribeEvents: GET /api/event as SSE, reconnect + resume point
 * - assertContract: GET /openapi.json, every operation above must exist
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

export type PromptDelivery = "steer" | "queue";

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

export interface PendingPermission {
  requestID: string;
  tool?: string;
  detail?: string;
  [key: string]: unknown;
}

export type PermissionDecision = "once" | "always" | "reject";

export interface StreamEvent {
  /** SSE `id:` field, null when the server sent none. */
  id: string | null;
  /** Parsed `data:` payload when it is JSON, else the raw text. */
  data: unknown;
  raw: string;
}

export interface SubscribeOptions {
  /** Stop reconnecting when aborted. */
  signal?: AbortSignal;
  /** Wait between reconnects (ms). Defaults to 1000. */
  reconnectMs?: number;
  /** Resume point for the first connection. */
  lastEventId?: string | null;
  /** Called for every received event; a throw does not stop the stream. */
  onEvent: (event: StreamEvent) => void;
}

export interface EventSubscription {
  close: () => void;
  /** Resume point: id of the last event received, null when none yet. */
  lastEventId: () => string | null;
}

export interface OpenCodeOperation {
  method: string;
  /** Path in openapi.json `{param}` form. */
  path: string;
}

/** Every operation this client uses. `assertContract` checks this table. */
export const OPENCODE_OPERATIONS: OpenCodeOperation[] = [
  { method: "GET", path: "/api/info" },
  { method: "POST", path: "/api/session" },
  { method: "GET", path: "/api/session/{sessionID}" },
  { method: "DELETE", path: "/api/session/{sessionID}" },
  { method: "POST", path: "/api/session/{sessionID}/prompt" },
  { method: "POST", path: "/api/experimental/session/{sessionID}/wait" },
  { method: "POST", path: "/api/session/{sessionID}/interrupt" },
  { method: "GET", path: "/api/session/{sessionID}/message" },
  { method: "GET", path: "/api/session/{sessionID}/diff" },
  { method: "GET", path: "/api/session/{sessionID}/permission" },
  { method: "POST", path: "/api/session/{sessionID}/permission/{requestID}/reply" },
  { method: "PUT", path: "/api/session/{sessionID}/environment" },
  { method: "GET", path: "/api/event" },
];

export interface OpenApiSpecShape {
  paths: Record<string, Record<string, unknown>>;
}

/**
 * Operations from `ops` missing in `spec` (same segment shape with the
 * same method). Empty when every operation exists. Shared with the fake
 * server's route self-check so client and fake cannot drift apart.
 */
export function checkOperationsAgainstSpec(
  ops: OpenCodeOperation[],
  spec: OpenApiSpecShape,
): string[] {
  const missing: string[] = [];
  for (const op of ops) {
    const rp = op.path.split("/");
    let found = false;
    for (const [specPath, methods] of Object.entries(spec.paths)) {
      const sp = specPath.split("/");
      if (sp.length !== rp.length) continue;
      let shape = true;
      for (let i = 0; i < sp.length; i++) {
        const isParam = sp[i]!.startsWith("{") && sp[i]!.endsWith("}");
        if (!isParam && sp[i] !== rp[i]) {
          shape = false;
          break;
        }
      }
      if (shape && methods[op.method.toLowerCase()] !== undefined) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(`${op.method} ${op.path}`);
  }
  return missing;
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
const DEFAULT_RECONNECT_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  private headers(
    body: unknown,
    extra?: Record<string, string>,
  ): Record<string, string> | undefined {
    const out: Record<string, string> = { ...(extra ?? {}) };
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
  async prompt(sessionId: string, msg: string, delivery?: PromptDelivery): Promise<PromptResult> {
    const { data } = await this.request<{ data: { id?: string } & Record<string, unknown> }>(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      delivery === undefined ? { text: msg } : { text: msg, delivery },
    );
    const inbox = data?.data ?? {};
    return { inboxId: typeof inbox.id === "string" ? inbox.id : "", raw: inbox };
  }

  /**
   * Race-free idle barrier. Uses POST experimental wait; on 404/501
   * (endpoint missing) falls back to polling the message list. Any other
   * non-2xx status throws.
   */
  async waitIdle(sessionId: string, timeoutMs: number): Promise<void> {
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
      const msgs: OpenCodeMessage[] = await this.messages(sessionId);
      if (msgs.length === lastCount) {
        stableRounds += 1;
        if (stableRounds >= 2) return;
      } else {
        stableRounds = 0;
        lastCount = msgs.length;
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

  async messages(sessionId: string): Promise<OpenCodeMessage[]> {
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
  async sessionInfo(sessionId: string): Promise<unknown> {
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

  /** List pending permission requests for a session. */
  async pendingPermissions(sessionId: string): Promise<PendingPermission[]> {
    const { data } = await this.request<{ data: unknown }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/permission`,
    );
    const items: unknown = data?.data;
    if (!Array.isArray(items)) return [];
    return (items as Record<string, unknown>[]).flatMap((item) => {
      const requestID = item["requestID"] ?? item["id"];
      return typeof requestID === "string" ? [{ ...item, requestID } as PendingPermission] : [];
    });
  }

  /** Reply to one pending permission request. The real server answers 204. */
  async replyPermission(
    sessionId: string,
    requestID: string,
    decision: PermissionDecision,
    message?: string,
  ): Promise<void> {
    await this.request<unknown>(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestID)}/reply`,
      message === undefined ? { decision } : { decision, message },
    );
  }

  /**
   * Replace the environment the session's processes see
   * (`PUT /api/session/{id}/environment`, shape `{ variables }`; a bare
   * object 400s). The real server answers 204.
   */
  async setEnvironment(sessionId: string, variables: Record<string, string>): Promise<void> {
    await this.request<unknown>(
      "PUT",
      `/api/session/${encodeURIComponent(sessionId)}/environment`,
      { variables },
    );
  }

  /**
   * Subscribe to `GET /api/event` as SSE. Runs until `close()` or the
   * signal aborts: a dropped stream reconnects after `reconnectMs` and
   * resumes from the last received `id:` (the resume point), sent back as
   * `Last-Event-ID`. Frames without parseable JSON still reach `onEvent`
   * with the raw text as `data`.
   */
  subscribeEvents(options: SubscribeOptions): EventSubscription {
    const reconnectMs = options.reconnectMs ?? DEFAULT_RECONNECT_MS;
    let closed = false;
    let lastId: string | null = options.lastEventId ?? null;
    const stop = new AbortController();
    if (options.signal !== undefined) {
      if (options.signal.aborted) closed = true;
      else options.signal.addEventListener("abort", () => subscription.close(), { once: true });
    }

    const parseFrames = (text: string): void => {
      for (const frame of text.split(/\r?\n\r?\n/)) {
        let id: string | null = null;
        const dataLines: string[] = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith(":")) continue;
          if (line.startsWith("id:")) id = line.slice(3).trimStart();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        const raw = dataLines.join("\n");
        let data: unknown = raw;
        try {
          data = JSON.parse(raw) as unknown;
        } catch {
          // keep the raw text
        }
        if (id !== null) lastId = id;
        try {
          options.onEvent({ id, data, raw });
        } catch {
          // a failing observer must not kill the stream
        }
      }
    };

    const pump = async (): Promise<void> => {
      let carry = "";
      while (!closed && !stop.signal.aborted) {
        try {
          const extra: Record<string, string> = { accept: "text/event-stream" };
          if (lastId !== null) extra["last-event-id"] = lastId;
          const res: Response = await this.fetchImpl(`${this.baseUrl}/api/event`, {
            method: "GET",
            headers: this.headers(undefined, extra),
          });
          if (!res.ok || res.body === null) throw new Error(`event stream failed: ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            if (closed || stop.signal.aborted) {
              try {
                await reader.cancel();
              } catch {
                // already closed
              }
              return;
            }
            const { done, value } = await reader.read();
            if (done) break;
            carry += decoder.decode(value, { stream: true });
            const boundary = carry.lastIndexOf("\n\n");
            if (boundary !== -1) {
              const complete = carry.slice(0, boundary);
              carry = carry.slice(boundary + 2);
              parseFrames(complete);
            }
          }
          parseFrames(carry);
          carry = "";
        } catch {
          if (closed || stop.signal.aborted) return;
        }
        if (!closed && !stop.signal.aborted) await sleep(reconnectMs);
      }
    };
    void pump();

    const subscription: EventSubscription = {
      close: () => {
        closed = true;
        stop.abort();
      },
      lastEventId: () => lastId,
    };
    return subscription;
  }

  /**
   * Fetch `/openapi.json` and check that every operation in
   * OPENCODE_OPERATIONS exists with that method. Throws listing the
   * missing operations. The engine calls this for every enabled expert
   * on startup and refuses to start when anything is missing.
   */
  async assertContract(): Promise<void> {
    const res: Response = await this.fetchImpl(`${this.baseUrl}/openapi.json`, {
      method: "GET",
      headers: this.headers(undefined),
    });
    const text: string = await res.text();
    if (!res.ok)
      throw new OpenCodeError(`opencode GET /openapi.json failed: ${res.status}`, res.status, text);
    let spec: unknown;
    try {
      spec = JSON.parse(text) as unknown;
    } catch {
      throw new OpenCodeError("opencode /openapi.json is not JSON", 200, text.slice(0, 500));
    }
    const paths = (spec as { paths?: unknown }).paths;
    if (typeof paths !== "object" || paths === null)
      throw new OpenCodeError("opencode /openapi.json has no paths table", 200, text.slice(0, 500));
    const missing = checkOperationsAgainstSpec(OPENCODE_OPERATIONS, spec as OpenApiSpecShape);
    if (missing.length > 0)
      throw new OpenCodeError(
        `opencode server is missing operations the Dispatcher needs: ${missing.join(", ")}`,
        200,
        "",
      );
  }
}
