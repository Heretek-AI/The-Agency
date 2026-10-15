import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/** Magic UI border beam: subtle animated conic border for chrome only. */
export function BorderBeam({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={cn("border-beam rounded-lg border border-[#1f2937]", className)}>
      {children}
    </div>
  );
}

/** Magic UI shimmer button: primary call-to-action with a light sweep. */
export function ShimmerButton({
  children,
  onClick,
  disabled,
  testId,
  submit,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  submit?: boolean;
}): ReactNode {
  return (
    <button
      type={submit === true ? "submit" : "button"}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="shimmer-button inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-[#07090e] transition disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Magic UI animated grid: faint dashboard-hero backdrop. */
export function AnimatedGridPattern({ className }: { className?: string }): ReactNode {
  return <div aria-hidden="true" className={cn("animated-grid-pattern", className)} />;
}
