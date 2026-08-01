import { createRequire } from 'node:module';
import type {
  AnalyzeRequest,
  EngineClient,
  EngineIdentity,
  EngineLine,
  EngineResult,
} from '../../src/engine-client.js';
import type { WdlTriple } from '../../src/raw-score.js';

const require = createRequire(import.meta.url);

/**
 * A real Stockfish, as an `EngineClient`, over the WASM build.
 *
 * This is what makes the tier-2 sign invariants run on **every push**: no Docker, and
 * measured in seconds. It parses the same UCI `info` lines the container's bridge parses,
 * so the Raw Scores it yields are the engine's own — nothing here can launder the sign
 * question the way a mock would.
 *
 * Reference the *versioned* filename rather than the `stockfish.js` symlink, which only
 * exists if the package's postinstall ran; npm 11 blocks install scripts by default.
 */
const ENGINE_JS = require.resolve('stockfish/bin/stockfish-18-single.js');
const ENGINE_WASM = ENGINE_JS.replace(/\.js$/, '.wasm');

type Instance = {
  ready: Promise<unknown>;
  ccall: (fn: string, ret: null, argTypes: string[], args: string[]) => void;
};
/**
 * The entry point resolves to a factory on the *first* call and to an already-built
 * instance on later ones — the module caches its own state, so `require` returning the
 * same function does not mean calling it does the same thing twice.
 */
type Entry = (options: object) => Promise<Instance | ((options: object) => Promise<Instance>)>;

/** Wall-clock is the budget here too — `go movetime`, exactly as the container does it. */
const DEFAULT_MOVETIME_MS = 1_000;

export function wasmEngine(): EngineClient {
  return {
    /**
     * The handshake on its own, with no search behind it — which is what a cache needs,
     * since it must know who is answering before it can look anything up.
     */
    async engineIdentity(): Promise<EngineIdentity> {
      const output = await run(['uci'], /^uciok/, 20_000);
      return parseIdentity(output);
    },

    async analyze(request: AnalyzeRequest): Promise<EngineResult> {
      const movetimeMs = request.movetimeMs ?? DEFAULT_MOVETIME_MS;
      const multiPv = request.multiPv ?? 1;

      const lines = await run(
        [
          'uci',
          'setoption name UCI_ShowWDL value true',
          `setoption name MultiPV value ${multiPv}`,
          `position fen ${request.fen}`,
          `go movetime ${movetimeMs}`,
        ],
        /^bestmove/,
        movetimeMs + 20_000,
      );

      return parse(lines, multiPv);
    },
  };
}

/**
 * The current search's output sink.
 *
 * The engine instance is built once and reused, so its listener is installed once too and
 * routes here. Rebuilding per search is not an option: the module hands back a *factory*
 * only on the first call and the built instance thereafter, and a listener passed to the
 * cached path is silently ignored.
 */
let sink: ((line: string) => void) | null = null;

let instance: Promise<Instance> | null = null;

function engineInstance(): Promise<Instance> {
  instance ??= (async () => {
    const locateFile = (path: string): string => (path.endsWith('.wasm') ? ENGINE_WASM : path);
    const listener = (line: string): void => sink?.(line);

    const entry = require(ENGINE_JS) as Entry;
    const built = await entry({ locateFile, listener });
    // First call yields a factory; later calls yield the instance itself.
    const engine = typeof built === 'function' ? await built({ locateFile, listener }) : built;

    await engine.ready;
    return engine;
  })();

  return instance;
}

/** Searches are serialized: one engine, one `sink`, so overlapping runs would interleave. */
let inFlight: Promise<unknown> = Promise.resolve();

async function run(commands: string[], until: RegExp, timeoutMs: number): Promise<string[]> {
  const mine = inFlight.then(() => search(commands, until, timeoutMs));
  inFlight = mine.catch(() => undefined);
  return mine;
}

