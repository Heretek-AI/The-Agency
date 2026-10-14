#!/usr/bin/env bash
# 09-no-task-exec-in-dispatcher: task commands never run in the Dispatcher.
# Raw spawning lives only in the audited primitive
# (dispatcher/src/util/exec.ts, group-kill + explicit env, covered by the
# D-08/D-09 defect tests). Its callers are exactly: git.ts (git only) on
# the Dispatcher side, and verifier/src/run-checks.ts (the declared-check
# path) on the verifier side. Mentions in comments do not count; this
# check matches call syntax, not names.
set -u
set -o pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/../lib.sh"
root="$(git rev-parse --show-toplevel)"
cd "$root" || fail "cannot cd to $root"

# 1. Raw process creation only in the primitive.
raw=$(grep -rln -E "from \"node:child_process\"|Bun\.spawn|spawnSync|execSync" \
  dispatcher/src verifier/src --include='*.ts' | grep -v '\.test\.ts' || true)
[ "$raw" = "dispatcher/src/util/exec.ts" ] \
  || fail "raw spawn outside util/exec.ts: $(echo "$raw" | tr '\n' ' ')"

# 2. Exactly the authorized callers use the primitive.
callers=$(grep -rln -E "exec(Cmd|Shell)\(" dispatcher/src verifier/src \
  --include='*.ts' | grep -v '\.test\.ts' | LC_ALL=C sort || true)
want=$(printf 'dispatcher/src/git.ts\ndispatcher/src/util/exec.ts\nverifier/src/run-checks.ts' | LC_ALL=C sort)
[ "$callers" = "$want" ] \
  || fail "exec callers are not exactly git/exec/run-checks: $(echo "$callers" | tr '\n' ' ')"

# 3. git.ts runs only git (no shell, no other command).
other=$(grep -nE "execShell|Bun\.spawn|[^_]spawn\(|\"sh\"|'sh'|sh -c" dispatcher/src/git.ts || true)
[ -z "$other" ] || fail "git.ts runs more than git: $(echo "$other" | tr '\n' ' ')"
calls=$(grep -c "execCmd(" dispatcher/src/git.ts)
gitcalls=$(grep -c 'execCmd(\["git"' dispatcher/src/git.ts)
[ "$calls" = "$gitcalls" ] || fail "git.ts calls execCmd with non-git argv ($calls calls, $gitcalls git)"

# 4. The verifier's check path takes an explicit env (never inherits).
grep -q "env," verifier/src/run-checks.ts \
  || fail "run-checks.ts does not pass an explicit env"
grep -q "process\.env" verifier/src/run-checks.ts \
  && fail "run-checks.ts reads the ambient environment"

pass
