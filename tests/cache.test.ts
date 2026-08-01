import { describe, expect, it } from 'vitest';
import { cachingEngine } from '../src/cache.js';
import type { AnalyzeRequest, EngineClient, EngineIdentity, EngineResult } from '../src/engine-client.js';
import { evaluatePosition } from '../src/evaluate-position.js';
import { line } from './helpers/fake-engine.js';

/**
 * Tier 1: what the cache *keys on* and *reports*, driven by a counting engine.
 *
 * Nothing here asserts what a score means — the numbers are invented. What is being
 * pinned is provenance: that two engine identities never share an entry, that a served
 * entry reports the depth of the search that produced it rather than the one asked for,
 * and that `cache_hit` says which of the two happened.
 */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

const STOCKFISH_18: EngineIdentity = { name: 'Stockfish', version: '18', build: 'bmi2' };
const STOCKFISH_15: EngineIdentity = { name: 'Stockfish', version: '15.1', build: 'apt' };

/**
 * An engine that counts its searches and reports whichever identity it is currently
 * wearing — the two things a cache test has to observe.
 *
 * `depthFor` lets a search's reached depth depend on the budget it was given, which is
 * how "the deepest result is stored" becomes observable at all.
 */
function countingEngine(
  identity: EngineIdentity = STOCKFISH_18,
  depthFor: (request: AnalyzeRequest) => number = () => 20,
): EngineClient & { calls: AnalyzeRequest[] } {
  const calls: AnalyzeRequest[] = [];
  return {
    calls,
    async engineIdentity(): Promise<EngineIdentity> {
      return identity;
    },
    async analyze(request: AnalyzeRequest): Promise<EngineResult> {
      calls.push(request);
      const depth = depthFor(request);
      return {
        engine: identity,
        lines: [line({ depth })],
        depth_reached: depth,
        nodes: 1_000,
        nps: 1_000,
        time_ms: request.movetimeMs ?? 1_000,
      };
    },
  };
}

describe('the cache key includes engine identity', () => {
  /**
   * Two engines behind one shared store — the prototype's actual failure, where a router
   * fell back between Stockfish 15 and 18 and served one's evaluations as the other's.
   * The identity is the *only* thing that differs; the FEN and the budget are identical,
   * so a key that omitted identity would hit here and be wrong.
   */
  it('misses when only the identity differs', async () => {
    const store = new Map<string, unknown>();
    const eighteen = countingEngine(STOCKFISH_18);
    const fifteen = countingEngine(STOCKFISH_15);

    const cachedEighteen = cachingEngine(eighteen, { store });
    const cachedFifteen = cachingEngine(fifteen, { store });

    await cachedEighteen.analyze({ fen: START_FEN, movetimeMs: 1_000 });
    const second = await cachedFifteen.analyze({ fen: START_FEN, movetimeMs: 1_000 });

    expect(eighteen.calls).toHaveLength(1);
    expect(fifteen.calls).toHaveLength(1);
    expect(second.cache_hit).toBe(false);
    expect(second.engine).toEqual(STOCKFISH_15);
  });

  it('serves each identity its own entry, not whichever was written last', async () => {
    const store = new Map<string, unknown>();
    const eighteen = countingEngine(STOCKFISH_18);
    const fifteen = countingEngine(STOCKFISH_15);

    const cachedEighteen = cachingEngine(eighteen, { store });
    const cachedFifteen = cachingEngine(fifteen, { store });

    await cachedEighteen.analyze({ fen: START_FEN });
    await cachedFifteen.analyze({ fen: START_FEN });

    // 15 wrote last. 18 must still get 18's result, with 18's version as Evidence.
    const again = await cachedEighteen.analyze({ fen: START_FEN });

    expect(eighteen.calls).toHaveLength(1);
    expect(again.cache_hit).toBe(true);
    expect(again.engine).toEqual(STOCKFISH_18);
  });
});

describe('the key includes the position and the multipv width', () => {
  it('misses on a different position', async () => {
    const engine = countingEngine();
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN });
    await cached.analyze({ fen: AFTER_E4 });

    expect(engine.calls).toHaveLength(2);
  });

  it('misses on a wider multipv, because a 1-line result cannot answer a 3-line question', async () => {
    const engine = countingEngine();
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN, multiPv: 1 });
    const wider = await cached.analyze({ fen: START_FEN, multiPv: 3 });

    expect(engine.calls).toHaveLength(2);
    expect(wider.cache_hit).toBe(false);
  });
});

describe('the deepest result is stored, and serves any budget it satisfies', () => {
  /** A search that reaches roughly one ply per 100ms of budget. */
  const byBudget = (request: AnalyzeRequest): number => Math.floor((request.movetimeMs ?? 1_000) / 100);

  it('serves a smaller budget from a deeper stored result', async () => {
    const engine = countingEngine(STOCKFISH_18, byBudget);
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });
    const cheaper = await cached.analyze({ fen: START_FEN, movetimeMs: 1_000 });

    expect(engine.calls).toHaveLength(1);
    expect(cheaper.cache_hit).toBe(true);
  });

  it('searches again for a budget the stored result does not satisfy', async () => {
    const engine = countingEngine(STOCKFISH_18, byBudget);
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN, movetimeMs: 1_000 });
    const richer = await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });

    expect(engine.calls).toHaveLength(2);
    expect(richer.cache_hit).toBe(false);
    expect(richer.depth_reached).toBe(30);
  });

  it('keeps the deeper result when a shallower search follows it', async () => {
    const engine = countingEngine(STOCKFISH_18, byBudget);
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });
    await cached.analyze({ fen: START_FEN, movetimeMs: 1_000 });
    const again = await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });

    // The shallow request in the middle was served, not stored — the deep entry survives.
    expect(engine.calls).toHaveLength(1);
    expect(again.depth_reached).toBe(30);
  });
});

