import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { useParams } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Background, Controls, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ApiError, api, type PlanTaskInput, type TaskSummary } from "../api.ts";
import { DirectorChat } from "../components/DirectorChat.tsx";
import { DiffViewer } from "../components/DiffViewer.tsx";
import { PlanEditor } from "../components/PlanEditor.tsx";
import { RequireRole } from "../components/RequireRole.tsx";
import { StatusChip } from "../components/status.tsx";
import { cn } from "../lib/cn.ts";

function ResultCard({ task }: { task: TaskSummary }): ReactNode {
  const result = task.result as {
    summary?: string;
    verification?: Array<{ command: string; exit: number; observed: string }>;
    question?: string | null;
  } | null;
  if (result === null || typeof result !== "object") return null;
  return (
    <div
      data-testid={`result-card-${task.id}`}
      className="mt-2 rounded border border-[#1f2937] bg-[#161b22] p-2 text-xs"
    >
      <div className="font-semibold text-[#e6edf3]">RESULT / VERDICT</div>
      {typeof result.summary === "string" && (
        <p className="mt-1 text-[#8b949e]">{result.summary}</p>
      )}
      {Array.isArray(result.verification) &&
        result.verification.map((v, i) => (
          <div key={i} className="code-surface mt-1 rounded p-1 font-mono">
            {v.command} → exit {v.exit}: {v.observed}
          </div>
        ))}
      {typeof result.question === "string" && result.question !== "" && (
        <p className="mt-1 text-[#ffd166]">Blocked: {result.question}</p>
      )}
    </div>
  );
}

function PipelineTab({ tasks }: { tasks: TaskSummary[] }): ReactNode {
  if (tasks.length === 0) return <p className="text-xs text-[#8b949e]">No tasks yet.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {tasks.map((t) => (
        <li
          key={t.id}
          data-testid={`pipeline-task-${t.id}`}
          className="rounded border border-[#1f2937] bg-[#0d1118] p-2"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold">{t.id}</span>
            <StatusChip status={t.status} kind="task" />
            <span className="text-[#8b949e]">
              {t.role} · attempt {t.attempts}
              {t.expert !== null ? ` · ${t.expert}` : ""}
            </span>
          </div>
          <div className="mt-1 text-sm">{t.title}</div>
          {t.reason !== null && <div className="text-xs text-[#ff8fab]">{t.reason}</div>}
          <ResultCard task={t} />
        </li>
      ))}
    </ol>
  );
}

function layoutGraph(tasks: TaskSummary[]): {
  nodes: Array<{
    id: string;
    position: { x: number; y: number };
    data: { label: string };
    style: CSSProperties;
  }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  const depth = new Map<string, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  function rank(id: string, seen: string[] = []): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.includes(id)) return 0;
    const task = byId.get(id);
    if (task === undefined || task.deps.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    const d = 1 + Math.max(...task.deps.map((dep) => rank(dep, [...seen, id])));
    depth.set(id, d);
    return d;
  }
  for (const t of tasks) rank(t.id);
  const lanes = new Map<number, number>();
  const nodes = tasks.map((t) => {
    const d = depth.get(t.id) ?? 0;
    const lane = lanes.get(d) ?? 0;
    lanes.set(d, lane + 1);
    const border =
      t.status === "failed"
        ? "#ff0055"
        : t.status === "done"
          ? "#00ff66"
          : t.status === "running"
            ? "#00f0ff"
            : "#1f2937";
    return {
      id: t.id,
      position: { x: d * 220, y: lane * 90 },
      data: { label: `${t.id} (${t.status})` },
      style: {
        background: "#0d1118",
        color: "#e6edf3",
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: 8,
        fontSize: 12,
      },
    };
  });
  const edges = tasks.flatMap((t) =>
    t.deps.map((dep) => ({ id: `${dep}->${t.id}`, source: dep, target: t.id })),
  );
  return { nodes, edges };
}

