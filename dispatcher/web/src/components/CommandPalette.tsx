import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api.ts";

interface PaletteEntry {
  kind: string;
  label: string;
  run: () => void;
}

/** Command palette: Ctrl+K / Cmd+K fast navigation. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: () => api.missions(),
    enabled: open,
  });
  const fleet = useQuery({
    queryKey: ["fleet"],
    queryFn: () => api.fleet(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const out: PaletteEntry[] = [
      { kind: "action", label: "Go to Home / Inbox", run: () => void navigate({ to: "/" }) },
      { kind: "action", label: "Go to Missions", run: () => void navigate({ to: "/missions" }) },
      { kind: "action", label: "Go to Fleet", run: () => void navigate({ to: "/fleet" }) },
      { kind: "action", label: "Go to Audit Log", run: () => void navigate({ to: "/audit" }) },
      { kind: "action", label: "Go to Settings", run: () => void navigate({ to: "/settings" }) },
    ];
    for (const m of missions.data?.missions ?? []) {
      out.push({
        kind: "mission",
        label: `Mission ${m.id} — ${m.objective.slice(0, 60)}`,
        run: () => void navigate({ to: "/missions/$missionId", params: { missionId: m.id } }),
      });
    }
    for (const e of fleet.data?.experts ?? []) {
      out.push({
        kind: "expert",
        label: `Expert ${e.name} — ${e.health}`,
        run: () => void navigate({ to: "/fleet" }),
      });
    }
    const needle = filter.trim().toLowerCase();
    if (needle === "") return out.slice(0, 12);
    return out.filter((e) => e.label.toLowerCase().includes(needle)).slice(0, 12);
  }, [filter, fleet.data, missions.data, navigate]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          data-testid="command-palette"
          aria-label="Command palette"
          className="fixed left-1/2 top-[15%] z-50 w-[min(36rem,92vw)] -translate-x-1/2 rounded-lg border border-[#1f2937] bg-[#0d1118] p-0 shadow-xl"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input
            data-testid="command-palette-input"
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Jump to mission, expert, or view…"
            className="w-full border-b border-[#1f2937] bg-transparent px-4 py-3 text-sm text-[#e6edf3] outline-none placeholder:text-[#8b949e]"
          />
          <ul className="max-h-72 overflow-y-auto p-2">
            {entries.length === 0 && (
              <li className="px-3 py-2 text-sm text-[#8b949e]">No matches.</li>
            )}
            {entries.map((entry) => (
              <li key={`${entry.kind}:${entry.label}`}>
                <button
                  type="button"
                  onClick={() => {
                    entry.run();
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-[#e6edf3] hover:bg-[#161b22]"
                >
                  <span className="rounded border border-[#1f2937] px-1 text-[10px] uppercase text-[#8b949e]">
                    {entry.kind}
                  </span>
                  <span className="truncate">{entry.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
