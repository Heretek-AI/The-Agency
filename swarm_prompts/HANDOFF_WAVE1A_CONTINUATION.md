# HANDOFF — Continue the Master Wave Orchestration from Stage 1a

**For:** the next orchestrator session taking over The Agency (Edition 2) build.
**Date:** 2026-10-13 (UTC)
**Repo:** `/home/john/Projects/The-Agency`
**Mission source:** `swarm_prompts/MASTER_WAVE_ORCHESTRATOR.md`

You are the **Master Swarm Orchestrator** continuing the build in 5 logical recursive waves with the Triad protocol (Programmer → QA → Drift Reviewer) in isolated worktrees. Wave 0 is merged. Wave 1 is mid-flight at Stage 1a: the only remaining blocker (a provider key) has just been supplied by the user. Your first job is to finish Stage 1a to `VERDICT: PASS`, pass the merge barrier, then proceed to Stage 1b.

---

## 1. Required reading before doing anything (do not skip, do not paraphrase)

1. `swarm_prompts/MASTER_WAVE_ORCHESTRATOR.md` — the mission, wave barriers, anti-stubbing rules.
2. `swarm_prompts/TRIAD_SUB_ORCHESTRATOR_PROTOCOL.md` — the Triad roles, invocation prompts, rework loop (max 3 cycles).
3. `swarm_prompts/WAVE_1_FLEET_CORE.md` — the current wave (Sub-Wave 1A is what remains).
4. `docs/prompts/00-shared-context.md` — binding rules (§3 operating rules, §4 verification rules, §9 contracts).
5. `docs/prompts/stage-1a-spike-and-base-image.md` — the current stage prompt.
6. `docs/prompts/verify-stage.md` — the Drift Reviewer procedure.

**Dispatch rule:** never summarize prompt files into your own words for subagents. Always instruct them: _"FIRST: Read `docs/prompts/00-shared-context.md` in full. SECOND: Read `docs/prompts/<stage-file>.md` in full."_ Every subagent call uses `agent: "coordinator"`.

---

## 2. State of the build (verified at handoff)

### Wave 0 / Stage 0 — COMPLETE, merged, verified. Do not redo.

- `main` @ `4721f11` `feat(stage-0): scaffolding, acceptance harness, defect register, and salvaged modules` (`--no-ff` merge of `f17fa82`).
- Verification: `docs/reports/stage-0-verification.md` → `VERDICT: PASS`.
- `make check` green on main (78 tests, 0 fail). `make accept STAGE=0` on main = 9/10 pass; the only FAIL is `05-salvage-provenance`, which requires branch `stage-0-salvage` and fails on `main` **by design** (verified in the Stage 0 run: 10/10 on the branch).
- Worktree `worktrees/wave-0-salvage` removed.
- `main` git status shows only untracked `worktrees/` (the git-worktree parent dir; never commit it, never `git add` it).

### Wave 1 / Stage 1a — BUILT and audited twice; was blocked ONLY on the live provider key; key now supplied.

- Worktree: `worktrees/wave-1a-spike/` — branch `stage-1a-spike`, HEAD `1d2b7ab`, tree clean at handoff.
- What exists on the branch (all committed): preflight (`scripts/preflight.sh`), base image `images/base/Dockerfile` + `entrypoint.sh` (`agency-base:2.0.26`, digest-pinned, non-root `agent:agent`), spike runner (`scripts/spike.sh` + `scripts/spike-assert-messages.py` + `spike/config/`), 8 acceptance checks (`scripts/accept/1a/01..08`), stage report `docs/reports/stage-1a.md`, QA red proofs `docs/evidence/1a/red-proofs.log`, verification evidence `docs/evidence/1a/verify/`.
- Verification history: pass 1 FAIL (F2–F5), rework fixed them, pass 2 → `docs/reports/stage-1a-verification.md` → `VERDICT: FAIL` with a single blocker: **F1 — no provider key existed**, so `scripts/accept.sh 1a` was honestly 5 pass / 1 skip / 2 fail (`01-preflight` FAIL, `06-spike-answers-complete` FAIL, `05-spike-end-to-end` SKIP) and Q1/Q9/Q10/Q11 were recorded NOT PERFORMED.
- All code findings were fixed and independently re-verified; 7 checks were sabotage-proven fail-closed across two Drift passes.

