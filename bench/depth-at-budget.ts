/**
 * The benchmark harness: depth reached at a fixed wall-clock budget, per phase.
 *
 * Written once, run on both hosts (docs/beta-readiness.md §6). It exists because §8 of
 * docs/prd.md measured the wrong quantity for an x86-vs-ARM comparison. §8's numbers are
 * *latency*, which is pinned to the budget by design — a 2000 ms search takes 2000 ms on
 * any hardware, so those figures say nothing about whether Ampere cores search as well as
 * a Ryzen. Wall-clock is the budget; depth is the outcome. This measures the outcome.
 *
 * Two quantities, per position:
 *
 *   - **Depth reached** at the budget — the ARM question.
 *   - **Overhead above budget** (`time_ms - movetime_ms`) — keeps §8 comparable and
 *     catches overhead regressions, which is a different failure from searching slowly.
 *
 * It talks to the engine bridge's `/analyze` directly rather than through the MCP handler.
 * The question is how fast the host searches; routing through the handler would fold in
 * cache lookups and schema validation, neither of which differs by CPU architecture.
 *
 * Usage:
 *   npx tsx bench/depth-at-budget.ts [--movetime 2000] [--repeat 3] [--json out.json]
 *                                    [--engine http://localhost:8090] [--multipv 1]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

type Phase = 'opening' | 'middlegame' | 'endgame';

interface FixturePosition {
  readonly id: string;
  readonly phase: Phase;
  readonly name: string;
  readonly fen: string;
}

/** One search, as the harness records it. */
interface Sample {
  readonly depth_reached: number;
  /**
   * Wall-clock around the whole request, measured by the caller.
   *
   * This — not the engine's own `time_ms` — is the basis for overhead. Stockfish reports
   * its internal search clock, which tracks `go movetime` so tightly it reads 2001 ms
   * against a 2000 ms budget no matter what the host or the transport is doing. Deriving
   * overhead from it would produce a permanent ~0 ms that could never catch the
   * regressions §6 wants caught, because bridge queueing and HTTP round-trip are exactly
   * the costs it excludes.
   */
  readonly elapsed_ms: number;
  /** The engine's own reported search time, kept so the two can be compared. */
  readonly time_ms: number | null;
  readonly nodes: number | null;
  readonly nps: number | null;
}

interface PositionResult {
  readonly id: string;
  readonly phase: Phase;
  readonly name: string;
  readonly fen: string;
  readonly samples: readonly Sample[];
  /** Median depth across repeats. Depth is discrete and skews, so median beats mean. */
  readonly depth_median: number;
  readonly depth_min: number;
  readonly depth_max: number;
  /** Median of (wall-clock − budget). Always present: wall-clock is always measured. */
  readonly overhead_ms_median: number;
  readonly overhead_ms_max: number;
}

interface EngineIdentity {
  name: string | null;
  version: string | null;
  build: string;
  threads?: number;
  hash_mb?: number;
}

const PHASES: readonly Phase[] = ['opening', 'middlegame', 'endgame'];

