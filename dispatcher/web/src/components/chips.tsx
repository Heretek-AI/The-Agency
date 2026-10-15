import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { RoleBadge } from "./RequireRole.tsx";

export function FleetPulseChip(): ReactNode {
  const fleet = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api.fleet(),
    refetchInterval: 10_000,
  });
  const experts = fleet.data?.experts ?? [];
  const healthy = experts.filter((e) => e.health === "healthy").length;
  return (
    <span
      data-testid="fleet-pulse"
      title={`${healthy} of ${experts.length} experts healthy`}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#1f2937] bg-[#0d1118] px-2.5 py-1 text-xs text-[#e6edf3]"
    >
      <span
        className="status-dot"
        style={{
          backgroundColor: experts.length > 0 && healthy === experts.length ? "#00ff66" : "#ffb700",
        }}
      />
      Fleet {healthy}/{experts.length}
    </span>
  );
}

export function QuotaMeterChip(): ReactNode {
  const usage = useQuery({
    queryKey: ["usage"],
    queryFn: () => api.usage(),
    refetchInterval: 30_000,
  });
  const running = usage.data?.runningMissions ?? 0;
  const cap = usage.data?.maxConcurrent ?? 0;
  const ratio = cap > 0 ? running / cap : 0;
  const color = ratio > 0.8 ? "#ff0055" : ratio >= 0.5 ? "#ffb700" : "#00ff66";
  return (
    <span
      data-testid="quota-meter"
      title={usage.data?.note ?? "usage window headroom"}
      className="inline-flex items-center gap-1.5 rounded-full border border-[#1f2937] bg-[#0d1118] px-2.5 py-1 text-xs text-[#e6edf3]"
    >
      <span className="status-dot" style={{ backgroundColor: color }} />
      Go {running}/{cap}
    </span>
  );
}

export function InboxBell({ count }: { count: number }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        data-testid="inbox-bell"
        aria-label={`Attention inbox, ${count} waiting`}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex items-center rounded-md border border-[#1f2937] bg-[#0d1118] px-2.5 py-1 text-xs text-[#e6edf3]"
      >
        Bell{" "}
        {count > 0 && (
          <span
            data-testid="inbox-count"
            className="ml-1.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#ffb700] px-1 text-[11px] font-bold text-[#07090e]"
          >
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-md border border-[#1f2937] bg-[#0d1118] p-3 text-xs text-[#8b949e]">
          {count === 0
            ? "Nothing needs a human right now."
            : `${count} mission${count === 1 ? "" : "s"} waiting for a human. Open Home / Inbox to triage.`}
        </div>
      )}
    </div>
  );
}

export function UserChip(): ReactNode {
  const { user, logout } = useAuth();
  if (user === null) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="user-avatar"
        aria-hidden="true"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#a855f7]/20 text-xs font-bold text-[#c4b5fd]"
      >
        {user.username.slice(0, 1).toUpperCase()}
      </span>
      <span data-testid="user-name" className="hidden text-xs text-[#e6edf3] sm:inline">
        {user.username}
      </span>
      <RoleBadge role={user.role} />
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded border border-[#1f2937] px-2 py-0.5 text-xs text-[#8b949e] hover:text-[#e6edf3]"
      >
        Out
      </button>
    </span>
  );
}
