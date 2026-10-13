# Stage 1a — verification (pass 2)

Commit: `de88e01a889091503c60ac6b9ddebff3ece52741` Branch: `stage-1a-spike` Date: 2026-10-13 (UTC) Verifier: DeepSeek V4.1 Flash (OpenCode), fresh session

Supersedes the pass-1 report committed at `6c58cb6` (same path). Pass-1
evidence (`docs/evidence/1a/verify/v2-*`, and the interrupted `00–21` files)
stays as history; this pass's evidence is the `v3-*` files and the accept
logs written under `docs/evidence/1a/verify/{1a,0}/`.

VERDICT: FAIL

Reason: F1 from pass 1 persists — no provider key exists anywhere, so
`bash scripts/accept.sh 1a` exits **1** (5 pass / 1 skip / 2 fail:
`01-preflight` and `06-spike-answers-complete` fail for the missing key,
`05-spike-end-to-end` skips), and the model-dependent Accept lines cannot run.
This pass is therefore incomplete verification of an incomplete stage; exactly
what is needed to finish is in **Not verified**. Pass-1 findings F2–F5 are
fixed and re-verified (below); no new section-4.6 violation was found.

## Summary

On a clean tree at `de88e01`, `make check` exits 0 (78 pass, 0 fail) and
`make build-base` rebuilds `agency-base:2.0.26` green. `bash scripts/accept.sh 1a`
exits 1 with exactly the report's table — 5 pass, 1 skip, 2 fail — and every
accept log since the F2–F5 rework shows that same split. The stage-goal facts
that can be checked keyless hold: a variant build with `AGENT_UID=1234/GID=1234`
runs as `agent` with those ids (so the UID wiring is real, not an
equal-to-host accident), the `FROM` digest matches `versions.env` **and** the
registry manifest for `ubuntu:24.04`, the transcript parser rejects the
user-role echo and a marker present only in a shell `command` (own probes),
and check `0/06-no-donor-code` now fails closed when `git ls-files` fails.
Seven stage-1a checks were sabotaged plus the stage-0 register guard; each went
red and was restored exactly; check `06`'s frozen denial filter rejects the shapes it
enumerates plus curly-apostrophe denials and signal-less paragraphs, and its
comment states its class limit honestly. The 4.6 scan found no violation; the
verdict is FAIL only because the stage cannot be completed or fully verified
without the user's provider key.

## Checks