describe('a cache hit reports the search that actually happened', () => {
  const byBudget = (request: AnalyzeRequest): number => Math.floor((request.movetimeMs ?? 1_000) / 100);

  it('reports the depth the stored search reached, not the depth the budget implies', async () => {
    const engine = countingEngine(STOCKFISH_18, byBudget);
    const cached = cachingEngine(engine);

    const deep = await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });
    const served = await cached.analyze({ fen: START_FEN, movetimeMs: 1_000 });

    expect(deep.depth_reached).toBe(30);
    // The second request budgeted for depth 10 and is told the truth: it got depth 30.
    expect(served.depth_reached).toBe(30);
  });

  it('reports the time the stored search took, not the budget of the request served', async () => {
    const engine = countingEngine(STOCKFISH_18, byBudget);
    const cached = cachingEngine(engine);

    await cached.analyze({ fen: START_FEN, movetimeMs: 3_000 });
    const served = await cached.analyze({ fen: START_FEN, movetimeMs: 1_000 });

    expect(served.time_ms).toBe(3_000);
  });

  it('marks a fresh search as a miss', async () => {
    const cached = cachingEngine(countingEngine());
    const fresh = await cached.analyze({ fen: START_FEN });
    expect(fresh.cache_hit).toBe(false);
  });
});

describe('the cache is bounded and evicts least-recently-used', () => {
  /** Distinct positions, generated by walking the halfmove clock — cheap and legal-looking. */
  const fenNumbered = (n: number): string =>
    `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - ${n} 1`;

  it('evicts the least recently used entry once full', async () => {
    const engine = countingEngine();
    const cached = cachingEngine(engine, { maxEntries: 2 });

    await cached.analyze({ fen: fenNumbered(1) });
    await cached.analyze({ fen: fenNumbered(2) });
    // Touching 1 makes 2 the least recently used, so 3 evicts 2 rather than 1.
    await cached.analyze({ fen: fenNumbered(1) });
    await cached.analyze({ fen: fenNumbered(3) });

    expect((await cached.analyze({ fen: fenNumbered(1) })).cache_hit).toBe(true);
    expect((await cached.analyze({ fen: fenNumbered(2) })).cache_hit).toBe(false);
  });

  it('never grows past its bound', async () => {
    const cached = cachingEngine(countingEngine(), { maxEntries: 4 });

    for (let n = 0; n < 20; n += 1) {
      await cached.analyze({ fen: fenNumbered(n) });
    }

    expect(cached.size()).toBe(4);
  });
});

describe('a Candidate Move caches independently of the main search', () => {
  it('makes a repeated "was my move good?" free on both halves', async () => {
    const engine = countingEngine();
    const cached = cachingEngine(engine);

    const first = await evaluatePosition(cached, { fen: START_FEN, candidate: 'e4' });
    // Two searches: the position, and the position after the Candidate.
    expect(engine.calls).toHaveLength(2);
    expect(first.evidence.cache_hit).toBe(false);
    expect(first.candidate?.cache_hit).toBe(false);

    const second = await evaluatePosition(cached, { fen: START_FEN, candidate: 'e4' });

    expect(engine.calls).toHaveLength(2);
    expect(second.evidence.cache_hit).toBe(true);
    expect(second.candidate?.cache_hit).toBe(true);
  });

  it('serves the main search from cache while the Candidate is still a miss', async () => {
    const engine = countingEngine();
    const cached = cachingEngine(engine);

    await evaluatePosition(cached, { fen: START_FEN });
    const withCandidate = await evaluatePosition(cached, { fen: START_FEN, candidate: 'e4' });

    // The bare position was already searched; only the Candidate's board is new.
    expect(engine.calls).toHaveLength(2);
    expect(withCandidate.evidence.cache_hit).toBe(true);
    expect(withCandidate.candidate?.cache_hit).toBe(false);
  });
});

describe('identity is asked for once, not once per search', () => {
  it('memoizes the identity across searches', async () => {
    const engine = countingEngine();
    let identityCalls = 0;
    const counted: EngineClient = {
      engineIdentity: async () => {
        identityCalls += 1;
        return engine.engineIdentity();
      },
      analyze: (request) => engine.analyze(request),
    };

    const cached = cachingEngine(counted);
    await cached.analyze({ fen: START_FEN });
    await cached.analyze({ fen: AFTER_E4 });

    expect(identityCalls).toBe(1);
  });

  it('does not poison the cache when the identity lookup fails', async () => {
    // An identity that could not be read is not a key. Searching uncached is the correct
    // degradation: serving results under a guessed identity is the provenance failure the
    // key exists to prevent.
    const engine = countingEngine();
    const flaky: EngineClient = {
      engineIdentity: async () => {
        throw new Error('engine is warming up');
      },
      analyze: (request) => engine.analyze(request),
    };

    const cached = cachingEngine(flaky);
    await cached.analyze({ fen: START_FEN });
    const second = await cached.analyze({ fen: START_FEN });

    expect(engine.calls).toHaveLength(2);
    expect(second.cache_hit).toBe(false);
  });
});
