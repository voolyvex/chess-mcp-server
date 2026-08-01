import type {
  AnalyzeRequest,
  EngineClient,
  EngineIdentity,
  EngineLine,
  EngineResult,
} from './engine-client.js';
import type { WdlTriple } from './raw-score.js';

/** Where the engine container answers. */
export const DEFAULT_ENGINE_URL = 'http://localhost:8090';

/** The bridge's wire format. Its score fields are Raw Scores under different names. */
interface BridgeLine {
  depth: number;
  multipv_rank: number;
  score_cp: number | null;
  score_mate: number | null;
  wdl: WdlTriple | null;
  pv: string[];
}

interface BridgeResult {
  engine: EngineIdentity;
  lines: BridgeLine[];
  depth_reached: number;
  nodes: number | null;
  nps: number | null;
  time_ms: number | null;
}

/**
 * The engine container, as an `EngineClient`.
 *
 * The bridge names its score fields `score_cp` / `score_mate` / `wdl`. Those are Raw
 * Scores — side-to-move relative — and they are renamed here, at the parse boundary, to
 * say so. This rename is the one place the distinction could be lost silently, which is
 * why it happens once and nowhere else.
 */
export function httpEngineClient(baseUrl: string = DEFAULT_ENGINE_URL): EngineClient {
  return {
    /**
     * The bridge serves identity from `/id` rather than folding it into `/health`,
     * because it is part of the cache key and a cache that has to parse a health payload
     * to find its key will eventually stop doing so. It 503s while the engine is warming
     * up, which is a refusal to answer, not an identity — so it throws.
     */
    async engineIdentity(): Promise<EngineIdentity> {
      const response = await reachable(baseUrl, () => fetch(`${baseUrl}/id`));
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`engine identity unavailable, ${response.status}: ${detail}`);
      }
      const body = (await response.json()) as EngineIdentity;
      return { name: body.name, version: body.version, build: body.build };
    },

    async analyze(request: AnalyzeRequest): Promise<EngineResult> {
      const response = await reachable(baseUrl, () =>
        fetch(`${baseUrl}/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            fen: request.fen,
            ...(request.movetimeMs === undefined ? {} : { movetimeMs: request.movetimeMs }),
            ...(request.multiPv === undefined ? {} : { multiPv: request.multiPv }),
          }),
        }),
      );

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`engine returned ${response.status}: ${detail}`);
      }

      const body = (await response.json()) as BridgeResult;

      return {
        engine: body.engine,
        lines: body.lines.map(toRawScoreLine),
        depth_reached: body.depth_reached,
        nodes: body.nodes,
        nps: body.nps,
        time_ms: body.time_ms,
      };
    },
  };
}

/**
 * Names the engine that could not be reached.
 *
 * A `fetch` that never gets a response rejects with a bare `TypeError: fetch failed`,
 * naming neither the host it tried nor the reason. That message reaches the caller as the
 * tool's whole error, and it is the first thing anyone sees who starts the server without
 * starting the engine — the most likely failure on a fresh clone. Every other error here
 * says what went wrong and what to do; this one has to as well.
 *
 * Only transport failures are wrapped. An engine that answers — including a 503 while it
 * warms up — is reachable, and its status carries more than this wrapper could add.
 */
async function reachable(baseUrl: string, send: () => Promise<Response>): Promise<Response> {
  try {
    return await send();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `engine unreachable at ${baseUrl} (${cause}). Start it with \`docker compose up -d engine\`, ` +
        `or set ENGINE_URL if it is running elsewhere.`,
    );
  }
}

/** The rename that keeps "side-to-move relative" visible in the type system. */
function toRawScoreLine(line: BridgeLine): EngineLine {
  return {
    depth: line.depth,
    multipv_rank: line.multipv_rank,
    raw_score_cp: line.score_cp,
    raw_score_mate: line.score_mate,
    raw_wdl: line.wdl,
    pv: line.pv,
  };
}
