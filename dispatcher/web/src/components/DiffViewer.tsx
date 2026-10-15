import { useState, type ReactNode } from "react";
import { cn } from "../lib/cn.ts";

interface DiffLine {
  kind: "context" | "added" | "removed" | "hunk";
  text: string;
}

function parseUnified(diff: string): { lines: DiffLine[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      lines.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+") && !raw.startsWith("+++")) {
      added += 1;
      lines.push({ kind: "added", text: raw });
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      removed += 1;
      lines.push({ kind: "removed", text: raw });
    } else {
      lines.push({ kind: "context", text: raw });
    }
  }
  return { lines, added, removed };
}

function splitIntoPairs(
  lines: DiffLine[],
): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const rows: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind === "removed") {
      const removals: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "removed") {
        removals.push(lines[i]!);
        i += 1;
      }
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i]!.kind === "added") {
        additions.push(lines[i]!);
        i += 1;
      }
      const width = Math.max(removals.length, additions.length);
      for (let k = 0; k < width; k += 1) {
        rows.push({ left: removals[k] ?? null, right: additions[k] ?? null });
      }
    } else if (line.kind === "added") {
      rows.push({ left: null, right: line });
      i += 1;
    } else {
      rows.push({ left: line, right: line });
      i += 1;
    }
  }
  return rows;
}

/**
 * Diff viewer: unified and split modes on a neutral canvas with
 * high-contrast added/removed styling and no glow effects.
 */
export function DiffViewer({ diff, taskId }: { diff: string; taskId: string }): ReactNode {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const { lines, added, removed } = parseUnified(diff);
  const pairs = mode === "split" ? splitIntoPairs(lines) : [];

  return (
    <div data-testid={`diff-viewer-${taskId}`} className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs">
        <span data-testid="diff-stats" className="text-[#8b949e]">
          <span className="diff-added rounded px-1">+{added}</span>{" "}
          <span className="diff-removed rounded px-1">-{removed}</span>
        </span>
        <button
          type="button"
          data-testid="diff-mode-unified"
          onClick={() => setMode("unified")}
          className={cn(
            "rounded border border-[#1f2937] px-2 py-0.5",
            mode === "unified" ? "text-[#00f0ff]" : "text-[#8b949e]",
          )}
        >
          Unified
        </button>
        <button
          type="button"
          data-testid="diff-mode-split"
          onClick={() => setMode("split")}
          className={cn(
            "rounded border border-[#1f2937] px-2 py-0.5",
            mode === "split" ? "text-[#00f0ff]" : "text-[#8b949e]",
          )}
        >
          Split
        </button>
      </div>
      {lines.length === 0 || (lines.length === 1 && lines[0]!.text === "") ? (
        <p className="text-xs text-[#8b949e]">No changes.</p>
      ) : mode === "unified" ? (
        <pre
          data-testid="diff-unified"
          className="code-surface overflow-x-auto rounded border border-[#1f2937] p-2 text-xs leading-5"
        >
          {lines.map((line, i) => (
            <div
              key={i}
              data-testid={
                line.kind === "added"
                  ? "diff-added"
                  : line.kind === "removed"
                    ? "diff-removed"
                    : undefined
              }
              className={cn(
                line.kind === "added" && "diff-added",
                line.kind === "removed" && "diff-removed",
                line.kind === "hunk" && "text-[#00f0ff]",
              )}
            >
              {line.text === "" ? " " : line.text}
            </div>
          ))}
        </pre>
      ) : (
        <div data-testid="diff-split" className="grid grid-cols-2 gap-0 overflow-x-auto">
          {pairs.map((row, i) => (
            <div key={i} className="contents">
              <pre
                className={cn(
                  "code-surface overflow-x-auto border-[#1f2937] p-1 text-xs leading-5",
                  row.left?.kind === "removed" && "diff-removed",
                )}
              >
                {row.left?.text ?? ""}
              </pre>
              <pre
                className={cn(
                  "code-surface overflow-x-auto border-l border-[#1f2937] p-1 text-xs leading-5",
                  row.right?.kind === "added" && "diff-added",
                )}
              >
                {row.right?.text ?? ""}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