async function search(commands: string[], until: RegExp, timeoutMs: number): Promise<string[]> {
  const engine = await engineInstance();

  const output: string[] = [];
  let done = false;
  sink = (line: string): void => {
    output.push(line);
    if (until.test(line)) done = true;
  };

  try {
    for (const command of commands) {
      engine.ccall('command', null, ['string'], [command]);
    }

    const deadline = Date.now() + timeoutMs;
    while (!done) {
      if (Date.now() > deadline) throw new Error(`timed out awaiting ${until}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return output;
  } finally {
    sink = null;
  }
}

/**
 * Parses UCI output into Raw Scores, mirroring the container bridge: index by depth,
 * then take the deepest iteration that actually completed. A partial iteration is
 * discarded rather than mixed with the one below it.
 */
function parse(output: string[], multiPv: number): EngineResult {
  const identity = parseIdentity(output);
  const byDepth = new Map<number, Map<number, EngineLine>>();
  let nodes: number | null = null;
  let nps: number | null = null;
  let timeMs: number | null = null;

  for (const raw of output) {
    if (!raw.startsWith('info ')) continue;

    nodes = number(raw, /\bnodes (\d+)/) ?? nodes;
    nps = number(raw, /\bnps (\d+)/) ?? nps;
    timeMs = number(raw, /\btime (\d+)/) ?? timeMs;

    if (!raw.includes(' pv ')) continue;
    // A fail-high/fail-low report is not a resolved score for the iteration.
    if (/\b(upperbound|lowerbound)\b/.test(raw)) continue;

    const depth = number(raw, /\bdepth (\d+)/);
    const pv = / pv (.+)$/.exec(raw)?.[1];
    if (depth === null || pv === undefined) continue;

    const rank = number(raw, /\bmultipv (\d+)/) ?? 1;
    const wdl = /\bwdl (\d+) (\d+) (\d+)/.exec(raw);

    const entry: EngineLine = {
      depth,
      multipv_rank: rank,
      raw_score_cp: number(raw, /\bscore cp (-?\d+)/),
      raw_score_mate: number(raw, /\bscore mate (-?\d+)/),
      raw_wdl:
        wdl === null
          ? null
          : ([Number(wdl[1]), Number(wdl[2]), Number(wdl[3])] as WdlTriple),
      pv: pv.trim().split(/\s+/),
    };

    let atDepth = byDepth.get(depth);
    if (atDepth === undefined) {
      atDepth = new Map();
      byDepth.set(depth, atDepth);
    }
    atDepth.set(rank, entry);
  }

  for (const depth of [...byDepth.keys()].sort((a, b) => b - a)) {
    const atDepth = byDepth.get(depth);
    if (atDepth === undefined) continue;
    // A mate cuts the MultiPV count short legitimately — the engine stops reporting
    // further ranks once the position is resolved.
    const complete =
      atDepth.size >= multiPv || [...atDepth.values()].some((l) => l.raw_score_mate !== null);
    if (!complete) continue;

    return {
      engine: identity,
      lines: [...atDepth.values()].sort((a, b) => a.multipv_rank - b.multipv_rank),
      depth_reached: depth,
      nodes,
      nps,
      time_ms: timeMs,
    };
  }

  return { engine: identity, lines: [], depth_reached: 0, nodes, nps, time_ms: timeMs };
}

/**
 * Engine identity, remembered across searches.
 *
 * `id name` is printed once, in reply to the `uci` handshake. The instance is reused, so
 * only the first search sees that line — a later search parsing its own output alone
 * would report a null name and look like an engine that cannot say who it is.
 */
let identity: EngineIdentity | null = null;

function parseIdentity(output: string[]): EngineIdentity {
  const idLine = output.find((line) => line.startsWith('id name '));
  if (idLine === undefined) {
    return identity ?? { name: null, version: null, build: 'wasm' };
  }

  // The WASM build reports `id name Stockfish 18 WASM` — the version is not the trailing
  // token, so a `$`-anchored match finds nothing and reports a versionless engine.
  const full = idLine.slice('id name '.length).trim();
  const match = /^(\S+)\s+([0-9][^\s]*)/.exec(full);

  identity = {
    name: match?.[1] ?? full,
    version: match?.[2] ?? null,
    build: 'wasm',
  };
  return identity;
}

function number(line: string, pattern: RegExp): number | null {
  const match = pattern.exec(line);
  return match?.[1] === undefined ? null : Number(match[1]);
}
