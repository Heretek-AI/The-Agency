/** Temporary git repository helpers for tests. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** Create a temp git repo with one committed file; returns its path. */
export function makeTmpGitRepo(seedFiles?: Record<string, string>): string {
  const dir: string = mkdtempSync(join(tmpdir(), "agency-testkit-"));
  const files: Record<string, string> = seedFiles ?? { "hello.txt": "hello\n" };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"], {
    cwd: dir,
  });
  return dir;
}

/** Current HEAD sha of a repo dir. */
export function gitHead(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
}