| Check                                   | Builder                       | Verifier                                                                                                                                                                                    | Evidence                                                                      |
| --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1a/01-preflight                         | FAIL (no key)                 | FAIL (same; green with dummy key @0600; red with empty key @0600 and with mode 0644)                                                                                                        | `v3-13-sabotage-01.log`, `v3-17-failclosed-probes.log`, `v3-03-accept-1a.log` |
| 1a/02-base-image-pinned                 | PASS                          | PASS (red with a mutated-but-well-formed FROM digest; restored green)                                                                                                                       | `v3-11-sabotage-02.log`, `v3-03`, `v3-22-final-accept.log`                    |
| 1a/03-entrypoint-fails-closed           | PASS                          | PASS (red with the password refusal's `exit 64`→`exit 0` + rebuild; restored rebuilt green)                                                                                                 | `v3-12-sabotage-03.log`, `v3-17`, `v3-03`                                     |
| 1a/04-healthy-nonroot                   | PASS                          | PASS; AGENT_UID wiring proven with a `AGENT_UID=1234/GID=1234` variant; default image uid 1000 non-root                                                                                     | `v3-06-agent-uid-wiring.log`, `v3-03`                                         |
| 1a/05-spike-end-to-end                  | SKIP (no key; prompt-allowed) | SKIP (same); present-but-invalid dummy key fails at the transcript assertion; keyless `spike.sh` exits 1 naming the key; the post-spike `docker ps` fail-closed branch exercised red (stub) | `v3-14-sabotage-05.log`, `v3-17b-failclosed-extra.log`, `v3-03`               |
| 1a/06-spike-answers-complete            | FAIL (4 NOT PERFORMED)        | FAIL (same); filter probes: denial and signal-less markers red, genuine marker passes the filter; standing count is the only failure                                                        | `v3-10-check06-filter-probes.log`, `v3-03`                                    |
| 1a/07-no-secret-leak                    | PASS                          | PASS; keyed branch red on tracked and evidence sentinels, green clean; no-key branch red on a staged sentinel, green clean; `git grep` failure fails closed                                 | `v3-15-sabotage-07.log`, `v3-17b`, `v3-20-image-metadata.log`                 |
| 1a/08-no-containers-left                | PASS                          | PASS; red with a decoy container and with a `docker ps` shim                                                                                                                                | `v3-16-sabotage-08.log`                                                       |
| 0/06-no-donor-code (register D-06/D-27) | PASS                          | PASS; **F4 fix verified**: `git ls-files` shim → exit 1 (was fail-open in pass 1); real git → PASS                                                                                          | `v3-09-f4-lsfiles-probe.log`, `v3-05-accept-0.log`                            |

Harness logs, written by this pass under its write scope (`EVIDENCE_ROOT=docs/evidence/1a/verify`):
`docs/evidence/1a/verify/1a/accept-20261013T200138Z.log` (authoritative),
`.../1a/accept-20261013T200206Z.log` (`make accept`), `.../1a/accept-20261013T201015Z.log`
(final), `docs/evidence/1a/verify/0/accept-20261013T200223Z.log` (stage 0).
Starting state: `v3-00-starting-state.log` (branch, `de88e01`, clean tree,
Bun 1.4.2, Docker 29.9.0, Compose 5.6.0, host opencode v2.0.28,
`.env.provider` absent, `OPENCODE_API_KEY`/`AGENCY_MODEL` unset, no `agency-*`
containers, image entrypoint sha256 `e520f6c1…` equal to the tree's).

## Sabotage sample

| Check | What I broke                                                                                                                  | Result                                                                                                                    | Restored                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1a/01 | `.env.provider` @0600 with empty key; then dummy key @0644                                                                    | FAIL exit 1 both (`key=absent`, `mode=644`)                                                                               | Yes; dummy @0600 → PASS, file deleted (`v3-13`)                                                |
| 1a/02 | FROM digest hex mutated to a well-formed different digest                                                                     | FAIL exit 1 "FROM digest not recorded in versions.env"                                                                    | Yes; `git diff` clean, re-run PASS (`v3-11`)                                                   |
| 1a/03 | `OPENCODE_PASSWORD` refusal `exit 64`→`exit 0` + rebuild                                                                      | FAIL exit 1 "no-password container exited 0"                                                                              | Yes; exact checkout, rebuilt; PASS; image sha matches tree (`v3-12`)                           |
| 1a/05 | Dummy invalid key present; then keyless; then stubbed SPIKE PASS + `docker ps` PATH shim                                      | FAIL at the role-aware parser; SKIP 77 keyless; FAIL "docker ps -a failed" on the shim                                    | Yes; key and stub removed, no container left (`v3-14`, `v3-17b`)                               |
| 1a/06 | q03 marker replaced by "did not yield" denial; then curly-apostrophe denial; then signal-less sentence; then a genuine signal | FAIL "denial, not an observation" ×2; FAIL "no observed outcome"; genuine passes the filter only the standing count fails | Yes; `git checkout` after each, `git diff` clean (`v3-10`)                                     |
| 1a/07 | Keyed: tracked sentinel (staged) and evidence-dir sentinel; no-key: staged assignment sentinel; `git grep` shim               | FAIL naming tracked file / evidence dir / the sentinel; `git grep` rc=128 → FAIL                                          | Yes; sentinels unstaged and deleted, `.env.provider` deleted, clean → PASS (`v3-15`, `v3-17b`) |
| 1a/08 | Decoy container `agency-spike-v3-decoy`; `docker ps` shim                                                                     | FAIL "leftover container(s)"; FAIL "cannot prove no container is left behind"                                             | Yes; decoy removed, shim removed, PASS (`v3-16`)                                               |
| 0/06  | `git ls-files` PATH shim (exit 128); F4 case                                                                                  | FAIL exit 1 "cannot enumerate tracked files" (pass-1 fail-open now closed)                                                | Yes; shim deleted, real git → PASS (`v3-09`)                                                   |

All restorations verified with `git diff --exit-code` clean (final state in
`v3-22-final-accept.log`); no sabotaged state was committed and no `agency-*`
container was left at any point.

## Findings

**F1 — Stage incomplete; Accept lines not met (carried from pass 1; verdict driver).**

- Where: checks `1a/01-preflight`, `1a/06-spike-answers-complete`; Step 0/2 and
  acceptance-table Accept lines.
- What: no provider key exists (`.env.provider` absent; `AGENCY_MODEL` unset),
  so `scripts/preflight.sh` cannot exit 0, `scripts/spike.sh` exits 1 keyless
  (it never SKIPs), check 05 skips, questions 1, 9, 10, 11 are NOT PERFORMED,
  and `bash scripts/accept.sh 1a` exits 1 (5/1/2; observed in
  `v3-03`, `v3-04`, `v3-22`). `make accept STAGE=1a` exits 2 (GNU make
  normalizes the recipe's 1).
- Why it matters: `verify-stage.md` §9 requires accept exit 0, or 77 with only
  prompt-allowed skips; the stage prompt says a skip of 05 means the stage is
  not complete. The report says this at its top, so the claim comparison
  matches; the defect is the incomplete stage.
- Fix: user places a real key in `.env.provider` (0600, never pasted into
  chat) and sets `AGENCY_MODEL`; run `scripts/spike.sh` to `SPIKE PASS`, answer
  Q1/9/10/11 with evidence, re-run `scripts/accept.sh 1a` to exit 0, re-verify.

**Pass-1 F2 (preflight table missing from build notes) — FIXED.**

`docs/build-notes.md:16-38` records the table and chosen port
`AGENCY_HTTP_PORT=8081`; my fresh keyless run reproduces the recorded table
**byte-for-byte** (`v3-23-f2-table-compare.log`), and `.env.example` suggests
the same port.

**Pass-1 F3 (negative-case was a word grep) — FIXED with a documented bound.**

Check 06 now requires a `Negative case:` marker that (a) is not an enumerated
denial shape (case-insensitive, curly apostrophes normalized) and (b) sits in a
paragraph carrying an observed-outcome signal. My probes confirm all three
rejection classes and that genuine markers still pass (`v3-10`). The frozen
limit is real and stated in the check comment (`06-spike-answers-complete.sh:36-45`):
an unenumerated denial whose paragraph contains a signal word can pass — I
reproduced one ("the error eluded our attempts" passes the filter), which is
the acknowledged class bound. I judged the design under `verify-stage.md`:
not a §4.6 violation (the check can fail and does fail closed; semantics of
prose cannot be decided by keywords), and I discharged the deferred duty by
reading the six cited marker paragraphs in `q03/q04/q07/q14/q15` — each is
backed by commands and observed outputs (EROFS rc=1, deny effect, host edit
invisible to turn-diff, ConnectionRefused, SQLiteError rc=1, second session
UNSET). If a completed stage's evidence rested on an unenumerated denial, this
would be a finding; this tree's evidence does not.

**Pass-1 F4 (`0/06-no-donor-code` fail-open when `git ls-files` fails) — FIXED.**

Every `git ls-files` call now captures and tests rc (`06-no-donor-code.sh:18-24`);
my shim probe exits 1 with "cannot enumerate tracked files" (`v3-09`), and the
normal run passes. The `|| true` compounds on lines 15/18 are gone.

**Pass-1 F5 (report wording vs `docker history`) — FIXED.**

The report now says history and inspect each show the HEALTHCHECK's literal
`${OPENCODE_PASSWORD}` variable-name reference once; my scan shows exactly 1
occurrence in history and 1 in inspect, and no credential value in either
(`v3-20`).

No new findings that break a rule were found this pass.

## Claims compared with the tree

- **Commit subjects vs diffs** (30 commits, `4721f11..de88e01`, full listing in
  `v3-18-commit-compare.log`): every subject matches its diff. No subject
  claims "live"/"verified"; the only "complete" is the literal "stage not
  complete" in `0715607`. The cycle-2 commits match their claims:
  `b6a05b0` (ls-files fail-closed), `815232e`/`4e48766`/`50756ea`/`1034740`
  (check-06 marker/denial/signal/freeze, each with its proof), `ff3d593`
  (F2 table), `0e6b2e3` (report F2–F5), QA evidence commits add logs only.
  `815232e` rewrote the q03/04/07/14/15 logs to carry `Negative case:` markers;
  the observations themselves predate it and read as genuine, so this is
  marker normalization, not fabricated evidence.
- **"Built" items**: preflight, base image (`Dockerfile`/entrypoint/`make build-base`),
  spike runner/config (`opencode.jsonc` deny-all + one agent, `spike.md`,
  `mcp-requirements.json`), checks 01–08, the role-aware parser, `.env.example`
  port, `versions.env` pins — all exist, are wired (Makefile/checks/spike), and
  are exercised. The one previously missing artifact (F2) is now present.
- **"Not performed" / "Not built"**: accurate for the key-dependent items
  (05 skip, Q1/9/10/11, model legs). The report's line that 05's `docker ps`
  path is "code-reviewed only" was true when written; this pass exercised that
  branch under a stubbed SPIKE-PASS run (`v3-17b`), and the keyed green path
  still awaits the key. "Not built" correctly says nothing else is missing.
- **Register guards due by this stage** (stage-0 rows): D-03/08/09/10/14/15/16/17/18
  are unit tests resolving to files that exist (`v3-21-register-guard-names.log`)
  and run green inside `make check`; D-06/D-27 by `0/06` (PASS, F4 fixed);
  D-28 by `0/01`, `0/02`, `0/10` (PASS); D-29 by `0/07` (PASS); D-22/D-23/D-30
  by the harness self-test, the placeholder scan, and this scan. Stage-0 accept
  re-run: 9 pass / 1 fail, the single failure `0/05-salvage-provenance` failing
  only on its branch-name gate (`stage-0-salvage` vs `stage-1a-spike`) — the
  same expected, pre-existing condition pass 1 recorded (`v3-05`).

## Fail-closed probes

| Situation                                                               | Expected                                           | Observed                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `OPENCODE_PASSWORD` empty at start                                      | exit 64 naming it                                  | exit-code 64, log names it (`v3-17`)       |
| `OPENCODE_API_KEY` empty at start                                       | exit 64 naming it                                  | exit-code 64, log names it (`v3-17`)       |
| Malformed `/etc/agency/mcp-requirements.json`                           | refuse to serve, exit 64 naming file               | exit-code 64, log names the file (`v3-17`) |
| `.env.provider` absent                                                  | preflight exit 1; `spike.sh` exit 1 naming the key | observed (`v3-13`, `v3-14`, `v3-23`)       |
| `.env.provider` empty key / mode 0644                                   | preflight exit 1                                   | observed (`v3-13`)                         |
| `docker ps` fails in check 08, and in check 05 after a successful spike | check exits 1, never vacuous                       | observed (`v3-16`, `v3-17b`)               |
| `git grep` fails in check 07                                            | check exits 1                                      | observed (`v3-17b`)                        |
| `git ls-files` fails in `0/06`                                          | check exits 1 (was fail-open)                      | observed exit 1 (`v3-09`)                  |

## Not verified

- `scripts/spike.sh` to green and its `SPIKE PASS` line; check 05's keyed green
  path; questions 1, 9, 10, 11; every model leg (Q7 model-driven edit,
  Q15 model shell tool, Q8 real-run fill-in). Blocked by the absent provider
  key — the stage prompt itself says the stage cannot complete without it.
- Check 07 with a real key value: only throwaway dummies were usable; the
  mechanism is value-independent, but the user's key is what check 07 will
  scan once present.
- Check 06's internal grep/sed error branches: code-read only (rc cases),
  not induced.

To finish stage 1a: place a real `OPENCODE_API_KEY` in `.env.provider`
(mode 0600) and set `AGENCY_MODEL`, run `scripts/spike.sh` to `SPIKE PASS`,
record Q1/9/10/11 evidence under `docs/evidence/1a/spike/`, re-run
`scripts/accept.sh 1a` to exit 0 (or 77 with only the prompt-allowed skip),
then run this verification again.

## Notes

- **Registry-side digest check (new this pass)**: `docker buildx imagetools
inspect ubuntu:24.04` returned digest
  `sha256:534baea6…eb55`, exactly the FROM pin and the `versions.env` record,
  so the pin is not just self-consistent but matches the live registry
  (`v3-07`). Pass 1 listed the cold-cache pull as unverified; this closes
  the digest-identity half (the build itself remained cache-satisfied).
- **Dev-harness containers without limits**: `spike.sh` and checks 03/04 start
  containers with `--name` and teardown traps but no CPU/memory/PID limits or
  `cap_drop`. Classified as a justified exception, as in pass 1: the stage
  prompt mandates these direct starts, the limits contract is bound to the
  generated compose in Stage 1b (D-07), and none was left running (checks
  08 and my probes confirm). Worth a line in Stage 1b's scope rather than a
  defect here.
- **Check 06's frozen bound**: an unenumerated denial with a signal word can
  pass the filter (demonstrated: "the error eluded our attempts"). The check
  comment and build notes state the bound; genuineness is the verifier's read,
  which I performed on the six markers — all genuine.
- **Report citation freshness**: section 2 cites the accept log of HEAD
  `3f05923`; every subsequent accept run (through `de88e01`, including mine)
  shows the identical split, so the claim holds (`v3-22`, and the 193002Z–
  195832Z logs).
- **Preflight wording quirk**: a present-but-empty `OPENCODE_API_KEY=` line is
  reported as `key=absent` (not "empty"); both fail closed. Cosmetic.
- **Spike config comment**: `spike/config/opencode.jsonc:4-5` says built-in
  `general`/`explore` are disabled; per the recorded Q5 answer v2 has no such
  built-ins (disabling absent ids is a no-op). Harmless mirror of the prompt's
  premise; the answer and build notes record the correction.
- **`agent` keeps supplementary groups** of the renamed uid-1000 `ubuntu` user
  (`adm`, `dialout`, `sudo` on paper; no `sudo` installed, locked password) —
  same observation as pass 1; the `cap_drop`/no-new-privileges contract is
  Stage 1b's.
- **`|| true`/`2>/dev/null` sites** (scan in `v3-19`): only teardown tolerances
  and probes with explicit fail-closed fallbacks (`?`/`unknown` → FAIL, rc
  checks); no judged path tolerates an error. No `set +e` outside
  `accept.sh`'s exit-code classification. No `test.skip`/early-return passes,
  no `example.com`, no fabricated outputs, no `process.env` outside
  `config.ts`, no OpenCode API path outside the sanctioned harness. No section
  4.6 violation found.

VERDICT: FAIL — `docs/reports/stage-1a-verification.md`

# Stage 1a — verification (pass 3)

Commit: `91c4151f5c5b7f4e3bf7e067fd7a9cb7fac61eba` Branch: `stage-1a-spike` Date: 2026-10-13 (UTC) Verifier: Muse Spark 1.3 Contributor (OpenCode), fresh session

Pass-2 (`1d2b7ab`, VERDICT: FAIL with sole blocker F1 = missing provider
key) and pass-1 (`6c58cb6`) are kept intact above. This pass's evidence is
the `v4-*` files under `docs/evidence/1a/verify/` (plus the harness log
moved there, see Notes). The F1 blocker is resolved: `.env.provider`
(mode 0600, non-empty `OPENCODE_API_KEY` — present/absent only, value never
shown) and `.env` (`AGENCY_MODEL=opencode-go/muse-spark-1.3-contributor`)
exist, gitignored.

VERDICT: PASS

## Summary

On a clean tree at `91c4151`, `make check` exits 0 (78 pass, 0 fail) and
`bash scripts/accept.sh 1a` exits 0 with 8 pass / 0 skip / 0 fail —
check 05 RAN and PASSED (no skip), so the stage is complete. The keyed
spike claims hold: Q1 (partly) re-corroborated live (host 2.0.28 lists the
id, container 2.0.26 `models --standalone` prints nothing), Q9/Q10/Q11
evidence reads genuine with redacted hand-transcribed output, and the
role-aware transcript parser accepts assistant shell tool parts while
ignoring the user echo. My own sabotage sample (checks 05, 06, 04, each a
different sabotage from the builder's and QA's) went red and came back
green; fail-closed probes refuse with exit 64 naming the variable. No
section-4.6 violation was found, and the report's claims match the tree.

## Checks

| Check                                   | Builder | Verifier                                                              | Evidence                                                     |
| --------------------------------------- | ------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1a/01-preflight                         | PASS    | PASS                                                                  | `v4-02-accept-1a-harness.log`                                |
| 1a/02-base-image-pinned                 | PASS    | PASS (image rebuilt green in-run)                                     | `v4-02`, `v4-07` (rebuilds)                                  |
| 1a/03-entrypoint-fails-closed           | PASS    | PASS; entrypoint probes exit 64 naming the variable                   | `v4-02`, `v4-04-failclosed-probes.log`                       |
| 1a/04-healthy-nonroot                   | PASS    | PASS; red with broken HEALTHCHECK path, restored+rebuilt green        | `v4-07-sabotage-04.log`, `v4-02`                             |
| 1a/05-spike-end-to-end                  | PASS    | PASS (RAN, `SPIKE PASS`, no skip); red with bogus image pin, restored | `v4-02`, `v4-05-sabotage-05.log`                             |
| 1a/06-spike-answers-complete            | PASS    | PASS; red with q07 marker stripped, restored green                    | `v4-06-sabotage-06.log`, `v4-02`                             |
| 1a/07-no-secret-leak                    | PASS    | PASS on the real key (value in no file)                               | `v4-02`                                                      |
| 1a/08-no-containers-left                | PASS    | PASS; no `agency-spike*` container before, during checks, or after    | `v4-02`, final state in `v4-08`                              |
| 0/06-no-donor-code (register D-06/D-27) | PASS    | PASS                                                                  | `verify/0/accept-20261013T213629Z.log`, `v4-03-accept-0.log` |

Stage-0 accept re-run: 9 pass / 1 fail — the single failure is
`0/05-salvage-provenance` on its branch-name gate (`stage-0-salvage` vs
`stage-1a-spike`), the same expected pre-existing condition both prior
passes recorded. `make check`: 78 pass, 0 fail (`v4-01-make-check.log`).
Starting state: branch `stage-1a-spike`, commit `91c4151`, clean tree, Bun
1.4.2, Docker 29.9.0, Compose 5.6.0, host opencode v2.0.28, provider key
present (mode 0600), no `agency-*` containers, SELinux Enforcing.

## Sabotage sample

| Check | What I broke                                                                                                    | Result                                                                       | Restored                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1a/05 | `versions.env` `OPENCODE_VERSION` → `0.0.0-bogus` (missing-image path; builder/QA used dummy-key auth failure)  | FAIL exit 1: `spike: missing image agency-base:0.0.0-bogus`                  | Yes; `git checkout`, diff clean, `OPENCODE_VERSION=2.0.26` back, no container left (`v4-05`) |
| 1a/06 | `Negative case:` marker renamed away in `q07.log` (builder moved `q06.log`; QA renamed the `q10` marker)        | FAIL exit 1: `q07.log has no structured 'Negative case: <observation>' line` | Yes; `git checkout`, diff clean, direct re-run PASS (`v4-06`)                                |
| 1a/04 | `HEALTHCHECK` CMD `/api/info` → `/api/nonexistent` + rebuild (builder flipped `USER`; QA deleted `HEALTHCHECK`) | FAIL exit 1: `container never healthy (status=unhealthy)`                    | Yes; exact checkout, rebuilt, direct re-run PASS, no container left (`v4-07`)                |

Green re-confirmation for 05 without a second live run: the restored tree
is byte-identical (`git diff --exit-code` clean) to the tree that passed
05 minutes earlier in the full accept run, so no extra model spend was
burned — the same no-spend convention QA used.

## Findings

No findings. Every claim below held; the observations that break no rule
are under Notes.

## Claims compared with the tree

- **F1 (pass-2 verdict driver) — RESOLVED.** `.env.provider` exists at
  mode 0600 with a non-empty key (presence only ever reported);
  `AGENCY_MODEL=opencode-go/muse-spark-1.3-contributor` confirmed in
  `.env`. Checks 01/05/06 pass; Q1/Q9/Q10/Q11 answered with keyed
  evidence; accept exits 0.
- **SPIKE PASS + Q1(partly)/Q9(partly)/Q10(yes)/Q11(yes).** My accept run
  re-exercised the whole spike flow green (session create with
  permissions, ask→list→reject round-trip, prompt, wait, role-aware
  transcript assertion, diff with `notes.txt`). Q1 re-corroborated live by
  me (`v4-09`: host 2.0.28 lists the id ×2, container 2.0.26 standalone
  prints nothing). Q9/Q10/Q11 logs read genuine: exact error envelopes
  (`GoUsageLimitError`/monthly, token counts in 1814/out 4/reasoning
  26/cache.read 896, `CONNECT opencode.ai:443` / `CONNECT
mcp.context7.com:443` with direct-DNS rc=6 negative case, SSE
  `session.tool.called/success` frames with sessionID + shared call id +
  `echo:hello-sse3` output). Parser (`scripts/spike-assert-messages.py`)
  accepts the shell marker from assistant `tool` parts named `shell` as
  well as `type: shell` messages and ignores the user echo — read in full,
  no vacuous path. Transcripts redacted with raw DBs destroyed: teardown is
  `docker rm -f` by name on `EXIT`, and check 07 passes on the real key.
- **QA `make check` 0 + accept 0 (8/0/0) + 8 fresh red-proofs.** My runs
  reproduce both exactly. All eight `red/qa-*.log` headers state sabotages
  differing from the builder's (01 mode-vs-absent, 02 floating-FROM vs
  zeroed-digest, 03 API_KEY-vs-PASSWORD block, 04 HEALTHCHECK-delete vs
  USER-swap, 06 q10-marker vs q06-move, 07 unstaged-build-notes-append vs
  staged-throwaway; 05/08 share the shape with a different value/name and
  state, justified as the fail-fast form). HEAD is exactly `91c4151`; the
  starting tree was clean (`git status` empty before my runs).
- **Commit subjects vs diffs** (`4721f11..91c4151`): no subject claims
  "live"/"verified"; the new keyed commits match their diffs —
  `309d297` (cat-jam-free pin, same-path `-v WORK:WORK` mount, tool-part
  parser case), `c88beb3` (q01/q09/q10/q11 + q03 supplement), `d25114b`
  (report/build-notes keyed run), `91c4151` ("green accept, make check, 8
  red-proofs" — all three re-observed this pass).
- **Built items**: preflight, base image + entrypoint + `make build-base`,
  spike runner/config/parser, checks 01–08 — all exist, wired
  (Makefile/checks/spike), and exercised by my runs.
- **Not performed / Not built**: both accurately empty — 05 ran (no
  skip), all fifteen answers recorded, fallbacks complete. Nothing the
  stage asked for is missing.
- **Register guards due by this stage**: no defects.md row has Stage 1a;
  every stage-0 guard re-passes (unit tests inside `make check`, `0/06`
  PASS, `0/01`/`0/02`/`0/10`, `0/07`, harness self-test all PASS).
- **Step-4 check-script review** (all eight read in full): each would exit
  1 if its condition broke — no `|| true` on judged paths (only annotated
  teardown `docker rm -f` and harness grep fallbacks with mismatch
  handling), no `set +e` outside `accept.sh`'s exit-code classifier (which
  re-tests the result line and fails mismatches closed), the sole SKIP
  branch is the prompt-allowed keyless-05, no self-created assertions
  (06's markers cite observed rc/signals; 05's markers must come from
  server-produced messages), no source-only greps for behaviour rows, the
  120 s per-check timeout turns hangs into FAIL, and 07/08 fail closed on
  scan/`docker ps` errors.

## Fail-closed probes

| Situation                                     | Expected                       | Observed                                                                                 |
| --------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `OPENCODE_PASSWORD` empty at start            | exit non-zero naming it        | exit 64, log names it (`v4-04`)                                                          |
| `OPENCODE_API_KEY` empty at start             | exit non-zero naming it        | exit 64, log names it (`v4-04`)                                                          |
| Malformed `/etc/agency/mcp-requirements.json` | refuse to start, name the file | exit 64, `cannot read MCP requirements from /etc/agency/mcp-requirements.json` (`v4-08`) |
| Image pin wrong (`OPENCODE_VERSION` bogus)    | spike fails, check 05 red      | `missing image`, check FAIL (`v4-05`)                                                    |
| Health endpoint broken                        | check 04 red, never vacuous    | `never healthy (status=unhealthy)` (`v4-07`)                                             |
| Marker stripped from `q07.log`                | check 06 red                   | `no structured 'Negative case' line` (`v4-06`)                                           |

4.2 rows this stage does not touch (empty check list, missing judge,
unreachable expert/proxy, `no-block`, landed-SHA `done`, task-command
placement, process-group kill, `ask` rejection at the Dispatcher) belong
to Stages 1b/1c and later; the permission ask→reject path is covered by
every green spike run. No `make down/up`: no compose file exists in this
stage (explicitly Stage 1b work).

## Not verified

- Q10/Q11 server-side internals (proxy CONNECT lines, SSE frame capture)
  and Q9 token fill-in beyond what the checks assert: read as
  hand-transcribed redacted logs, not re-run — re-running them would cost
  extra live model runs, and only the one authorized live run (the accept
  spike) was spent. Internal consistency plus my Q1 live corroboration and
  the green structural assertions carry them.
- Builder/QA red-proofs for 01/02/03/07/08: reviewed on paper (all headers
  state real sabotages with exit-1 output quoted); re-run with distinct
  variants only for 04/05/06.
- Check 06's frozen keyword-filter bound stands as pass 2 judged it: an
  unenumerated denial with a signal word could pass the filter. I read all
  six cited marker paragraphs — each carries a checkable observed outcome
  (EROFS rc=1 ×2, deny effect, DNS rc=6, ConnectionRefused / SQLiteError
  rc=1, UNSET) — so no standing evidence rests on the bound.

## Notes

- The accept harness writes its log to `docs/evidence/1a/` by default; I
  moved that one file into `docs/evidence/1a/verify/` (as
  `v4-02-accept-1a-harness.log`, recorded name differs from the printed
  path) and ran stage-0 accept with `EVIDENCE_ROOT` pointed at `verify/`,
  so every file I created lives in my write scope.
- `.env`/`.env.provider` are gitignored, mode 0600; the key value appears
  in no file, no log, and no output of mine. `AGENCY_MODEL` is not secret
  and is quoted from the builder report only.
- Dev-harness containers without CPU/memory/PID limits (`spike.sh`,
  checks 03/04, my probes): same justified exception as passes 1–2 — the
  stage prompt mandates these direct named starts with teardown traps, the
  limits contract binds the Stage-1b generated compose (D-07), and none
  was left running.
- This report and the `v4-*` evidence were left uncommitted by the
  verifier; the master committed them unchanged apart from the mechanical
  reorder notes above.
