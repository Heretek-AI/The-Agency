/**
 * Diff policy check (Stage 1c, Step 4). Compares a task worktree's changed
 * paths (`git diff --name-status <base>...HEAD`, both sides of a rename)
 * with the task's grant from the ownership map:
 *
 * - a path matching the expert's ownership entry: allowed;
 * - a path matching `shared`: allowed, recorded as a flag;
 * - a path matching `protected`: scope failure;
 * - any other path: scope failure;
 * - a new or changed symlink: scope failure;
 * - for an `ro` expert, any change at all: `ro-violation`.
 */
import { git } from "./git.js";
import { match as wildcardMatch } from "./wildcard.js";

export type ExpertAccess = "ro" | "scoped";

export interface OwnershipGrant {
  writes: string[];
  shared: string[];
  protected: string[];
}

export interface ChangedFile {
  path: string;
  /** Name-status letter: A, M, D, R, C, T, ... */
  status: string;
  symlink: boolean;
}

export type PolicyResult =
  | { ok: true; sharedTouched: string[] }
  | { ok: false; reason: "scope" | "ro-violation"; files: string[] };

const matchesAny = (path: string, patterns: string[]): boolean =>
  patterns.some((p) => wildcardMatch(path, p));

/**
 * List changed paths in a worktree against `base`, both sides of renames.
 * Symlink membership comes from the worktree index and the base tree, so
 * a new, changed, or removed symlink is always flagged.
 */
export async function changedFiles(worktree: string, base: string): Promise<ChangedFile[]> {
  const raw = await git(worktree, ["diff", "--name-status", "-z", `${base}...HEAD`]);
  const tokens = raw.split("\0").filter((t) => t.length > 0);
  const paths: { path: string; status: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i]!;
    const letter = status[0]!;
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath !== undefined) paths.push({ path: oldPath, status: letter });
      if (newPath !== undefined) paths.push({ path: newPath, status: letter });
      i += 2;
    } else {
      const file = tokens[i + 1];
      if (file !== undefined) paths.push({ path: file, status: letter });
      i += 1;
    }
  }
  const symlinks = new Set<string>();
  const collect = (listing: string): void => {
    for (const line of listing.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      if (line.slice(0, tab).split(" ")[0] === "120000") symlinks.add(line.slice(tab + 1));
    }
  };
  collect(await git(worktree, ["ls-files", "-s"]));
  try {
    const baseTree = await git(worktree, ["ls-tree", "-r", base]);
    for (const line of baseTree.split("\n")) {
      const parts = line.split(/\s+/);
      if (parts[0] === "120000" && parts[3] !== undefined) symlinks.add(parts.slice(3).join(" "));
    }
  } catch {
    // An unknown base fails closed in the caller (diff above throws first).
  }
  return paths.map((p) => ({ ...p, symlink: symlinks.has(p.path) }));
}

export function checkPolicy(
  changed: ChangedFile[],
  grant: OwnershipGrant,
  access: ExpertAccess,
): PolicyResult {
  if (access === "ro") {
    if (changed.length > 0)
      return { ok: false, reason: "ro-violation", files: changed.map((c) => c.path) };
    return { ok: true, sharedTouched: [] };
  }
  const scopeFailures: string[] = [];
  const sharedTouched: string[] = [];
  for (const file of changed) {
    if (file.symlink || matchesAny(file.path, grant.protected)) {
      scopeFailures.push(file.path);
    } else if (matchesAny(file.path, grant.writes)) {
      // allowed
    } else if (matchesAny(file.path, grant.shared)) {
      sharedTouched.push(file.path);
    } else {
      scopeFailures.push(file.path);
    }
  }
  if (scopeFailures.length > 0)
    return { ok: false, reason: "scope", files: [...new Set(scopeFailures)].sort() };
  return { ok: true, sharedTouched: [...new Set(sharedTouched)].sort() };
}
