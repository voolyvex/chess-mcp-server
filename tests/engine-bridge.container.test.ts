import { describe, expect, it } from 'vitest';
import { ENGINE_URL, engineUnreachable } from './helpers/engine-availability.js';

/**
 * Tier 2, container path — the bridge's side of the engine contract, verified against a
 * real Stockfish over real HTTP. Invariants only: nothing here asserts a specific
 * evaluation, only that the shape and provenance the handler depends on are present.
 *
 * Scores here are *Raw Scores* — side-to-move relative, as UCI reports them. The bridge
 * deliberately does not convert; White-relative Evaluation is the handler's job.
 */

/** A quiet middlegame — deep enough that a short budget cannot exhaust the tree. */
const MIDDLEGAME_FEN = 'r1bq1rk1/pp2ppbp/2np1np1/8/2BNP3/2N1B3/PPP2PPP/R2Q1RK1 b - - 3 14';

/** Mate in one: Qf3xf7#. White to move. */
const MATE_IN_ONE_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

type EngineLine = {
  depth: number;
  multipv_rank: number;
  score_cp: number | null;
  score_mate: number | null;
  wdl: [number, number, number] | null;
  pv: string[];
};

type AnalyzeResult = {
  engine: { name: string | null; version: string | null; build: string };
  lines: EngineLine[];
  depth_reached: number;
  nodes: number | null;
  nps: number | null;
  time_ms: number;
  movetime_ms: number;
  multipv: number;
};

