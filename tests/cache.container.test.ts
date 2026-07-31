import { describe, expect, it } from 'vitest';
import { cachingEngine } from '../src/cache.js';
import { evaluatePosition } from '../src/evaluate-position.js';
import { httpEngineClient } from '../src/http-engine-client.js';
import { ENGINE_URL, engineUnreachable } from './helpers/engine-availability.js';

/**
 * Tier 2, container path — the cache against a real Stockfish over real HTTP.
 *
 * Invariants only: nothing here asserts an evaluation. What it proves is that the cache's
 * provenance claims survive contact with an engine that genuinely searches — that a
 * served result reports the depth *that* search reached, and that identity comes off the
 * bridge's own `/id` rather than out of a fixture.
 *
 * Skipped, not failed, when the container is not up — see the helper.
 */

/** A quiet middlegame: deep enough that a bigger budget reliably buys more depth. */
const MIDDLEGAME_FEN = 'r1bq1rk1/pp2ppbp/2np1np1/8/2BNP3/2N1B3/PPP2PPP/R2Q1RK1 b - - 3 14';

describe.skipIf(await engineUnreachable())('tier 2, cache against the container', () => {
  it('takes its identity from the bridge, so the key is the engine that actually answered', async () => {
    const engine = httpEngineClient(ENGINE_URL);
    const identity = await engine.engineIdentity();

    // Not asserting *which* Stockfish: asserting the key has something real to key on.
    expect(identity.name).toBeTruthy();
    expect(identity.version).toBeTruthy();
    expect(identity.build).toBeTruthy();

    const fromAnalysis = await engine.analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 200 });
    // The identity in the key and the identity shipped as Evidence must be the same
    // engine, or the cache files results under a name the response does not carry.
    expect(fromAnalysis.engine).toEqual(identity);
  });

  it('serves a cheaper request from a deeper search, and reports that search’s depth', async () => {
    const cached = cachingEngine(httpEngineClient(ENGINE_URL));

    const deep = await cached.analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 1_500 });
    const cheap = await cached.analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 100 });

    expect(deep.cache_hit).toBe(false);
    expect(cheap.cache_hit).toBe(true);

    // The whole point: a 100ms budget could not have reached this depth. The reported
    // depth is the one the search that actually happened reached, not one implied by the
    // budget of the request being served.
    expect(cheap.depth_reached).toBe(deep.depth_reached);
    expect(cheap.time_ms).toBe(deep.time_ms);
  });

  it('searches again when the budget outgrows what is stored', async () => {
    const cached = cachingEngine(httpEngineClient(ENGINE_URL));

    const cheap = await cached.analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 100 });
    const deep = await cached.analyze({ fen: MIDDLEGAME_FEN, movetimeMs: 1_500 });

    expect(deep.cache_hit).toBe(false);
    // A real engine given 15× the budget goes deeper. Asserting the direction, not a number.
    expect(deep.depth_reached).toBeGreaterThan(cheap.depth_reached);
  });

  it('makes a repeated "was my move good?" free on both searches', async () => {
    const cached = cachingEngine(httpEngineClient(ENGINE_URL));
    const input = { fen: MIDDLEGAME_FEN, candidate: 'Nxd4', movetimeMs: 300 };

    const first = await evaluatePosition(cached, input);
    expect(first.evidence.cache_hit).toBe(false);
    expect(first.candidate?.cache_hit).toBe(false);

    const second = await evaluatePosition(cached, input);
    expect(second.evidence.cache_hit).toBe(true);
    expect(second.candidate?.cache_hit).toBe(true);

    // Served from the same searches, so the numbers are identical rather than merely close.
    expect(second.evaluation).toEqual(first.evaluation);
    expect(second.candidate?.evaluation).toEqual(first.candidate?.evaluation);
    expect(second.evidence.depth_reached).toBe(first.evidence.depth_reached);
  });
});
