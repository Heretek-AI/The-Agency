import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import {
  Bell,
  Boxes,
  FolderGit2,
  Gauge,
  Home,
  ListChecks,
  Rocket,
  ScrollText,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { FleetPulseChip, InboxBell, QuotaMeterChip, UserChip } from "./chips.tsx";
import { cn } from "../lib/cn.ts";

const NAV = [
  { to: "/", label: "Home / Inbox", icon: Home, testId: "nav-home" },
  { to: "/missions", label: "Missions", icon: Rocket, testId: "nav-missions" },
  { to: "/fleet", label: "Fleet", icon: Boxes, testId: "nav-fleet" },
  { to: "/repos", label: "Repos", icon: FolderGit2, testId: "nav-repos" },
  { to: "/queue", label: "Queue & Usage", icon: Gauge, testId: "nav-queue" },
  { to: "/audit", label: "Audit Log", icon: ScrollText, testId: "nav-audit" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, testId: "nav-settings" },
];

function NavList({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          data-testid={item.testId}
          onClick={onNavigate}
          activeOptions={{ exact: item.to === "/" }}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[#8b949e] hover:bg-[#161b22] hover:text-[#e6edf3] [&.active]:bg-[#161b22] [&.active]:text-[#00f0ff]"
        >
          <item.icon size={16} aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function Shell(): ReactNode {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const missions = useQuery({
    queryKey: ["missions"],
    queryFn: () => api.missions(),
    refetchInterval: 5_000,
  });
  const waiting = (missions.data?.missions ?? []).filter(
    (m) => m.status === "waiting-human" || m.status === "halted",
  ).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col bg-[#07090e] text-[#e6edf3]">
      <header className="flex items-center gap-2 border-b border-[#1f2937] bg-[#0d1118] px-3 py-2">
        <button
          type="button"
          data-testid="mobile-menu"
          aria-label="Open navigation"
          onClick={() => setMobileNav(true)}
          className="rounded border border-[#1f2937] px-2 py-1 text-xs md:hidden"
        >
          Menu
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks size={16} className="text-[#00f0ff]" aria-hidden="true" />
          <span className="hidden sm:inline">The Agency</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <FleetPulseChip />
          <QuotaMeterChip />
          <Link to="/" aria-label="Open inbox">
            <InboxBell count={waiting} />
          </Link>
          <button
            type="button"
            data-testid="command-palette-button"
            onClick={() => setPaletteOpen(true)}
            title="Ctrl+K / Cmd+K"
            className="hidden rounded border border-[#1f2937] bg-[#0d1118] px-2.5 py-1 text-xs text-[#8b949e] sm:inline"
          >
            Ctrl+K
          </button>
          <UserChip />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-[#1f2937] bg-[#0d1118] md:block">
          <NavList />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 pb-24 md:pb-4">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Mobile"
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 border-t border-[#1f2937] bg-[#0d1118] md:hidden",
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div data-testid="mobile-dock" className="grid grid-cols-5 gap-1 p-2">
          {NAV.slice(0, 5).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              data-testid={`dock-${item.testId}`}
              activeOptions={{ exact: item.to === "/" }}
              className="flex flex-col items-center gap-1 rounded px-1 py-1.5 text-[10px] text-[#8b949e] [&.active]:text-[#00f0ff]"
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label.split(" ")[0]}
            </Link>
          ))}
        </div>
      </nav>

      <Dialog.Root open={mobileNav} onOpenChange={setMobileNav}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
          <Dialog.Content
            data-testid="mobile-sidebar"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 z-40 w-72 bg-[#0d1118] p-0 md:hidden"
          >
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div className="flex items-center justify-between border-b border-[#1f2937] p-3">
              <span className="text-sm font-semibold">The Agency</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileNav(false)}
                className="rounded border border-[#1f2937] p-1"
              >
                <X size={16} />
              </button>
            </div>
            <NavList onNavigate={() => setMobileNav(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

export function BellIcon(): ReactNode {
  return <Bell size={14} aria-hidden="true" />;
}