async function analyze(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${ENGINE_URL}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function analyzeOk(body: Record<string, unknown>): Promise<AnalyzeResult> {
  const response = await analyze(body);
  expect(response.status).toBe(200);
  return (await response.json()) as AnalyzeResult;
}

describe.skipIf(await engineUnreachable())('tier 2, engine bridge', () => {
  describe('wall-clock is the budget, depth is the outcome', () => {
    it('bounds a search by wall-clock and reports the depth it reached', async () => {
      const result = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 500 });

      expect(result.depth_reached).toBeGreaterThan(0);
      expect(result.movetime_ms).toBe(500);
      // The engine stops itself, so the wall-clock overshoot is scheduling noise, not a
      // second search. Generous bound: this asserts "budgeted", not a latency SLA.
      expect(result.time_ms).toBeLessThan(3_000);
    });

    it('rejects a requested depth rather than honouring it as a budget', async () => {
      const response = await analyze({ fen: MIDDLEGAME_FEN, depth: 30 });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/depth/i);
    });

    it('returns a low reported depth on a short budget, never a 5xx', async () => {
      // Budget exhaustion is the normal case, not a failure: when the timer fires the
      // bridge must return the deepest completed iteration, never discard it and 5xx.
      const response = await analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 50 });
      expect(response.status).toBe(200);

      const result = (await response.json()) as AnalyzeResult;
      expect(result.depth_reached).toBeGreaterThan(0);
      expect(result.lines.length).toBeGreaterThan(0);
    });

    it('reaches a deeper depth when given a larger budget', async () => {
      // Depth is an outcome of the budget. Two budgets an order of magnitude apart on the
      // same position must not report the same depth — that would mean the budget is
      // being ignored, or the depth is being echoed from the request.
      const brief = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 100 });
      const longer = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 1_500 });

      expect(longer.depth_reached).toBeGreaterThan(brief.depth_reached);
    });

    it('returns only completed iterations — every line shares the reported depth', async () => {
      // A budget expiring mid-iteration leaves that iteration short of its MultiPV quota.
      // Shipping it would mix a partial line from an in-flight iteration with the
      // completed one below it, at two different depths under one depth_reached.
      const result = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 350, multiPv: 3 });

      for (const line of result.lines) {
        expect(line.depth).toBe(result.depth_reached);
      }
      expect(result.lines.length).toBe(result.multipv);

      const ranks = result.lines.map((line) => line.multipv_rank);
      expect(ranks).toStrictEqual([1, 2, 3]);
    });
  });

  describe('WDL must be asked for', () => {
    it('carries a win/draw/loss triple in per mille on every line', async () => {
      // UCI_ShowWDL defaults to false; without an explicit setoption the field silently
      // never appears, which reads as the engine not supporting it.
      const result = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 500, multiPv: 2 });

      expect(result.lines.length).toBeGreaterThan(0);
      for (const line of result.lines) {
        expect(line.wdl).not.toBeNull();
        const wdl = line.wdl as [number, number, number];
        expect(wdl).toHaveLength(3);
        for (const part of wdl) {
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThanOrEqual(0);
          expect(part).toBeLessThanOrEqual(1000);
        }
        // Per mille, so the triple sums to 1000.
        expect(wdl[0] + wdl[1] + wdl[2]).toBe(1000);
      }
    });

    it('ships the Raw Score alongside, side-to-move relative and unconverted', async () => {
      const result = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 500 });
      const [best] = result.lines;

      expect(best).toBeDefined();
      // One of the two is always present; converting to White-relative is the handler's
      // job, so the bridge must not have done it.
      expect(best!.score_cp !== null || best!.score_mate !== null).toBe(true);
      expect(best!.pv.length).toBeGreaterThan(0);
      expect(best!.pv[0]).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    });
  });

  describe('a forced mate is a mate distance, not centipawns', () => {
    it('reports score_mate and leaves score_cp null', async () => {
      const result = await analyzeOk({ fen: MATE_IN_ONE_FEN, movetimeMs: 500, multiPv: 1 });
      const [best] = result.lines;

      expect(best).toBeDefined();
      expect(best!.score_mate).toBe(1);
      // Not ±30000 standing in for a mate — a mate distance and a centipawn score are
      // different quantities, and a caller must not have to guess which it received.
      expect(best!.score_cp).toBeNull();
      expect(best!.wdl).toStrictEqual([1000, 0, 0]);
    });
  });

  describe('the engine says who it is', () => {
    it('reports name, version, and build over HTTP', async () => {
      const response = await fetch(`${ENGINE_URL}/id`);
      expect(response.ok).toBe(true);

      const identity = (await response.json()) as {
        name: string;
        version: string;
        build: string;
      };

      expect(identity.name).toMatch(/Stockfish/i);
      // Version is harvested from the UCI handshake, not hardcoded, so this asserts the
      // parse worked rather than pinning a number the Dockerfile owns.
      expect(identity.version).toMatch(/^\d/);
      // Part of the cache key downstream: omit it and a failover between two engine
      // versions serves one engine's evaluations as the other's.
      expect(identity.build).not.toBe('unknown');
    });

    it('carries the same identity on every analysis result', async () => {
      const [identity, result] = await Promise.all([
        fetch(`${ENGINE_URL}/id`).then((r) => r.json() as Promise<{ name: string; version: string; build: string }>),
        analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 200 }),
      ]);

      expect(result.engine.name).toBe(identity.name);
      expect(result.engine.version).toBe(identity.version);
      expect(result.engine.build).toBe(identity.build);
    });

    it('reports identity on the health endpoint too', async () => {
      const response = await fetch(`${ENGINE_URL}/health`);
      const health = (await response.json()) as {
        status: string;
        engine: { name: string | null; build: string };
      };

      expect(health.status).toBe('ready');
      expect(health.engine.name).toMatch(/Stockfish/i);
    });
  });

  describe('crash and respawn', () => {
    // Killing the engine is destructive to the shared container, so it is opt-in:
    // ENGINE_CRASH_TEST=1 npx vitest run --project tier2-container
    // The bridge respawns the engine in-process, so the container itself never restarts.
    it.skipIf(process.env['ENGINE_CRASH_TEST'] !== '1')(
      'fails an in-flight request cleanly when the engine dies, then recovers',
      async () => {
        const budgetMs = 20_000;
        const startedAt = Date.now();

        const inFlight = analyze({ fen: MIDDLEGAME_FEN, movetimeMs: budgetMs });
        await new Promise((resolve) => setTimeout(resolve, 1_500));

        const { execFileSync } = await import('node:child_process');
        execFileSync('docker', [
          'exec',
          'chess-engine',
          'node',
          '-e',
          // Matches the engine by argv[0] only, and skips self: this killer's own cmdline
          // contains "stockfish" (the script text is in its argv), so a naive substring
          // match over /proc makes it SIGKILL itself before reaching the engine.
          `const fs=require("fs");
           for (const p of fs.readdirSync("/proc").filter(d=>/^\\d+$/.test(d))) {
             if (+p === process.pid) continue;
             try {
               const argv0 = fs.readFileSync("/proc/"+p+"/cmdline","utf8").split("\\0")[0];
               if (argv0.endsWith("stockfish")) process.kill(+p,"SIGKILL");
             } catch {}
           }`,
        ]);

        const response = await inFlight;
        const elapsed = Date.now() - startedAt;

        // Failed, rather than hanging until the caller's own timeout — no `bestmove` is
        // ever coming for a search whose engine is gone.
        expect(response.status).toBe(503);
        expect(elapsed).toBeLessThan(budgetMs / 2);
        expect(((await response.json()) as { error: string }).error).toMatch(/engine exited/i);

        // …and the bridge brings the engine back, with UCI_ShowWDL and identity re-applied
        // rather than lost with the dead process.
        let recovered: AnalyzeResult | null = null;
        for (let attempt = 0; attempt < 20 && recovered === null; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          const retry = await analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 300 });
          if (retry.status === 200) recovered = (await retry.json()) as AnalyzeResult;
        }

        expect(recovered).not.toBeNull();
        expect(recovered!.depth_reached).toBeGreaterThan(0);
        expect(recovered!.engine.name).toMatch(/Stockfish/i);
        expect(recovered!.lines[0]!.wdl).not.toBeNull();
      },
      90_000,
    );
  });

  describe('evidence', () => {
    it('carries the node and time counters a caller cannot invent', async () => {
      const result = await analyzeOk({ fen: MIDDLEGAME_FEN, movetimeMs: 500 });

      expect(result.nodes).toBeGreaterThan(0);
      expect(result.nps).toBeGreaterThan(0);
      expect(result.time_ms).toBeGreaterThan(0);
    });
  });
});
