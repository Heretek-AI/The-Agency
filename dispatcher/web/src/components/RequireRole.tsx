import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { roleAtLeast, type Role } from "../api.ts";
import { useRole } from "../auth.tsx";
import { cn } from "../lib/cn.ts";

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Viewer",
  approver: "Approver",
  admin: "Admin",
};

export function RoleBadge({ role }: { role: Role }): ReactNode {
  const color =
    role === "admin"
      ? "bg-[#ff0055]/15 text-[#ff8fab] border-[#ff0055]/40"
      : role === "approver"
        ? "bg-[#ffb700]/15 text-[#ffd166] border-[#ffb700]/40"
        : "bg-[#00f0ff]/10 text-[#7ce7f4] border-[#00f0ff]/30";
  return (
    <span
      data-testid="role-badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        color,
      )}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

interface RequireRoleProps {
  role: Role;
  children: ReactNode;
  /** When true, render children disabled instead of hiding them. */
  mode?: "hide" | "disable";
  action?: string;
}

/**
 * Gate an action behind a role. `hide` removes the element for
 * unauthorized roles; `disable` renders it visibly disabled with a
 * tooltip naming the required role.
 */
export function RequireRole({
  role,
  children,
  mode = "disable",
  action = "perform this action",
}: RequireRoleProps): ReactNode {
  const current = useRole();
  if (current !== null && roleAtLeast(current, role)) return <>{children}</>;
  if (mode === "hide") return null;
  const hint = `${ROLE_LABEL[role]} role required to ${action}`;
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            data-testid="role-gated"
            title={hint}
            aria-disabled="true"
            className="inline-flex cursor-not-allowed opacity-50 [&>button]:pointer-events-none"
          >
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content
          side="top"
          className="z-50 rounded border border-[#1f2937] bg-[#0d1118] px-2 py-1 text-xs text-[#e6edf3]"
        >
          {hint}
          <Tooltip.Arrow className="fill-[#1f2937]" />
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
