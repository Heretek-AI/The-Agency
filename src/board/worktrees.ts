import { execFile } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { promisify } from "node:util"
import { runVerify, type VerifyRun } from "../omni/verify.js"
import type { Tournament } from "./types.js"

const execFileAsync = promisify(execFile)

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

export async function git(cwd: string, args: string[], timeout = 60_000): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024 })
    return { ok: true, stdout, stderr }
  } catch (err: any) {
    return { ok: false, stdout: err?.stdout ?? "", stderr: err?.stderr ?? String(err?.message ?? err) }
  }
}

export async function isGitRepo(rootDir: string): Promise<boolean> {
  const res = await git(rootDir, ["rev-parse", "--is-inside-work-tree"])
  return res.ok && res.stdout.trim() === "true"
}

export function candidateBranch(taskId: string): string {
  return `swarmos/${taskId}`
}

export interface ProvisionResult {
  worktree: string
  branch: string
  provisioned: boolean
  reason?: string
}

/**
 * Creates `.worktrees/<taskId>` on branch `swarmos/<taskId>` from `baseRef`. Idempotent:
 * an existing worktree at that path is reused.
 */
export async function provisionWorktree(rootDir: string, taskId: string, worktree: string, baseRef: string): Promise<ProvisionResult> {
  const branch = candidateBranch(taskId)
  const abs = path.resolve(rootDir, worktree)
  const list = await git(rootDir, ["worktree", "list", "--porcelain"])
  if (list.ok && list.stdout.split("\n").some((l) => l === `worktree ${abs}`)) {
    return { worktree, branch, provisioned: true, reason: "reused existing worktree" }
  }

  await fs.mkdir(path.dirname(abs), { recursive: true })
  const branchExists = (await git(rootDir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok
  const res = branchExists
    ? await git(rootDir, ["worktree", "add", abs, branch])
    : await git(rootDir, ["worktree", "add", "-b", branch, abs, baseRef])
  if (!res.ok) return { worktree, branch, provisioned: false, reason: res.stderr.trim().slice(0, 300) }
  return { worktree, branch, provisioned: true }
}

/** Commits everything in a worktree except SwarmOS state. Returns false when there was nothing to commit. */
export async function commitWorktree(worktreeDir: string, message: string): Promise<boolean> {
  await git(worktreeDir, ["add", "-A", "--", ".", ":(exclude).opencode"])
  const staged = await git(worktreeDir, ["diff", "--cached", "--quiet"])
  if (staged.ok) return false
  let res = await git(worktreeDir, ["commit", "-q", "-m", message])
  if (!res.ok && /identity|user\.(name|email)/i.test(res.stderr)) {
    res = await git(worktreeDir, ["-c", "user.name=SwarmOS", "-c", "user.email=swarmos@localhost", "commit", "-q", "-m", message])
  }
  if (!res.ok) throw new Error(`SwarmOS Worktree: commit failed in ${worktreeDir}: ${res.stderr.trim()}`)
  return true
}

export interface CandidateScore {
  taskId: string
  worktree: string
  provisioned: boolean
  verifyRunId?: string
  passed: boolean
  failedChecks: number
  failedTests: number
  diff: { files: number; insertions: number; deletions: number }
}

function parseShortstat(text: string): CandidateScore["diff"] {
  const n = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0)
  return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?/), deletions: n(/(\d+) deletions?/) }
}

/**
 * Runs a full `tools.verify.run` inside every candidate worktree and ranks candidates:
 * passing first, then fewer failing checks and tests, then the smaller diff.
 */
export async function scoreTournament(rootDir: string, tournament: Tournament): Promise<CandidateScore[]> {
  const scores: CandidateScore[] = []
  for (const c of tournament.candidates) {
    const dir = path.resolve(rootDir, c.worktree)
    const provisioned = c.provisioned !== false && (await isGitRepo(dir))
    if (!provisioned) {
      scores.push({ taskId: c.taskId, worktree: c.worktree, provisioned: false, passed: false, failedChecks: 0, failedTests: 0, diff: { files: 0, insertions: 0, deletions: 0 } })
      continue
    }
    const run: VerifyRun = await runVerify(dir, { scope: "full" })
    const base = tournament.baseRef ?? "HEAD"
    const stat = await git(dir, ["diff", "--shortstat", base, "--", ".", ":(exclude).opencode"])
    scores.push({
      taskId: c.taskId,
      worktree: c.worktree,
      provisioned: true,
      verifyRunId: run.id,
      passed: run.passed,
      failedChecks: run.checks.filter((k) => !k.passed).length,
      failedTests: run.checks.reduce((a, k) => a + (k.counts?.failed ?? 0), 0),
      diff: parseShortstat(stat.stdout),
    })
  }
  const size = (s: CandidateScore) => s.diff.insertions + s.diff.deletions
  return scores.sort(
    (a, b) =>
      Number(b.passed) - Number(a.passed) || a.failedChecks - b.failedChecks || a.failedTests - b.failedTests || size(a) - size(b),
  )
}

export interface MergeResult {
  merged: boolean
  commit?: string
  removedWorktrees: string[]
  deletedBranches: string[]
  note?: string
}

/**
 * Commits the winner's worktree, merges its branch into the main tree with `--no-ff`, then
 * removes every candidate worktree and branch. A conflicting merge is aborted and reported.
 */
export async function mergeTournamentWinner(rootDir: string, tournament: Tournament, winnerTaskId: string): Promise<MergeResult> {
  const winner = tournament.candidates.find((c) => c.taskId === winnerTaskId)
  if (!winner) throw new Error(`SwarmOS Tournament: ${winnerTaskId} is not a candidate of ${tournament.id}`)
  const winnerDir = path.resolve(rootDir, winner.worktree)

  await commitWorktree(winnerDir, `swarmos: ${tournament.id} candidate ${winner.label}`)
  const branch = winner.branch ?? candidateBranch(winnerTaskId)
  const merge = await git(rootDir, ["merge", "--no-ff", "-m", `swarmos: merge tournament ${tournament.id} winner ${winnerTaskId}`, branch])
  if (!merge.ok) {
    const conflicts = (await git(rootDir, ["diff", "--name-only", "--diff-filter=U"])).stdout.trim().split("\n").filter(Boolean)
    await git(rootDir, ["merge", "--abort"])
    throw new Error(
      `SwarmOS Tournament: merging ${branch} failed${conflicts.length ? ` with conflicts in ${conflicts.join(", ")}` : ""}: ${merge.stderr.trim().slice(0, 300)}. The merge was aborted; resolve it manually or re-run the candidate on the current base.`,
    )
  }
  const commit = (await git(rootDir, ["rev-parse", "HEAD"])).stdout.trim()
  const cleanup = await cleanupTournamentWorktrees(rootDir, tournament)
  return { merged: true, commit, ...cleanup }
}

export async function cleanupTournamentWorktrees(
  rootDir: string,
  tournament: Tournament,
): Promise<{ removedWorktrees: string[]; deletedBranches: string[] }> {
  const removedWorktrees: string[] = []
  const deletedBranches: string[] = []
  for (const c of tournament.candidates) {
    const abs = path.resolve(rootDir, c.worktree)
    if ((await git(rootDir, ["worktree", "remove", "--force", abs])).ok) removedWorktrees.push(c.worktree)
    const branch = c.branch ?? candidateBranch(c.taskId)
    if ((await git(rootDir, ["branch", "-D", branch])).ok) deletedBranches.push(branch)
  }
  await git(rootDir, ["worktree", "prune"])
  return { removedWorktrees, deletedBranches }
}
