import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { StatusChip } from "../components/status.tsx";

const KANBAN_COLUMNS = [
  { key: "planning", label: "Planning" },
  { key: "waiting-human", label: "Awaiting Approval" },
  { key: "running", label: "Executing" },
  { key: "verifying", label: "Verifying" },
  { key: "landed", label: "Landed" },
  { key: "done", label: "Done" },
];

/** Map engine statuses onto the six Kanban columns. */
export function kanbanColumn(status: string): string {
  if (status === "paused") return "running";
  if (status === "halted" || status === "failed") return "running";
  if (status === "cancelled") return "done";
  return KANBAN_COLUMNS.some((c) => c.key === status) ? status : "running";
}

export function Missions(): ReactNode {
  const [mode, setMode] = useState<"kanban" | "list">("kanban");
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: () => api.missions(),
    refetchInterval: 5_000,
  });

  const list = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (missions.data?.missions ?? []).filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (needle === "") return true;
      return (
        m.id.toLowerCase().includes(needle) ||
        m.objective.toLowerCase().includes(needle) ||
        m.repo.toLowerCase().includes(needle)
      );
    });
  }, [filter, missions.data, statusFilter]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-base font-semibold">Missions</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            data-testid="missions-search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search missions…"
            aria-label="Search missions"
            className="rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          />
          <select
            data-testid="missions-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded border border-[#1f2937] bg-[#161b22] px-2 py-1 text-xs text-[#e6edf3]"
          >
            <option value="all">All statuses</option>
            <option value="planning">Planning</option>
            <option value="waiting-human">Awaiting Approval</option>
            <option value="running">Executing</option>
            <option value="halted">Halted</option>
            <option value="done">Done</option>
          </select>
          <button
            type="button"
            data-testid="missions-mode-kanban"
            onClick={() => setMode("kanban")}
            className="rounded border border-[#1f2937] px-2 py-1 text-xs"
          >
            Kanban
          </button>
          <button
            type="button"
            data-testid="missions-mode-list"
            onClick={() => setMode("list")}
            className="rounded border border-[#1f2937] px-2 py-1 text-xs"
          >
            List
          </button>
        </div>
      </div>

      {mode === "kanban" && (
        <div data-testid="missions-kanban" className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {KANBAN_COLUMNS.map((col) => (
            <section
              key={col.key}
              data-testid={`kanban-${col.key}`}
              className="min-h-32 rounded-lg border border-[#1f2937] bg-[#0d1118] p-2"
            >
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[#8b949e]">
                {col.label}
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {list
                  .filter((m) => kanbanColumn(m.status) === col.key)
                  .map((m) => (
                    <Link
                      key={m.id}
                      to="/missions/$missionId"
                      params={{ missionId: m.id }}
                      data-testid={`mission-card-${m.id}`}
                      className="rounded border border-[#1f2937] bg-[#161b22] p-2 hover:border-[#00f0ff]/50"
                    >
                      <div className="text-xs font-semibold">{m.id}</div>
                      <div className="mt-1 line-clamp-3 text-xs text-[#8b949e]">{m.objective}</div>
                      <div className="mt-2">
                        <StatusChip status={m.status} />
                      </div>
                    </Link>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {mode === "list" && (
        <table data-testid="missions-list" className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider text-[#8b949e]">
              <th className="px-2 py-1">Mission</th>
              <th className="px-2 py-1">Repo</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Objective</th>
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.id} className="border-t border-[#1f2937]">
                <td className="px-2 py-2">
                  <Link
                    to="/missions/$missionId"
                    params={{ missionId: m.id }}
                    className="text-[#00f0ff] hover:underline"
                  >
                    {m.id}
                  </Link>
                </td>
                <td className="px-2 py-2 text-[#8b949e]">{m.repo}</td>
                <td className="px-2 py-2">
                  <StatusChip status={m.status} />
                </td>
                <td className="max-w-md truncate px-2 py-2 text-[#8b949e]">{m.objective}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
