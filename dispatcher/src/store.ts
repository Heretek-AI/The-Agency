/**
 * Durable mission/task store (Stage 1c, Step 2). SQLite through
 * `bun:sqlite` in WAL mode with versioned migrations. This is the only
 * module that touches the database; every state change goes through
 * `transition`, which appends the audit event (shared context 9.12) and
 * commits the row change together with the audit `{ seq, hash }` anchor
 * in one SQLite transaction.
 *
 * Crash rule: if the process dies between the audit append and the
 * commit, the log is one event ahead of the database. On open, entries
 * past the highest anchored sequence are orphans: the store appends
 * `dispatcher.recovered` naming them and continues from the database.
 */
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AuditLog, type JournalEntry } from "./audit.js";
import { MissionSchema, TaskSchema, type Mission, type Task } from "./model.js";
import type { AllocationRegistry } from "./worktrees.js";

export interface StoreOptions {
  /** SQLite file, e.g. `<state>/dispatcher.db`. Its directory is created. */
  dbPath: string;
  /** Audit log directory, e.g. `<state>/audit`. */
  auditDir: string;
  /** Actor recorded on audit events. Defaults to `dispatcher`. */
  actor?: string;
}

export interface TransitionResult {
  seq: number;
  hash: string;
}

export interface Decision {
  at: string;
  taskId: string;
  decision: string;
  notes?: string;
}

export interface TaskEvent {
  at: string;
  event: unknown;
}