function parseArgs(argv: readonly string[]) {
  const opts = {
    movetimeMs: 2000,
    repeat: 3,
    engineUrl: process.env.ENGINE_URL ?? 'http://localhost:8090',
    multiPv: 1,
    jsonOut: null as string | null,
    label: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--movetime':
        opts.movetimeMs = Number(value);
        i += 1;
        break;
      case '--repeat':
        opts.repeat = Number(value);
        i += 1;
        break;
      case '--engine':
        opts.engineUrl = String(value);
        i += 1;
        break;
      case '--multipv':
        opts.multiPv = Number(value);
        i += 1;
        break;
      case '--json':
        opts.jsonOut = String(value);
        i += 1;
        break;
      case '--label':
        opts.label = String(value);
        i += 1;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown flag: ${arg}`);
    }
  }
  if (!Number.isFinite(opts.movetimeMs) || opts.movetimeMs <= 0) {
    throw new Error('--movetime must be a positive integer (milliseconds)');
  }
  if (!Number.isFinite(opts.repeat) || opts.repeat < 1) {
    throw new Error('--repeat must be at least 1');
  }
  return opts;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function engineIdentity(baseUrl: string): Promise<EngineIdentity> {
  const response = await fetch(`${baseUrl}/id`);
  if (!response.ok) {
    throw new Error(
      `engine identity unavailable at ${baseUrl}/id (${response.status}). ` +
        `The engine reports "warming up" until Stockfish answers its handshake.`,
    );
  }
  return (await response.json()) as EngineIdentity;
}

async function analyze(
  baseUrl: string,
  fen: string,
  movetimeMs: number,
  multiPv: number,
): Promise<Sample> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fen, movetimeMs, multiPv }),
  });
  if (!response.ok) {
    throw new Error(`engine returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    depth_reached: number;
    time_ms: number | null;
    nodes: number | null;
    nps: number | null;
  };
  const elapsedMs = performance.now() - startedAt;
  return {
    depth_reached: body.depth_reached,
    elapsed_ms: Math.round(elapsedMs),
    time_ms: body.time_ms,
    nodes: body.nodes,
    nps: body.nps,
  };
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const fixture = JSON.parse(readFileSync(join(HERE, 'fixture.json'), 'utf8')) as {
    positions: FixturePosition[];
  };

  const identity = await engineIdentity(opts.engineUrl);

  // Engine identity is printed with the numbers, never assumed. A depth figure without
  // the engine and thread count that produced it is not comparable to anything — and
  // threading is exactly what §6 says to choose deliberately and record.
  const engineLabel =
    `${identity.name ?? 'unknown'} ${identity.version ?? '?'} (${identity.build})` +
    `, Threads=${identity.threads ?? '?'}, Hash=${identity.hash_mb ?? '?'}MB`;

  console.log(`engine     ${engineLabel}`);
  console.log(`host       ${process.platform}/${process.arch}, ${cpus().length} logical cores`);
  console.log(`budget     ${opts.movetimeMs} ms movetime, MultiPV=${opts.multiPv}, ${opts.repeat} repeats`);
  if (opts.label) console.log(`label      ${opts.label}`);
  console.log();

  const results: PositionResult[] = [];

  for (const position of fixture.positions) {
    const samples: Sample[] = [];
    for (let run = 0; run < opts.repeat; run += 1) {
      samples.push(await analyze(opts.engineUrl, position.fen, opts.movetimeMs, opts.multiPv));
    }
    const depths = samples.map((s) => s.depth_reached);
    const overheads = samples.map((s) => s.elapsed_ms - opts.movetimeMs);

    const result: PositionResult = {
      id: position.id,
      phase: position.phase,
      name: position.name,
      fen: position.fen,
      samples,
      depth_median: median(depths),
      depth_min: Math.min(...depths),
      depth_max: Math.max(...depths),
      overhead_ms_median: median(overheads),
      overhead_ms_max: Math.max(...overheads),
    };
    results.push(result);

    console.log(
      `  ${position.id.padEnd(14)} depth ${pad(result.depth_median, 3)}` +
        ` (${result.depth_min}–${result.depth_max})` +
        `  overhead ${pad(result.overhead_ms_median, 5)} ms` +
        ` (max ${result.overhead_ms_max})`,
    );
  }

  // Reported per phase, never pooled. Depth varies too much between phases for a single
  // average across all nine to mean anything.
  console.log();
  console.log('  phase          depth (median of per-position medians)   range');
  for (const phase of PHASES) {
    const inPhase = results.filter((r) => r.phase === phase);
    if (inPhase.length === 0) continue;
    const medians = inPhase.map((r) => r.depth_median);
    const lo = Math.min(...inPhase.map((r) => r.depth_min));
    const hi = Math.max(...inPhase.map((r) => r.depth_max));
    console.log(`  ${phase.padEnd(14)} ${pad(median(medians), 5)}${' '.repeat(34)}${lo}–${hi}`);
  }

  // Overhead is pooled across phases deliberately, unlike depth: it measures the bridge
  // and the transport, which do not care what phase the position is in.
  const allOverheads = results.map((r) => r.overhead_ms_median);
  console.log();
  console.log(
    `  overhead above budget (wall-clock − budget): median ${median(allOverheads)} ms, ` +
      `max ${Math.max(...results.map((r) => r.overhead_ms_max))} ms`,
  );

  if (opts.jsonOut) {
    const payload = {
      recorded_at: new Date().toISOString(),
      label: opts.label,
      engine: identity,
      host: {
        platform: process.platform,
        arch: process.arch,
        logical_cores: cpus().length,
      },
      budget: { movetime_ms: opts.movetimeMs, multipv: opts.multiPv, repeat: opts.repeat },
      positions: results,
    };
    writeFileSync(opts.jsonOut, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`\n  wrote ${opts.jsonOut}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
