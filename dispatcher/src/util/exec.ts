import { spawn, type ChildProcess } from "node:child_process";

export interface ExecResult {
  readonly exit: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export interface ExecOptions {
  readonly cwd?: string;
  /** Explicit environment. Required: there is no default that reads the parent's. */
  readonly env: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT = 256 * 1024;

/** Send SIGKILL to a process group; the group is already gone when this throws. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // ESRCH: the group is already gone, which is the outcome we want.
  }
}

/** True while any member of the group is still alive. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run a command with a first-class timeout outcome. The child is spawned as
 * the leader of a new process group; on timeout the whole group is killed
 * and confirmed gone, reporting `{ exit: 124, timedOut: true }` — never a
 * null exit. After a normal exit, remaining group members are killed too, so
 * no descendant outlives the call.
 */
export function execCmd(argv: string[], opts: ExecOptions): Promise<ExecResult> {
  const started = Date.now();
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  return new Promise((resolve) => {
    const file = argv[0];
    if (file === undefined || file === "") {
      resolve({
        exit: 127,
        stdout: "",
        stderr: "execCmd: empty argv",
        durationMs: 0,
        timedOut: false,
      });
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(file, argv.slice(1), {
        cwd: opts.cwd,
        env: { ...opts.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch {
      resolve({
        exit: 127,
        stdout: "",
        stderr: `execCmd: cannot spawn ${file}`,
        durationMs: 0,
        timedOut: false,
      });
      return;
    }
    const pid = child.pid;
    if (pid === undefined) {
      // The spawn already failed: swallow the coming error/close events,
      // which would otherwise throw on a listener-less emitter.
      child.on("error", () => {});
      child.on("close", () => {});
      resolve({
        exit: 127,
        stdout: "",
        stderr: `execCmd: no pid for ${file}`,
        durationMs: 0,
        timedOut: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exit: number): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ exit, stdout, stderr, durationMs: Date.now() - started, timedOut });
    };
    const onData = (chunk: Buffer, sink: "out" | "err"): void => {
      if (bytes >= maxBytes) return;
      const slice = chunk.subarray(0, maxBytes - bytes);
      bytes += slice.length;
      if (sink === "out") stdout += slice.toString("utf8");
      else stderr += slice.toString("utf8");
    };
    child.stdout?.on("data", (c: Buffer) => onData(c, "out"));
    child.stderr?.on("data", (c: Buffer) => onData(c, "err"));
    child.on("error", () => {
      killGroup(pid);
      finish(127);
    });
    child.on("close", (code) => {
      // Reap stragglers, then confirm the group is gone before reporting.
      killGroup(pid);
      void (async () => {
        for (let i = 0; i < 20 && groupAlive(pid); i++) await sleep(100);
        finish(timedOut ? 124 : (code ?? 1));
      })();
    });
    const timeoutMs = opts.timeoutMs;
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup(pid);
        // The close handler resolves once the group is confirmed gone.
      }, timeoutMs);
      timer.unref?.();
    }
  });
}

/** Run through the shell (for configured check commands). */
export function execShell(cmd: string, opts: ExecOptions): Promise<ExecResult> {
  return execCmd(["sh", "-c", cmd], opts);
}