function GraphTab({ tasks }: { tasks: TaskSummary[] }): ReactNode {
  if (tasks.length === 0) return <p className="text-xs text-[#8b949e]">No tasks yet.</p>;
  const { nodes, edges } = layoutGraph(tasks);
  return (
    <div
      data-testid="task-graph"
      style={{ height: 420 }}
      className="rounded border border-[#1f2937] bg-[#07090e]"
    >
      <ReactFlow nodes={nodes} edges={edges} fitView colorMode="dark">
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

function DiffTab({ tasks }: { tasks: TaskSummary[] }): ReactNode {
  const [selected, setSelected] = useState<string>(tasks.find((t) => t.branch !== null)?.id ?? "");
  const diff = useQuery({
    queryKey: ["diff", selected],
    queryFn: () => api.taskDiff(selected),
    enabled: selected !== "",
  });
  useEffect(() => {
    if (selected === "" && tasks.length > 0) {
      const first = tasks.find((t) => t.branch !== null) ?? tasks[0];
      if (first !== undefined) setSelected(first.id);
    }
  }, [selected, tasks]);
  return (
    <div className="flex flex-col gap-2">
      <select
        data-testid="diff-task-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Task diff"
        className="w-full max-w-md rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
      >
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id} — {t.title.slice(0, 50)}
          </option>
        ))}
      </select>
      {diff.isError && (
        <p className="text-xs text-[#ff8fab]">
          {diff.error instanceof ApiError ? diff.error.message : "diff unavailable"}
        </p>
      )}
      {diff.data !== undefined && <DiffViewer taskId={selected} diff={diff.data.diff} />}
    </div>
  );
}

