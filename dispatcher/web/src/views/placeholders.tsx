import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import { useAuth } from "../auth.tsx";
import { RoleBadge } from "../components/RequireRole.tsx";
import { StatusChip } from "../components/status.tsx";

export function ReposPlaceholder(): ReactNode {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-[#1f2937] bg-[#0d1118] p-4">
      <h1 className="text-base font-semibold">Repos</h1>
      <p data-testid="repos-placeholder" className="mt-1 text-sm text-[#8b949e]">
        Repository onboarding arrives in Stage 3a. Registered repositories and the ownership/checks
        proposal wizard will live here.
      </p>
    </div>
  );
}

export function QueuePlaceholder(): ReactNode {
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.usage() });
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-[#1f2937] bg-[#0d1118] p-4">
      <h1 className="text-base font-semibold">Queue &amp; Usage</h1>
      <p data-testid="queue-placeholder" className="mt-1 text-sm text-[#8b949e]">
        Priority queue management and the Go quota ledger arrive in Stage 3b. Live headroom:{" "}
        {usage.data?.runningMissions ?? "—"} running / {usage.data?.maxConcurrent ?? "—"} concurrent
        missions.
      </p>
    </div>
  );
}

export function AuditLog(): ReactNode {
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions() });
  const details = useQuery({
    queryKey: ["audit-details"],
    queryFn: async () => {
      const list = (await api.missions()).missions;
      const out: Array<{ missionId: string; decisions: Array<Record<string, unknown>> }> = [];
      for (const m of list.slice(0, 25)) {
        try {
          const detail = await api.mission(m.id);
          out.push({ missionId: m.id, decisions: detail.decisions });
        } catch {
          // One unreadable mission must not hide the rest of the log.
        }
      }
      return out;
    },
    enabled: missions.isSuccess,
  });
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3">
      <h1 className="text-base font-semibold">Audit Log</h1>
      <p className="text-sm text-[#8b949e]">
        Decision trail per mission. The hash-chained visualizer arrives in Stage 5.
      </p>
      <div data-testid="audit-list" className="flex flex-col gap-2">
        {(details.data ?? []).map((entry) => (
          <article
            key={entry.missionId}
            data-testid={`audit-${entry.missionId}`}
            className="rounded border border-[#1f2937] bg-[#0d1118] p-3"
          >
            <h2 className="text-sm font-semibold">{entry.missionId}</h2>
            {entry.decisions.length === 0 && (
              <p className="text-xs text-[#8b949e]">No recorded decisions.</p>
            )}
            <ul className="mt-1 flex flex-col gap-1">
              {entry.decisions.map((d, i) => (
                <li key={i} className="code-surface rounded p-1 font-mono text-xs">
                  {JSON.stringify(d)}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

export function Settings(): ReactNode {
  const { user } = useAuth();
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions() });
  const sample = missions.data?.missions[0];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-base font-semibold">Settings</h1>
      <section className="rounded border border-[#1f2937] bg-[#0d1118] p-3">
        <h2 className="text-sm font-semibold">Account</h2>
        <p className="mt-1 text-sm text-[#8b949e]">
          {user?.username ?? "unknown"} <RoleBadge role={user?.role ?? "viewer"} />
        </p>
      </section>
      <section className="rounded border border-[#1f2937] bg-[#0d1118] p-3">
        <h2 className="text-sm font-semibold">Sample mission status</h2>
        {sample !== undefined && (
          <div className="mt-1">
            <StatusChip status={sample.status} />
          </div>
        )}
      </section>
      <section className="rounded border border-[#1f2937] bg-[#0d1118] p-3">
        <h2 className="text-sm font-semibold">Autonomy</h2>
        <p data-testid="settings-placeholder" className="mt-1 text-sm text-[#8b949e]">
          The autonomy dial and queue priorities arrive in Stage 3b (admin only).
        </p>
      </section>
    </div>
  );
}
