# Benchmark harness — depth at a fixed budget

Answers one question: **does this host search as well as that one?**

`docs/prd.md` §8 does not answer it. §8 measured *latency*, which is pinned to the budget by
design — a 2000 ms search takes 2000 ms on any hardware, so §8's figures are near-identical
on ARM and say nothing about search quality. Wall-clock is the budget; depth is the outcome.
This measures the outcome.

## Running it

```bash
docker compose up -d engine          # the harness talks to the bridge, not the MCP handler
npm run bench                        # defaults: 2000 ms, 3 repeats, MultiPV=1
npm run bench -- --movetime 5000 --repeat 5 --json results.json --label "arm"
```

| Flag | Default | Meaning |
|---|---|---|
| `--movetime` | `2000` | Wall-clock budget per search, ms |
| `--repeat` | `3` | Searches per position; the median is reported |
| `--multipv` | `1` | MultiPV rank count |
| `--engine` | `$ENGINE_URL` or `http://localhost:8090` | Bridge base URL |
| `--json` | — | Write the full per-sample record here |
| `--label` | — | Free-text tag recorded in the JSON |

## What it reports, and why

**Depth reached, per phase, never pooled.** Depth varies enormously by phase — the x86
baseline below shows ~22 in a middlegame against ~55 in an endgame at the same budget — so
an average across all nine positions is meaningless. The fixture commits three positions per
phase and the phase label is committed data, reviewable in the diff, not inferred at run time.

**Overhead above budget, measured as wall-clock minus budget.** This is deliberately *not*
derived from the engine's own `time_ms`. Stockfish reports its internal search clock, which
tracks `go movetime` so tightly it reads 2001 ms against a 2000 ms budget regardless of what
the host or the transport is doing — an overhead figure built on it is a permanent ~0 ms that
can never catch a regression, because bridge queueing and HTTP round-trip are precisely the
costs it excludes. Both figures are kept in the JSON so the two can be compared.

Overhead *is* pooled across phases, unlike depth: it measures the bridge and the transport,
which do not care what phase the position is in.

## Reading the results

**No pass/fail threshold is fixed in advance**, and the spread is why. Repeated runs of the
same position at the same budget differ — endgame-1 returned depths 55 through 68 across
three runs — because SMP search is nondeterministic. Measure across the fixture, read the
spread, decide with data in hand.

**Record the thread count.** It is part of the result, not part of the environment. The x86
baseline ran `Threads=4` on a 12-thread host, so Stockfish had headroom; Oracle's free ARM
has 4 cores total, where `Threads=4` contends with the handler, the bridge, and the OS.
Either keep `Threads=4` as the honest production configuration or hold total-cores-minus-one
constant — but say which, because a depth figure without its thread count is not comparable
to anything. The harness prints the engine's identity and thread count above every run and
records them in the JSON for this reason.
