import { describe, expect, it } from 'vitest';
import { httpEngineClient } from '../src/http-engine-client.js';

/**
 * Tier 1: what the caller is told when the engine is not running.
 *
 * This is the first failure on a fresh clone — `npm start` without
 * `docker compose up -d engine`. `fetch` rejects with a bare "fetch failed", naming
 * neither the host nor the fix, and that string is what reaches the assistant as the
 * tool's entire error. These tests pin the replacement: the URL that was tried, and the
 * command that fixes it.
 *
 * Port 1 is used as the unreachable address because nothing binds it — the connection is
 * refused immediately, so these stay fast and need no engine.
 */
const NOWHERE = 'http://127.0.0.1:1';

/** The standard array. Any legal FEN does; the request never reaches an engine. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('an unreachable engine says so, and says what to do', () => {
  it('names the URL it tried when a search cannot reach the engine', async () => {
    const engine = httpEngineClient(NOWHERE);
    await expect(engine.analyze({ fen: START_FEN })).rejects.toThrow(NOWHERE);
  });

  it('names the command that starts the engine', async () => {
    const engine = httpEngineClient(NOWHERE);
    await expect(engine.analyze({ fen: START_FEN })).rejects.toThrow(
      /docker compose up -d engine/,
    );
  });

  it('points at ENGINE_URL for an engine running elsewhere', async () => {
    const engine = httpEngineClient(NOWHERE);
    await expect(engine.analyze({ fen: START_FEN })).rejects.toThrow(/ENGINE_URL/);
  });

  it('never surfaces the bare fetch failure as the whole message', async () => {
    const engine = httpEngineClient(NOWHERE);
    const error = await engine.analyze({ fen: START_FEN }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toBe('fetch failed');
  });

  it('keeps the underlying cause, so a non-refusal failure stays diagnosable', async () => {
    // The wrapper adds context; it must not discard what fetch reported. A DNS failure
    // and a refused connection both arrive here and have to stay tellable apart.
    const engine = httpEngineClient(NOWHERE);
    const error = await engine.analyze({ fen: START_FEN }).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/fetch failed|ECONNREFUSED/);
  });

  it('reports identity lookups the same way, not only searches', async () => {
    // Identity is fetched before the first search — on a cold start it is the call that
    // fails first, so it cannot report the failure differently.
    const engine = httpEngineClient(NOWHERE);
    await expect(engine.engineIdentity()).rejects.toThrow(NOWHERE);
  });
});