function ArtifactsTab({ tasks }: { tasks: TaskSummary[] }): ReactNode {
  const [selected, setSelected] = useState<string>(tasks[0]?.id ?? "");
  const task = tasks.find((t) => t.id === selected);
  const diff = useQuery({
    queryKey: ["diff", selected],
    queryFn: () => api.taskDiff(selected),
    enabled: selected !== "" && task?.branch !== null && task?.branch !== undefined,
    retry: false,
  });
  return (
    <div className="flex flex-col gap-2">
      <select
        data-testid="artifacts-task-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Task logs"
        className="w-full max-w-md rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
      >
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id} — {t.title.slice(0, 50)}
          </option>
        ))}
      </select>
      {task !== undefined && (
        <div
          data-testid="artifacts-log"
          className="code-surface overflow-x-auto rounded border border-[#1f2937] p-2 text-xs"
        >
          <div>
            task {task.id} · {task.status} · attempt {task.attempts}
          </div>
          <div>
            branch {task.branch ?? "—"} · head {task.headSha ?? "—"} · landed{" "}
            {task.landedSha ?? "—"}
          </div>
          {task.reason !== null && <div>reason: {task.reason}</div>}
          {diff.data !== undefined && diff.data.diff !== "" && (
            <pre className="mt-2 whitespace-pre-wrap">{diff.data.diff.slice(0, 4000)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

export function MissionDetail(): ReactNode {
  const { missionId } = useParams({ strict: false }) as { missionId: string };
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("pipeline");
  const [rejectReason, setRejectReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => api.mission(missionId),
    refetchInterval: 5_000,
  });

  const mission = detail.data?.mission;
  const tasks = detail.data?.tasks ?? [];
  const rawPlan = detail.data?.plan;
  const rawDirector =
    rawPlan !== null &&
    rawPlan !== undefined &&
    Array.isArray((rawPlan as { director?: unknown }).director)
      ? (rawPlan as unknown as { director: Array<Record<string, unknown>> }).director
      : [];
  // GET returns engine tasks (`id`, nested `input`); PUT takes the MCP shape.
  const plan: PlanTaskInput[] = rawDirector.map((entry) => {
    const nested =
      entry["input"] !== null && typeof entry["input"] === "object"
        ? (entry["input"] as Record<string, unknown>)
        : {};
    const pick = (name: string): unknown =>
      entry[name] !== undefined ? entry[name] : nested[name];
    const stringList = (value: unknown): string[] | undefined =>
      Array.isArray(value) ? (value as string[]) : undefined;
    const text = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;
    return {
      key: String(entry["key"] ?? entry["id"] ?? ""),
      expert: String(entry["expert"] ?? ""),
      title: text(entry["title"]),
      role: text(entry["role"]),
      objective: String(pick("objective") ?? ""),
      context: text(pick("context")),
      constraints: text(pick("constraints")),
      acceptance: stringList(pick("acceptance")),
      paths: stringList(pick("paths")),
      deps: stringList(entry["deps"]),
    };
  });
  const waiting = mission?.status === "waiting-human";

  function afterAction(ok: string): void {
    setMessage(ok);
    void queryClient.invalidateQueries({ queryKey: ["mission", missionId] });
    void queryClient.invalidateQueries({ queryKey: ["missions"] });
  }
  const approve = useMutation({
    mutationFn: () => api.approve(missionId),
    onSuccess: () => afterAction("Approved; mission is running."),
    onError: (err: Error) => setMessage(err.message),
  });
  const reject = useMutation({
    mutationFn: () => api.reject(missionId, rejectReason),
    onSuccess: () => afterAction("Rejected."),
    onError: (err: Error) => setMessage(err.message),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancel(missionId),
    onSuccess: () => afterAction("Cancelled."),
    onError: (err: Error) => setMessage(err.message),
  });

  if (detail.isLoading) return <p className="text-sm text-[#8b949e]">Loading mission…</p>;
  if (detail.isError || mission === undefined)
    return (
      <p role="alert" className="text-sm text-[#ff8fab]">
        {detail.error instanceof Error ? detail.error.message : "mission not found"}
      </p>
    );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 data-testid="mission-title" className="text-base font-semibold">
          {mission.id}
        </h1>
        <StatusChip status={mission.status} />
        <span className="text-xs text-[#8b949e]">{mission.repo}</span>
        <div className="ml-auto flex items-center gap-2">
          {waiting && (
            <>
              <RequireRole role="approver" action="approve plans">
                <button
                  type="button"
                  data-testid="detail-approve"
                  onClick={() => approve.mutate()}
                  className="rounded bg-[#00ff66] px-3 py-1.5 text-xs font-semibold text-[#07090e]"
                >
                  Approve
                </button>
              </RequireRole>
              <RequireRole role="approver" action="reject plans">
                <button
                  type="button"
                  data-testid="detail-reject"
                  onClick={() => reject.mutate()}
                  className="rounded border border-[#ff0055]/50 px-3 py-1.5 text-xs text-[#ff8fab]"
                >
                  Reject
                </button>
              </RequireRole>
            </>
          )}
          <RequireRole role="approver" action="cancel missions">
            <button
              type="button"
              data-testid="detail-cancel"
              onClick={() => cancel.mutate()}
              className="rounded border border-[#1f2937] px-3 py-1.5 text-xs text-[#8b949e]"
            >
              Cancel
            </button>
          </RequireRole>
        </div>
      </div>
      {waiting && (
        <div className="flex items-center gap-2">
          <input
            data-testid="detail-reject-reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Rejection reason…"
            aria-label="Rejection reason"
            className="max-w-md flex-1 rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          />
        </div>
      )}
      {message !== null && <p className="text-xs text-[#8b949e]">{message}</p>}
      <p className="text-sm text-[#8b949e]">{mission.objective}</p>

      {waiting && plan.length > 0 && (
        <section
          aria-label="Plan"
          className="rounded-lg border border-[#ffb700]/40 bg-[#0d1118] p-3"
        >
          <h2 className="mb-2 text-sm font-semibold text-[#ffd166]">
            Pending plan — review and edit
          </h2>
          <PlanEditor missionId={missionId} initial={plan} />
        </section>
      )}

      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <div className="flex min-h-[28rem] flex-col rounded-lg border border-[#1f2937] bg-[#0d1118]">
          <h2 className="border-b border-[#1f2937] px-3 py-2 text-sm font-semibold text-[#a855f7]">
            Director chat
          </h2>
          <div className="min-h-0 flex-1">
            <DirectorChat missionId={missionId} />
          </div>
        </div>
        <div className="rounded-lg border border-[#1f2937] bg-[#0d1118] p-3">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List
              aria-label="Mission mechanics"
              className="flex flex-wrap gap-1 border-b border-[#1f2937] pb-2"
            >
              {(
                [
                  ["pipeline", "Pipeline"],
                  ["graph", "Task Graph"],
                  ["diff", "Diff"],
                  ["artifacts", "Artifacts & Logs"],
                ] as Array<[string, string]>
              ).map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  data-testid={`tab-${value}`}
                  className={cn(
                    "rounded px-3 py-1.5 text-xs",
                    tab === value ? "bg-[#161b22] text-[#00f0ff]" : "text-[#8b949e]",
                  )}
                >
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="pt-3">
              <Tabs.Content value="pipeline">
                <PipelineTab tasks={tasks} />
              </Tabs.Content>
              <Tabs.Content value="graph">
                <GraphTab tasks={tasks} />
              </Tabs.Content>
              <Tabs.Content value="diff">
                <DiffTab tasks={tasks} />
              </Tabs.Content>
              <Tabs.Content value="artifacts">
                <ArtifactsTab tasks={tasks} />
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </div>
      </div>
    </div>
  );
}