export interface Allocation {
  worktree: string;
  taskId: string;
  branch: string | null;
  confirmed: boolean;
  at: string;
}

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_tasks_mission ON tasks (mission_id);
   CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, mission_id TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS allocations (worktree TEXT PRIMARY KEY, task_id TEXT NOT NULL, branch TEXT, confirmed INTEGER NOT NULL, at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS anchors (seq INTEGER PRIMARY KEY, hash TEXT NOT NULL);`,
];

function parseMission(row: { data: string }): Mission {
  return MissionSchema.parse(JSON.parse(row.data) as unknown);
}

function parseTask(row: { data: string }): Task {
  return TaskSchema.parse(JSON.parse(row.data) as unknown);
}

export class Store {
  private constructor(
    private readonly db: Database,
    private readonly audit: AuditLog,
    private readonly actor: string,
  ) {}

  /**
   * In-process write serialization. The audit log has one writer: async
   * interleaving (SSE relays, supervisors) must not compute two entries
   * from the same tip. Every transition chains behind the previous one;
   * a failure does not stall the chain (its audit entry stays unanchored
   * and is named by recovery on the next open).
   */
  private tail: Promise<void> = Promise.resolve();

  static async open(options: StoreOptions): Promise<Store> {
    await mkdir(path.dirname(options.dbPath), { recursive: true });
    const audit = await AuditLog.open(options.auditDir);
    const store = new Store(
      new Database(options.dbPath, { create: true, readwrite: true }),
      audit,
      options.actor ?? "dispatcher",
    );
    try {
      store.db.exec("PRAGMA journal_mode = WAL;");
      store.migrate();
      await store.recoverOrphans();
    } catch (err) {
      store.db.close();
      await audit.close();
      throw err;
    }
    return store;
  }

  private migrate(): void {
    const table = this.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
      .get() as { name: string } | null;
    let from = 0;
    if (table !== null) {
      const current = this.db.query("SELECT version FROM schema_version WHERE id = 1").get() as {
        version: number;
      } | null;
      from = current?.version ?? 0;
    }
    if (from > SCHEMA_VERSION)
      throw new Error(`store schema v${from} is newer than v${SCHEMA_VERSION}`);
    for (let v = from; v < SCHEMA_VERSION; v++) {
      this.db.exec(MIGRATIONS[v]!);
      this.db
        .query(
          "INSERT INTO schema_version (id, version) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET version = ?",
        )
        .run(v + 1, v + 1);
    }
  }

  /**
   * Detect audit entries past the highest anchored sequence (a crash
   * between the audit append and the commit) and append
   * `dispatcher.recovered` naming them. Continues from the database.
   */
  private async recoverOrphans(): Promise<void> {
    const anchored = this.db.query("SELECT MAX(seq) AS maxSeq FROM anchors").get() as {
      maxSeq: number | null;
    } | null;
    const maxSeq = anchored?.maxSeq ?? 0;
    if (this.audit.length > maxSeq) {
      const orphaned = this.audit
        .list()
        .map((e) => e.seq)
        .filter((seq) => seq > maxSeq);
      await this.audit.append("dispatcher.recovered", { orphaned, anchorSeq: maxSeq }, this.actor);
    } else if (this.audit.length === 0) {
      await this.audit.append("dispatcher.started", { schemaVersion: SCHEMA_VERSION }, this.actor);
    }
  }

  /**
   * The only way to change mission/task state: append the audit event,
   * then commit the row change with the audit anchor atomically. `mutate`
   * is synchronous so a crash cannot split the transaction.
   */
  async transition(
    event: string,
    data: unknown,
    mutate: (tx: StoreTx) => void,
  ): Promise<TransitionResult> {
    const run = async (): Promise<TransitionResult> => {
      const entry: JournalEntry = await this.audit.append(event, data, this.actor);
      const tx = new StoreTx(this.db);
      try {
        this.db.transaction(() => {
          mutate(tx);
          this.db.query("INSERT INTO anchors (seq, hash) VALUES (?, ?)").run(entry.seq, entry.hash);
        })();
      } catch (err) {
        throw new Error(
          `transition ${event} committed audit seq ${entry.seq} but the database write failed: ${(err as Error).message}`,
        );
      }
      return { seq: entry.seq, hash: entry.hash };
    };
    const out = this.tail.then(run, run);
    this.tail = out.then(
      () => {},
      () => {},
    );
    return out;
  }

  /** Current audit tip, for landing commit trailers. */
  auditTip(): { seq: number; hash: string } {
    return { seq: this.audit.length, hash: this.audit.tipHash };
  }

  auditLength(): number {
    return this.audit.length;
  }

  listAudit(): JournalEntry[] {
    return this.audit.list();
  }

  async verifyAudit(): Promise<{ ok: boolean; reason?: string }> {
    return this.audit.verify();
  }

  getMission(id: string): Mission | undefined {
    const row = this.db.query("SELECT data FROM missions WHERE id = ?").get(id) as {
      data: string;
    } | null;
    return row === null ? undefined : parseMission(row);
  }

  listMissions(): Mission[] {
    const rows = this.db.query("SELECT data FROM missions ORDER BY rowid").all() as {
      data: string;
    }[];
    return rows.map(parseMission);
  }

  getTask(id: string): Task | undefined {
    const row = this.db.query("SELECT data FROM tasks WHERE id = ?").get(id) as {
      data: string;
    } | null;
    return row === null ? undefined : parseTask(row);
  }

  tasksForMission(missionId: string): Task[] {
    const rows = this.db
      .query("SELECT data FROM tasks WHERE mission_id = ? ORDER BY id")
      .all(missionId) as { data: string }[];
    return rows.map(parseTask);
  }

  listDecisions(missionId: string): Decision[] {
    const rows = this.db
      .query("SELECT at, data FROM decisions WHERE mission_id = ? ORDER BY id")
      .all(missionId) as { at: string; data: string }[];
    return rows.map((r) => ({ at: r.at, ...(JSON.parse(r.data) as Omit<Decision, "at">) }));
  }

  listTaskEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .query("SELECT at, data FROM task_events WHERE task_id = ? ORDER BY id")
      .all(taskId) as { at: string; data: string }[];
    return rows.map((r) => ({ at: r.at, event: JSON.parse(r.data) as unknown }));
  }

  listUnconfirmedAllocations(): Allocation[] {
    const rows = this.db
      .query(
        "SELECT worktree, task_id AS taskId, branch, confirmed, at FROM allocations WHERE confirmed = 0 ORDER BY worktree",
      )
      .all() as {
      worktree: string;
      taskId: string;
      branch: string | null;
      confirmed: number;
      at: string;
    }[];
    return rows.map((r) => ({ ...r, confirmed: r.confirmed !== 0 }));
  }

  listAllocationsForTask(taskId: string): Allocation[] {
    const rows = this.db
      .query(
        "SELECT worktree, task_id AS taskId, branch, confirmed, at FROM allocations WHERE task_id = ? ORDER BY worktree",
      )
      .all(taskId) as {
      worktree: string;
      taskId: string;
      branch: string | null;
      confirmed: number;
      at: string;
    }[];
    return rows.map((r) => ({ ...r, confirmed: r.confirmed !== 0 }));
  }

  anchorMatches(seq: number, hash: string): boolean {
    const row = this.db.query("SELECT hash FROM anchors WHERE seq = ?").get(seq) as {
      hash: string;
    } | null;
    return row?.hash === hash;
  }

  async close(): Promise<void> {
    this.db.close();
    await this.audit.close();
  }
}

/**
 * Crash-safe allocation register backed by the store: every record,
 * confirm, and release is its own audited transition.
 */
export function storeRegistry(store: Store): AllocationRegistry {
  return {
    record: (a) =>
      store
        .transition("worktree.allocated", a, (tx) =>
          tx.recordAllocation(a.worktree, a.taskId, a.branch),
        )
        .then(() => {}),
    confirm: (worktree) =>
      store
        .transition("worktree.confirmed", { worktree }, (tx) => tx.confirmAllocation(worktree))
        .then(() => {}),
    releaseWorktree: (worktree) =>
      store
        .transition("worktree.released", { worktree }, (tx) => tx.releaseAllocation(worktree))
        .then(() => {}),
  };
}

/** Row writes available inside `transition`. No status escapes this path. */
export class StoreTx {
  constructor(private readonly db: Database) {}

  putMission(mission: Mission): void {
    const parsed = MissionSchema.parse(mission);
    this.db
      .query(
        "INSERT INTO missions (id, status, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = ?, data = ?, updated_at = ?",
      )
      .run(
        parsed.id,
        parsed.status,
        JSON.stringify(parsed),
        parsed.updatedAt,
        parsed.status,
        JSON.stringify(parsed),
        parsed.updatedAt,
      );
  }

  putTask(task: Task): void {
    const parsed = TaskSchema.parse(task);
    this.db
      .query(
        "INSERT INTO tasks (id, mission_id, status, data, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mission_id = ?, status = ?, data = ?, updated_at = ?",
      )
      .run(
        parsed.id,
        parsed.missionId,
        parsed.status,
        JSON.stringify(parsed),
        new Date().toISOString(),
        parsed.missionId,
        parsed.status,
        JSON.stringify(parsed),
        new Date().toISOString(),
      );
  }

  appendDecision(missionId: string, decision: Omit<Decision, "at">): void {
    this.db
      .query("INSERT INTO decisions (mission_id, at, data) VALUES (?, ?, ?)")
      .run(missionId, new Date().toISOString(), JSON.stringify(decision));
  }

  appendTaskEvent(taskId: string, event: unknown): void {
    this.db
      .query("INSERT INTO task_events (task_id, at, data) VALUES (?, ?, ?)")
      .run(taskId, new Date().toISOString(), JSON.stringify(event));
  }

  deleteTask(id: string): void {
    this.db.query("DELETE FROM tasks WHERE id = ?").run(id);
    this.db.query("DELETE FROM task_events WHERE task_id = ?").run(id);
  }

  recordAllocation(worktree: string, taskId: string, branch: string | null): void {
    this.db
      .query(
        "INSERT INTO allocations (worktree, task_id, branch, confirmed, at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(worktree) DO UPDATE SET task_id = ?, branch = ?, confirmed = 0, at = ?",
      )
      .run(
        worktree,
        taskId,
        branch,
        new Date().toISOString(),
        taskId,
        branch,
        new Date().toISOString(),
      );
  }

  confirmAllocation(worktree: string): void {
    this.db.query("UPDATE allocations SET confirmed = 1 WHERE worktree = ?").run(worktree);
  }

  releaseAllocation(worktree: string): void {
    this.db.query("DELETE FROM allocations WHERE worktree = ?").run(worktree);
  }
}