### What the user just supplied (the F1 unblock)

- `worktrees/wave-1a-spike/.env.provider` — mode `0600`, non-empty `OPENCODE_API_KEY`. **Never print it, never commit it, never copy it into evidence, reports, or chat.**
- `worktrees/wave-1a-spike/.env` — mode `0600`, `AGENCY_MODEL=opencode-go/muse-spark-1.3-contributor`.
  - Model id confirmed available: host `opencode models` lists `opencode-go/muse-spark-1.3-contributor` (and a `1.2` variant — do not use the 1.2).
- `bash scripts/preflight.sh` (run in the worktree) now exits 0: `5 pass, 0 fail`, with `provider-file PASS .env.provider present, mode 0600, OPENCODE_API_KEY present`.
- **Security note:** the key was pasted into a chat session earlier today. Recommend the user rotate it after this stage is verified and update `.env.provider` (mode 0600). Do not block on this.

---

## 3. Remaining work to finish Stage 1a (in order)

This follows the "Next" section of the stage report and the stage prompt's "Ask the user" resolution.

1. **Run the spike end-to-end:** in `worktrees/wave-1a-spike/`, run `scripts/spike.sh`. It must print `SPIKE PASS session=...` (it does a real model run; it tears its container down by name on exit; there is no tolerant path). Spend the Go credits; this is the point of the stage.
2. **Answer Q1, Q9, Q10, Q11 with real evidence** (the four NOT PERFORMED questions):
   - Update `docs/evidence/1a/spike/q01.log`, `q09.log`, `q10.log`, `q11.log` with the exact commands and trimmed output (redact nothing except the key — never put the key in a file).
   - Update the answer rows in `docs/build-notes.md` (Spike section) from `NOT PERFORMED` to the true answer.
   - Check `06-spike-answers-complete` requires, for every shape-deciding question not recorded NOT PERFORMED, a line `Negative case: <observation>` that passes its filter. Shape-deciding questions are 3, 4, 7, 10, 14, 15 — so **Q10 needs a negative case**; Q1/Q9/Q11 do not, but must still be answered honestly. Read `scripts/accept/1a/06-spike-answers-complete.sh` before writing the marker.
3. **Known open technical lead — resolve Q1 properly.** A probe at handoff found: host `opencode` (v2.0.27) with this key lists `opencode-go/*` models fine, but inside `agency-base:2.0.26` (OpenCode 2.0.26) `opencode models` (both default and `--standalone`, with `OPENCODE_API_KEY` in env, fresh writable HOME, config dir writable or unset) returned an **empty list**. Container egress is fine (`curl https://opencode.ai/` → 200, DNS resolves). Q1 asks exactly: _does `opencode serve` pick up `OPENCODE_API_KEY` from the environment, and is the `AGENCY_MODEL` id listed by `opencode models`?_ The stage prompt names the fallback: _"`opencode auth import` in the entrypoint; correct the id."_ The Programmer must establish the truth with evidence (e.g. compare 2.0.26 vs host behavior, try the auth-import path, inspect `--print-logs` at debug, check the console/connection fetch), then either fix the entrypoint/config or record the fallback openly in build-notes. **Do not fabricate a "yes".**
4. **Re-run acceptance:** `bash scripts/accept.sh 1a` → must exit 0 (or 77 only for a skip the stage prompt allows — note: with the key present, `05` must RUN and PASS; a skip of 05 means the stage is not complete). `01` must pass. Commit evidence with conventional messages.
5. **Fresh Drift Reviewer pass** per `docs/prompts/verify-stage.md` (fresh session, changes no code except its report/evidence): re-run everything, read the scripts, sabotage ≥2 checks (or ≥⅓ of checks), restore cleanly, and write **pass 3** into `docs/reports/stage-1a-verification.md` ending in `VERDICT: PASS` or `VERDICT: FAIL` with itemized findings.
6. **On PASS:** commit final reports/evidence; confirm `git status` clean; DO NOT merge from the worker — the master (you) merges. On FAIL: fix findings without weakening checks, repeat QA + Drift (protocol cap: max 3 rework cycles; ~2 have effectively been consumed by the key-free passes — judge real code faults against the cap, not the key blocker).

