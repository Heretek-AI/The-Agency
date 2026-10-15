import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

const MISSION_COLORS: Record<string, string> = {
  planning: "bg-[#a855f7]/15 text-[#c4b5fd] border-[#a855f7]/40",
  "waiting-human": "bg-[#ffb700]/15 text-[#ffd166] border-[#ffb700]/40",
  running: "bg-[#00f0ff]/10 text-[#7ce7f4] border-[#00f0ff]/30",
  paused: "bg-[#ffb700]/15 text-[#ffd166] border-[#ffb700]/40",
  halted: "bg-[#ff0055]/15 text-[#ff8fab] border-[#ff0055]/40",
  done: "bg-[#00ff66]/10 text-[#86efac] border-[#00ff66]/30",
  failed: "bg-[#ff0055]/15 text-[#ff8fab] border-[#ff0055]/40",
  cancelled: "bg-[#8b949e]/15 text-[#8b949e] border-[#8b949e]/40",
};

const TASK_COLORS: Record<string, string> = {
  pending: "bg-[#8b949e]/15 text-[#8b949e] border-[#8b949e]/40",
  ready: "bg-[#00f0ff]/10 text-[#7ce7f4] border-[#00f0ff]/30",
  running: "bg-[#00f0ff]/10 text-[#7ce7f4] border-[#00f0ff]/30",
  "waiting-human": "bg-[#ffb700]/15 text-[#ffd166] border-[#ffb700]/40",
  done: "bg-[#00ff66]/10 text-[#86efac] border-[#00ff66]/30",
  failed: "bg-[#ff0055]/15 text-[#ff8fab] border-[#ff0055]/40",
  cancelled: "bg-[#8b949e]/15 text-[#8b949e] border-[#8b949e]/40",
};

export function StatusChip({
  status,
  kind = "mission",
}: {
  status: string;
  kind?: string;
}): ReactNode {
  const palette = kind === "task" ? TASK_COLORS : MISSION_COLORS;
  return (
    <span
      data-testid="status-chip"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        palette[status] ?? "bg-[#8b949e]/15 text-[#8b949e] border-[#8b949e]/40",
      )}
    >
      <span className="status-dot" style={{ backgroundColor: "currentColor" }} />
      {status}
    </span>
  );
}

export function HealthDot({ health }: { health: string }): ReactNode {
  const ok = health === "healthy";
  const color = ok ? "#00ff66" : "#ff0055";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className="status-dot"
        data-testid={ok ? "health-ok" : "health-bad"}
        style={{ backgroundColor: color }}
      />
      <span className="text-[#8b949e]">{health}</span>
    </span>
  );
}
