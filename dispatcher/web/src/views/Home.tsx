import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { RequireRole } from "../components/RequireRole.tsx";
import { StatusChip } from "../components/status.tsx";

function ApproveButtons({ missionId }: { missionId: string }): ReactNode {
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["missions"] });
  };
  const approve = useMutation({
    mutationFn: () => api.approve(missionId),
    onSuccess: () => {
      setMessage("Approved.");
      refresh();
    },
    onError: (err: Error) => setMessage(err.message),
  });
  const reject = useMutation({
    mutationFn: () => api.reject(missionId, reason),
    onSuccess: () => {
      setMessage("Rejected.");
      setRejectOpen(false);
      refresh();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <RequireRole role="approver" action="approve plans">
        <button
          type="button"
          data-testid={`approve-${missionId}`}
          onClick={() => approve.mutate()}
          className="rounded bg-[#00ff66] px-3 py-1.5 text-xs font-semibold text-[#07090e] disabled:opacity-50"
        >
          Approve
        </button>
      </RequireRole>
      <RequireRole role="approver" action="reject plans">
        <button
          type="button"
          data-testid={`reject-${missionId}`}
          onClick={() => setRejectOpen((v) => !v)}
          className="rounded border border-[#ff0055]/50 px-3 py-1.5 text-xs text-[#ff8fab]"
        >
          Reject
        </button>
      </RequireRole>
      {rejectOpen && (
        <form
          className="flex w-full items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reject.mutate();
          }}
        >
          <input
            data-testid={`reject-reason-${missionId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required by server)"
            aria-label="Rejection reason"
            className="min-w-0 flex-1 rounded border border-[#1f2937] bg-[#161b22] px-2 py-1.5 text-xs text-[#e6edf3]"
          />
          <button
            type="submit"
            data-testid={`reject-confirm-${missionId}`}
            className="rounded border border-[#ff0055]/50 px-3 py-1.5 text-xs text-[#ff8fab]"
          >
            Confirm
          </button>
        </form>
      )}
      {message !== null && <span className="text-xs text-[#8b949e]">{message}</span>}
    </div>
  );
}

function ResumeForm({ missionId, taskId }: { missionId: string; taskId: string }): ReactNode {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: () => api.decide(taskId, "rework", notes),
    onSuccess: () => {
      setMessage("Resume notes recorded; task re-queued.");
      void queryClient.invalidateQueries({ queryKey: ["missions"] });
    },
    onError: (err: Error) => setMessage(err.message),
  });
  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        decide.mutate();
      }}
    >
      <input
        data-testid={`resume-notes-${missionId}`}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Resume note (required)"
        aria-label="Resume note"
        className="min-w-0 flex-1 rounded border border-[#1f2937] bg-[#161b22] px-2 py-1.5 text-xs text-[#e6edf3]"
      />
      <RequireRole role="approver" action="resume halted missions">
        <button
          type="button"
          data-testid={`resume-${missionId}`}
          onClick={() => decide.mutate()}
          className="rounded border border-[#ffb700]/50 px-3 py-1.5 text-xs text-[#ffd166]"
        >
          Resume
        </button>
      </RequireRole>
      {message !== null && <span className="text-xs text-[#8b949e]">{message}</span>}
    </form>
  );
}

export function Home(): ReactNode {
  const [objective, setObjective] = useState("");
  const queryClient = useQueryClient();
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: () => api.missions(),
    refetchInterval: 5_000,
  });
  const create = useMutation({
    mutationFn: () => api.createMission(objective),
    onSuccess: () => {
      setObjective("");
      void queryClient.invalidateQueries({ queryKey: ["missions"] });
    },
  });

  const list = missions.data?.missions ?? [];
  const attention = list.filter((m) => m.status === "waiting-human" || m.status === "halted");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <section className="rounded-lg border border-[#1f2937] bg-[#0d1118] p-4">
        <h1 className="text-base font-semibold">Home / Inbox</h1>
        <p className="text-sm text-[#8b949e]">
          {attention.length} mission{attention.length === 1 ? "" : "s"} need
          {attention.length === 1 ? "s" : ""} a human.
        </p>
        <RequireRole role="approver" action="create missions">
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (objective.trim() !== "") create.mutate();
            }}
          >
            <input
              data-testid="new-mission-objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="New mission objective…"
              aria-label="New mission objective"
              className="min-w-0 flex-1 rounded border border-[#1f2937] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]"
            />
            <button
              type="submit"
              data-testid="new-mission-submit"
              className="rounded bg-[#00f0ff] px-3 py-2 text-sm font-semibold text-[#07090e]"
            >
              Start
            </button>
          </form>
        </RequireRole>
      </section>

      {attention.length === 0 && (
        <p data-testid="inbox-empty" className="text-sm text-[#8b949e]">
          Inbox zero. No plan approvals, blocked questions, or halted missions.
        </p>
      )}

      {attention.map((m) => (
        <article
          key={m.id}
          data-testid={`inbox-card-${m.id}`}
          className="rounded-lg border border-[#ffb700]/40 bg-[#0d1118] p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={m.status} />
            <Link
              to="/missions/$missionId"
              params={{ missionId: m.id }}
              className="text-sm font-semibold text-[#00f0ff] hover:underline"
            >
              {m.id}
            </Link>
            <span className="text-xs text-[#8b949e]">{m.repo}</span>
          </div>
          <p className="mt-2 text-sm">{m.objective}</p>
          {m.status === "waiting-human" && <ApproveButtons missionId={m.id} />}
          {m.status === "halted" && (
            <MissionTasks
              missionId={m.id}
              render={(taskId) => <ResumeForm missionId={m.id} taskId={taskId} />}
            />
          )}
        </article>
      ))}
    </div>
  );
}

function MissionTasks({
  missionId,
  render,
}: {
  missionId: string;
  render: (waitingTaskId: string) => ReactNode;
}): ReactNode {
  const detail = useQuery({
    queryKey: ["mission", missionId],
    queryFn: () => api.mission(missionId),
  });
  const waiting = detail.data?.tasks.find((t) => t.status === "waiting-human");
  if (waiting === undefined)
    return (
      <p className="mt-2 text-xs text-[#8b949e]">
        No task is waiting; use Cancel on the mission detail page.
      </p>
    );
  return <>{render(waiting.id)}</>;
}
