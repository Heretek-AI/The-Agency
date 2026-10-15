# SwarmOS Benchmark

Measures whether SwarmOS actually helps by running the same tasks with SwarmOS fully on
(`swarmos`) and with SwarmOS loaded in observe-only mode (`baseline`: telemetry and `/doctor`, nothing else).

## Tasks

Each task in `tasks/<id>/` has:

| Path | Purpose |
| :--- | :--- |
| `task.json` | `id`, `category` (`bug`, `refactor`, `constraints`, `ui`), the user-style `prompt`, the `verify` command and a timeout |
| `repo/` | Starting repository the agent works in |
| `hidden/` | Tests copied to `__hidden__/` only after the agent finishes |
| `solution/` | Reference fix, used to prove the task is solvable |

## Running

```bash
bun run bench:check                                   # reference driver must pass 12/12, noop must pass 0/12
bun bench/run.ts --driver agent --repeat 3            # real comparison, both variants
bun bench/run.ts --driver agent --tasks bug-paginate,ui-spacing-tokens --variants swarmos
```

The `agent` driver runs `BENCH_AGENT_CMD` (default `opencode run "$BENCH_PROMPT"`) inside a fresh git
workspace with an `opencode.json` that loads `swarmos-plugin.ts` (override with `--plugin <path>`).
Run `bun run build` first so the bundle is current.

Reports land in `bench/results/` as JSON plus a Markdown table: success rate (overall and per category),
mean turns, mean tool calls, tool failure rate, circuit-breaker fires, tokens and cache-hit ratio,
and wall time. Turn, tool and breaker numbers come from SwarmOS telemetry; token numbers appear only
when the host reports usage on `session.generate` events.

## Adding a task

Create the four parts above, then run `bun run bench:check`. `test/bench.test.ts` runs the same
check in CI, so a task whose hidden tests pass untouched or fail on the reference solution breaks the build.
