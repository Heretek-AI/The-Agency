import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, type PlanTaskInput } from "../api.ts";
import { RequireRole } from "./RequireRole.tsx";

function EmberField({
  label,
  value,
  onChange,
  testId,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  multiline?: boolean;
}): ReactNode {
  const cls =
    "mt-1 w-full rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]";
  return (
    <label className="block text-[11px] text-[#8b949e]">
      {label}
      {multiline === true ? (
        <textarea
          data-testid={testId}
          value={value}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      ) : (
        <input
          data-testid={testId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
    </label>
  );
}

function lines(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Inline plan editor for missions in `waiting-human`. Approvers edit
 * titles, objectives, paths, and acceptance criteria, then save via
 * PUT /api/missions/:id/plan before approving.
 */
export function PlanEditor({
  missionId,
  initial,
}: {
  missionId: string;
  initial: PlanTaskInput[];
}): ReactNode {
  const queryClient = useQueryClient();
  const [tasks, setTasks] = useState<PlanTaskInput[]>(initial);
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.updatePlan(missionId, tasks),
    onSuccess: () => {
      setMessage("Plan saved.");
      void queryClient.invalidateQueries({ queryKey: ["mission", missionId] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  function patch(index: number, next: Partial<PlanTaskInput>): void {
    setTasks((prev) => prev.map((t, i) => (i === index ? { ...t, ...next } : t)));
  }

  return (
    <div data-testid="plan-editor" className="flex flex-col gap-3">
      {tasks.map((task, i) => (
        <fieldset
          key={task.key}
          data-testid={`plan-item-${task.key}`}
          className="rounded border border-[#1f2937] bg-[#161b22] p-2"
        >
          <legend className="px-1 text-xs text-[#8b949e]">
            {task.key} · {task.expert}
          </legend>
          <EmberField
            label="Title"
            value={task.title ?? ""}
            testId={`plan-title-${task.key}`}
            onChange={(v) => patch(i, { title: v })}
          />
          <EmberField
            label="Objective"
            value={task.objective}
            testId={`plan-objective-${task.key}`}
            multiline
            onChange={(v) => patch(i, { objective: v })}
          />
          <EmberField
            label="Paths (one per line)"
            value={lines(task.paths)}
            testId={`plan-paths-${task.key}`}
            multiline
            onChange={(v) => patch(i, { paths: splitLines(v) })}
          />
          <EmberField
            label="Acceptance criteria (one per line)"
            value={lines(task.acceptance)}
            testId={`plan-acceptance-${task.key}`}
            multiline
            onChange={(v) => patch(i, { acceptance: splitLines(v) })}
          />
        </fieldset>
      ))}
      <div className="flex items-center gap-2">
        <RequireRole role="approver" action="edit plans">
          <button
            type="button"
            data-testid="plan-save"
            onClick={() => save.mutate()}
            className="rounded bg-[#00f0ff] px-3 py-1.5 text-xs font-semibold text-[#07090e]"
          >
            Save plan
          </button>
        </RequireRole>
        {message !== null && <span className="text-xs text-[#8b949e]">{message}</span>}
      </div>
    </div>
  );
}
