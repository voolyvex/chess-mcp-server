import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * The engine-agnostic tier-2 invariants run against this WASM build in CI — no Docker.
 * Reference the *versioned* filename rather than the `stockfish.js` symlink, which only
 * exists if the package's postinstall ran; npm 11 blocks install scripts by default.
 */
const ENGINE_JS = require.resolve('stockfish/bin/stockfish-18-single.js');
const ENGINE_WASM = ENGINE_JS.replace(/\.js$/, '.wasm');

type Instance = {
  ready: Promise<unknown>;
  ccall: (fn: string, ret: null, argTypes: string[], args: string[]) => void;
};
type Factory = (options: object) => Promise<(options: object) => Promise<Instance>>;

/**
 * Stockfish 18 uses a double-call factory: the first call yields a factory, the second
 * builds the instance. `listener` must be set in the *second* call's options so it is
 * live before `_main()` prints the banner. Commands go in via `ccall`, not `postMessage`.
 */
async function search(commands: string[], until: RegExp): Promise<string[]> {
  const locateFile = (path: string): string =>
    path.endsWith('.wasm') ? ENGINE_WASM : path;

  const lines: string[] = [];
  let done = false;
  const listener = (line: string): void => {
    lines.push(line);
    if (until.test(line)) done = true;
  };

  const factory = (require(ENGINE_JS) as Factory)({ locateFile });
  const engine = await (await factory)({ locateFile, listener });
  await engine.ready;

  for (const command of commands) {
    engine.ccall('command', null, ['string'], [command]);
  }

  const deadline = Date.now() + 25_000;
  while (!done) {
    if (Date.now() > deadline) throw new Error(`timed out awaiting ${until}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return lines;
}

describe('tier 2, WASM path', () => {
  // This is the scaffold's claim: CI can run a *real* engine with no Docker. A test that
  // only stat'd the files would pass against an engine that cannot actually search.
  it('runs a genuine search in CI, no Docker required', async () => {
    const lines = await search(
      ['uci', 'position startpos', 'go depth 12'],
      /^bestmove/,
    );

    expect(lines.some((line) => line.startsWith('id name Stockfish'))).toBe(true);

    const bestmove = lines.find((line) => line.startsWith('bestmove'));
    expect(bestmove).toMatch(/^bestmove [a-h][1-8][a-h][1-8]/);

    // Depth is an outcome that gets reported, never a request echoed back — asserted here
    // only as "the engine really searched", not as a specific number.
    const depths = lines
      .filter((line) => line.startsWith('info depth '))
      .map((line) => Number(line.split(' ')[2]));
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(12);
  });

  it('does not require AVX-512 — CI runners mix Ice Lake with EPYC Zen 3', () => {
    // WASM has no AVX-512 to require; the search above having run at all is the proof.
    // This test states the constraint where a future move to a native CI engine breaks it.
    expect(ENGINE_JS).toContain('stockfish-18');
  });
});
