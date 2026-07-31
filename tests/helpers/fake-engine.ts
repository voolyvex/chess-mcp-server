import type { EngineClient, EngineResult, EngineLine } from '../../src/engine-client.js';

/**
 * The tier-1 fake engine.
 *
 * It is **typed as returning Raw Scores** — the `EngineLine` it hands back carries
 * `raw_score_cp`, side-to-move relative, exactly as UCI reports it. That typing is the
 * point: the prototype's fake returned a number called `cp` that the test then asserted
 * was White-relative, so the fixture encoded the same misunderstanding as the code and
 * the sign bug survived 28 test files. This fake structurally cannot launder that
 * question, because there is no field on it that is already White-relative.
 *
 * Use it for input forms, schema shape, and error rules. Never for what a score *means* —
 * that is tier 2's job, against a real engine.
 */
export function fakeEngine(result: Partial<EngineResult> = {}): EngineClient {
  return {
    async engineIdentity() {
      return { ...defaultResult(), ...result }.engine;
    },
    async analyze() {
      return { ...defaultResult(), ...result };
    },
  };
}

/** A plausible depth-20 search of a quiet position, in the engine's own terms. */
function defaultResult(): EngineResult {
  return {
    engine: { name: 'FakeEngine', version: '0', build: 'fake' },
    lines: [line()],
    depth_reached: 20,
    nodes: 1_234_567,
    nps: 987_654,
    time_ms: 1_250,
  };
}

export function line(overrides: Partial<EngineLine> = {}): EngineLine {
  return {
    depth: 20,
    multipv_rank: 1,
    raw_score_cp: 35,
    raw_score_mate: null,
    raw_wdl: [280, 640, 80],
    pv: ['e2e4', 'e7e5', 'g1f3'],
    ...overrides,
  };
}

/** An engine client that fails, for testing how the tool reports an unreachable engine. */
export function unreachableEngine(message = 'engine is not running'): EngineClient {
  return {
    async engineIdentity(): Promise<never> {
      throw new Error(message);
    },
    async analyze(): Promise<never> {
      throw new Error(message);
    },
  };
}
