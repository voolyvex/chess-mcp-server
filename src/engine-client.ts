import type { WdlTriple } from './raw-score.js';

/**
 * One line of a search, in the engine's own terms.
 *
 * Every score on it is a **Raw Score** — side-to-move relative, as UCI reports it. The
 * field names say so, so a caller cannot read one as White-relative by accident. The
 * bridge's wire format uses `score_cp`/`score_mate`/`wdl`; those are renamed at the
 * parse boundary, which is the one place the distinction could be lost.
 */
export interface EngineLine {
  /** The depth this line was produced at. */
  readonly depth: number;
  /** 1-based MultiPV rank; 1 is the engine's preferred line. */
  readonly multipv_rank: number;
  /** Centipawns, side-to-move relative. Null when the engine reported a forced mate. */
  readonly raw_score_cp: number | null;
  /** Mate distance in moves, side-to-move relative. */
  readonly raw_score_mate: number | null;
  /** `[win, draw, loss]` in per mille, side-to-move relative. */
  readonly raw_wdl: WdlTriple | null;
  /** The principal variation, in UCI long algebraic. */
  readonly pv: readonly string[];
}

/** Who searched. Part of the cache key downstream, so it is never optional. */
export interface EngineIdentity {
  readonly name: string | null;
  readonly version: string | null;
  readonly build: string;
}

/** One completed search. */
export interface EngineResult {
  readonly engine: EngineIdentity;
  readonly lines: readonly EngineLine[];
  /** The depth actually **reached** — never a depth that was requested. */
  readonly depth_reached: number;
  readonly nodes: number | null;
  readonly nps: number | null;
  readonly time_ms: number | null;
  /**
   * Whether this result was served from a stored search. Optional on the seam because an
   * unwrapped client has no cache to hit and would only ever set it `false`; the caching
   * decorator always sets it, and a missing value reads as a fresh search.
   */
  readonly cache_hit?: boolean;
}

/**
 * A search result that knows whether it was served from cache.
 *
 * `cache_hit` is on the result rather than alongside it because it describes *this*
 * result's provenance: on a hit, every other field belongs to the earlier search, and a
 * reader has to be able to tell.
 */
export interface CachedEngineResult extends EngineResult {
  readonly cache_hit: boolean;
}

/** What a search asks for. Wall-clock is the budget; there is no depth parameter. */
export interface AnalyzeRequest {
  readonly fen: string;
  readonly movetimeMs?: number;
  readonly multiPv?: number;
}

/**
 * The seam between the tool and whatever is doing the searching.
 *
 * Two methods, and the second one is not a convenience. A cache keyed on engine identity
 * has to know the identity *before* it searches, or it cannot look anything up — so the
 * seam must be able to answer "who are you?" without spending a search. Every client
 * implements it, rather than it being optional: a client that could decline would be
 * cached under a guessed identity, which is the failure the key exists to prevent.
 */
export interface EngineClient {
  analyze(request: AnalyzeRequest): Promise<EngineResult>;
  /** Who is searching. Fixed for the life of a client; callers may memoize it. */
  engineIdentity(): Promise<EngineIdentity>;
}
