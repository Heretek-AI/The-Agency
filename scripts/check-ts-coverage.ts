/** Fail when a first-party TypeScript file is outside the typecheck.
 *
 * Compares `tsc --listFilesOnly` (files the typecheck actually sees) with
 * `git ls-files '*.ts' '*.tsx'` (files in the tree), excluding `fixtures/`.
 * Exits 1 listing every tracked file the typecheck does not see.
 */
import { spawnSync } from "node:child_process";

const root = process.cwd();

const tsc = spawnSync("bunx", ["tsc", "--noEmit", "--listFilesOnly"], {
  cwd: root,
  encoding: "utf8",
});
if (tsc.status !== 0) {
  console.error(`tsc --listFilesOnly failed:\n${tsc.stdout}\n${tsc.stderr}`);
  process.exit(1);
}
const seen = new Set(
  tsc.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => l.startsWith(root))
    .map((l) => l.slice(root.length + 1))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !f.includes("node_modules")),
);

const git = spawnSync("git", ["ls-files", "*.ts", "*.tsx"], { cwd: root, encoding: "utf8" });
if (git.status !== 0) {
  console.error(`git ls-files failed:\n${git.stderr}`);
  process.exit(1);
}
const tracked = git.stdout
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .filter((f) => !f.includes("fixtures/"));

const unseen = tracked.filter((f) => !seen.has(f));
if (unseen.length > 0) {
  console.error(`ts-coverage: ${unseen.length} tracked TypeScript file(s) outside the typecheck:`);
  for (const f of unseen) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`ts-coverage: ${tracked.length} tracked file(s), all inside the typecheck`);