---

## 4. Merge barrier (master's step, only after VERDICT: PASS)

From repo root `/home/john/Projects/The-Agency`:

```bash
git checkout main
git merge --no-ff stage-1a-spike -m "feat(stage-1a): base image, entrypoint, spike answers, and acceptance checks"
make check
# Re-run stage-1a acceptance on main; record the log under docs/evidence/1a/
git worktree remove worktrees/wave-1a-spike
```

Note on prior experience: after the Stage 0 merge, `make check` on `main` needed `bun install --frozen-lockfile` first (worktrees have their own `node_modules`). Also, branch-bound checks may fail on `main` by design (as Stage 0's `05` did) — verify why before treating a FAIL on main as a blocker; the branch evidence must be green.

---

## 5. Then continue the mission

- **Wave 1, Stage 1b:** read `swarm_prompts/WAVE_1_FLEET_CORE.md` (Sub-Wave 1B). Create `worktrees/wave-1b-roster/` on branch `stage-1b-roster` from the updated `main`. Same Triad loop. Scope: `fleet.yaml` (12 core experts), config renderer (`opencode.jsonc` per expert, read-only mounts, no `ask` rules), hardened `compose.yaml` (only gateway publishes on `127.0.0.1`, `:z` flags, limits), egress proxy allowlist, `scripts/init-env.sh`, checks `scripts/accept/1b/*.sh`. Drift must verify zero published ports on experts and defect guards D-07, D-19, D-20, D-25.
- Stages 1c → 1d then Waves 2 → 3 → 4 follow the same pattern (see `WAVE_*.md` files). Never start a stage before its predecessor is merged to `main` with `VERDICT: PASS`.

---

## 6. Protocol reminders (binding, repeated because they are the point)

- **Zero stubs, zero shortcuts.** No `|| true` around the thing under test, no catch-and-continue, no fabricated output, no dummy commands. Fail-closed defaults per shared context §4.2.
- **A check that cannot fail is not a check.** QA red-proves every check (break → exit 1 → `git checkout --` restore → clean status). Drift sample-sabotages independently.
- **Exit codes are authority:** check scripts exit 0 (pass) / 1 (fail) / 77 (allowed skip). A skip is not a pass. The report's "Not performed" and "Not built" sections must be complete and honest.
- **Conventional commits that describe the diff.** No "live/verified/complete" in a subject unless literally true.
- **Never push. Never touch** `SALVAGE_SRC` (`/home/john/Projects/Heretek-AI-opencode/rebuild_staging`, commit `14f297a`), donor repos, or `review/` except read-only. No secrets in tracked files, evidence, or chat.
- **Isolation:** one stage = one worktree = one branch. Do not let workers edit `main` or siblings.

## 7. Harness operational notes (why the last session looked "stuck")

- Subagents run in the background; their output arrives only as a completion notification. When a session appears silent, check the worktree directly (`git -C worktrees/wave-1a-spike log --oneline -3`, `git status --short`, `ls -t worktrees/wave-1a-spike/docs/evidence/1a/`) instead of waiting or sleeping.
- If a worker session looks stalled, send it a short continuation prompt (`subagent` with the same `sessionID`) — e.g. "Report current Triad step + last commit, then continue without redoing finished work." Do not restart from scratch.
- Working on `main` while a worktree is active is fine, but keep `make check` runs on `main` to the merge barrier step.
- Useful anchors: stage report `docs/reports/stage-1a.md`; verification `docs/reports/stage-1a-verification.md`; red proofs `docs/evidence/1a/red-proofs.log`; verify evidence `docs/evidence/1a/verify/`.

---

## 8. Suggested launch

From `/home/john/Projects/The-Agency`:

```bash
opencode run --agent coordinator --auto \
  --file swarm_prompts/HANDOFF_WAVE1A_CONTINUATION.md \
  "Continue the master wave orchestration from Stage 1a per this handoff. First re-read the required files and verify the state table. Then finish Stage 1a to VERDICT: PASS, pass the merge barrier, and proceed to Stage 1b."
```

End state you are driving toward right now: `stage-1a-spike` merged to `main` with a `VERDICT: PASS` verification, then Wave 1b built and verified the same way — with the full Edition 2 build (Waves 2–4) still ahead.
