import { Chess } from 'chess.js';
import { resolveAddress, type LegalMove } from './address.js';
import { evaluateCandidate, type CandidateBlock } from './candidate-move.js';
import type { EngineClient, EngineLine } from './engine-client.js';
import { toEvaluation, type Evaluation } from './evaluation.js';
import { parseMoveSequence, START_FEN } from './move-sequence.js';
import type { SideToMove } from './raw-score.js';

export { START_FEN };

/**
 * The most Engine Lines a search will rank. Five is where the widening stops paying: the
 * depth cost grows with every line while ranks that deep are searched in a window too
 * narrow for their scores to mean much (ADR-0001).
 */
export const MAX_MULTIPV = 5;

/**
 * The longest search budget a caller may ask for, in milliseconds.
 *
 * Not a tuning knob — a bound on what one request can spend. Without it `movetimeMs` is
 * unbounded CPU: the engine runs four threads, and a single caller can occupy all of them
 * for as long as they name. Locality hid that while the only clients were same-machine;
 * a public URL removes the protection (`docs/beta-readiness.md` §4).
 *
 * 30_000 matches the ceiling the engine bridge already enforced via `STOCKFISH_MAX_MOVETIME`,
 * so this narrows *where* the bound is applied rather than changing what it is. A request
 * asking for more is refused here, before a search is dispatched — the bridge clamped
 * silently, which returns a shallower search than the one asked for without saying so.
 *
 * A candidate search is a second search on the same budget, so one request can legitimately
 * spend twice this. The bound is per search, not per request.
 */
export const MAX_MOVETIME_MS = 30_000;

export interface EvaluatePositionInput {
  /** Start Position. Defaults to the standard array. */
  readonly fen?: string;
  /**
   * A Move Sequence in any of its three forms — a bare move list, a numbered move list, or
   * a full PGN. One field, because all three are the same thing played from a Start
   * Position, and one parse cannot disagree with itself the way three could.
   */
  readonly moves?: string;
  /** Which position of the sequence to evaluate: half-moves applied to the Start Position. */
  readonly ply?: number;
  /**
   * Which position of the sequence to evaluate, named by the move that was about to be
   * played. Resolves to the position *before* that move, and needs a `side`.
   */
  readonly moveNumber?: number;
  /** Which half of `moveNumber`. Needs a `moveNumber`. */
  readonly side?: SideToMove;
  /** A move to score on its own terms, in SAN or UCI. */
  readonly candidate?: string;
  /** Wall-clock budget for the search. Depth is the outcome, never an input. */
  readonly movetimeMs?: number;
  /**
   * How many Engine Lines to rank, 1-5. Above 1 the response carries `engine_lines`.
   *
   * Not free: a ranked search spends its budget widening instead of deepening, so it
   * reaches a shallower depth than a MultiPV 1 search of the same position on the same
   * clock — measured at 2-5 ply on this engine. See ADR-0001.
   */
  readonly multipv?: number;
}

/** Which board was evaluated, and how it was addressed. */
export interface PositionBlock {
  readonly start_fen: string;
  readonly resolved_fen: string;
  /** Half-moves applied to the Start Position. A bare FEN is ply 0. */
  readonly ply: number;
  /** The true game move number, taken from the FEN rather than counted. */
  readonly move_number: number;
  readonly side_to_move: SideToMove;
  /**
   * Every legal move from this Position, in SAN and UCI. Ground truth to check a move
   * against before asserting it in prose — an LLM's own board simulation is a documented
   * failure mode, and this is cheaper to consult than a wrong claim is to retract.
   */
  readonly legal_moves: readonly LegalMove[];
}

/** The engine's preferred line, in both notations a reader might want. */
export interface BestBlock {
  readonly san: string;
  readonly uci: string;
  readonly pv_san: readonly string[];
  readonly pv_uci: readonly string[];
}

/**
 * One ranked variation from a multi-variation search.
 *
 * Carries its own Evaluation and its own depth, because a ranked search does not produce
 * one number per position — it produces a number per line, and ranks below 1 are searched
 * in a narrowed window. An Engine Line's score is therefore **not** interchangeable with a
 * Candidate Move's: a Candidate is searched alone, a Line is searched against its rivals.
 * That is why the two never share a field, and why quoting a Line's number as a Candidate's
 * would misreport what happened.
 */
export interface EngineLineBlock {
  /** 1-based rank. 1 is the engine's preferred line and matches `best`. */
  readonly rank: number;
  readonly san: string;
  readonly uci: string;
  readonly evaluation: Evaluation;
  /** The depth *this line* reached, which ranks below 1 need not share. */
  readonly depth: number;
  readonly pv_san: readonly string[];
  readonly pv_uci: readonly string[];
}

/**
 * The provenance that separates an engine result from a plausible guess. Every field is
 * something only a search that happened could produce.
 */
export interface EvidenceBlock {
  readonly engine: string | null;
  readonly engine_version: string | null;
  readonly build: string;
  /** The depth **reached**. There is no `depth_requested` — wall-clock is the budget. */
  readonly depth_reached: number;
  readonly nodes: number | null;
  readonly nps: number | null;
  readonly time_ms: number | null;
  /**
   * Whether these numbers came from a stored search rather than a fresh one. On a hit
   * every other field describes the earlier search — including `depth_reached`, which is
   * the depth that search reached and not one this request's budget implies.
   */
  readonly cache_hit: boolean;
  /** The board the numbers are about, so a reader can re-run the search themselves. */
  readonly resolved_fen: string;
  /**
   * How many lines the search ranked. Always present, 1 when unasked.
   *
   * Provenance, not decoration: a rank-1 line from a MultiPV 3 search and a MultiPV 1
   * search of the same position are different searches reaching different depths, and
   * comparing their numbers without knowing this reads noise as change (ADR-0001).
   */
  readonly multipv: number;
}

export interface EvaluatePositionResult {
  readonly position: PositionBlock;
  readonly evaluation: Evaluation | null;
  readonly best: BestBlock | null;
  /**
   * The ranked Engine Lines, present only when `multipv > 1` was asked for. Rank 1 is the
   * same line as `best`; `best` is populated from it either way, so a caller that only
   * wants the engine's preference never has to read this array.
   */
  readonly engine_lines: readonly EngineLineBlock[] | null;
  /** Present only when a Candidate Move was supplied. */
  readonly candidate: CandidateBlock | null;
  readonly evidence: EvidenceBlock;
}

/**
 * Evaluates one Position and ships the Evidence that produced it.
 *
 * The engine speaks Raw Scores; conversion to a White-relative Evaluation happens exactly
 * once here, at the parse boundary, via `toEvaluation`.
 */
export async function evaluatePosition(
  engine: EngineClient,
  input: EvaluatePositionInput,
): Promise<EvaluatePositionResult> {
  const multipv = input.multipv ?? 1;
  // Clamping would answer a different question than the one asked, silently. The engine
  // caps usable lines at the position's legal move count anyway, so a large request is
  // not merely expensive, it is unanswerable as stated.
  if (!Number.isInteger(multipv) || multipv < 1 || multipv > MAX_MULTIPV) {
    throw new Error(
      `multipv must be an integer from 1 to ${MAX_MULTIPV}, got ${String(input.multipv)}`,
    );
  }

  // Refused rather than clamped, for the same reason as `multipv` above: a silently
  // shortened search answers a different question than the one asked, and the depth it
  // reaches would be read as the depth the requested budget bought.
  if (input.movetimeMs !== undefined) {
    if (
      !Number.isInteger(input.movetimeMs) ||
      input.movetimeMs < 1 ||
      input.movetimeMs > MAX_MOVETIME_MS
    ) {
      throw new Error(
        `movetimeMs must be an integer from 1 to ${MAX_MOVETIME_MS}, got ${String(input.movetimeMs)}`,
      );
    }
  }

  const sequence = parseMoveSequence(input.moves, input.fen);

  // With no address supplied, the position evaluated is the **final** position of the
  // sequence — which degenerates correctly to "evaluate this FEN" when there is no
  // sequence at all, because then the final position *is* the Start Position.
  const position = resolveAddress(sequence, {
    ...(input.ply === undefined ? {} : { ply: input.ply }),
    ...(input.moveNumber === undefined ? {} : { move_number: input.moveNumber }),
    ...(input.side === undefined ? {} : { side: input.side }),
  });
  const resolvedFen = position.resolved_fen;
  const sideToMove = position.side_to_move;

  const result = await engine.analyze({
    fen: resolvedFen,
    ...(input.movetimeMs === undefined ? {} : { movetimeMs: input.movetimeMs }),
    // Sent whenever asked for, including 1. The cache keys on it, so an explicit 1 and an
    // absent value must not land on different keys for the same search.
    ...(multipv === 1 ? {} : { multiPv: multipv }),
  });

  const best = result.lines.find((candidate) => candidate.multipv_rank === 1) ?? result.lines[0];
  const evaluation = best === undefined ? null : toEvaluation(best, sideToMove);

  // A different search from the best move's, so its depth is its own. Awaited after the
  // main search rather than alongside it: they share one engine, and overlapping searches
  // on a single UCI process interleave.
  const candidate =
    input.candidate === undefined
      ? null
      : await evaluateCandidate(
          engine,
          resolvedFen,
          input.candidate,
          evaluation,
          input.movetimeMs,
        );

  return {
    // Every way of naming the board, echoed back: ply and move number are each derived
    // from it rather than from the request, so the response says where the search
    // actually landed and not what was asked for.
    position: { start_fen: sequence.start_fen, ...position },
    // The one conversion. Raw Score in, Evaluation out, both shipped.
    evaluation,
    best: best === undefined ? null : describeBest(best, resolvedFen),
    // Only when asked. At MultiPV 1 the array would restate `best` with no added
    // information, and an array of one invites reading a solo search as a ranking.
    engine_lines: multipv === 1 ? null : describeEngineLines(result.lines, resolvedFen, sideToMove),
    candidate,
    evidence: {
      engine: result.engine.name,
      engine_version: result.engine.version,
      build: result.engine.build,
      depth_reached: result.depth_reached,
      nodes: result.nodes,
      nps: result.nps,
      time_ms: result.time_ms,
      cache_hit: result.cache_hit ?? false,
      resolved_fen: resolvedFen,
      multipv,
    },
  };
}

/** The engine's preferred line, in both notations a reader might want. */
function describeBest(best: EngineLine, fen: string): BestBlock {
  const pvSan = renderPvSan(best.pv, fen);

  return {
    san: pvSan[0] ?? '',
    uci: best.pv[0] ?? '',
    pv_san: pvSan,
    pv_uci: [...best.pv],
  };
}

/**
 * Renders the ranked lines, each with its own Evaluation and its own depth.
 *
 * Sorted by rank rather than trusted to arrive ordered, because rank is the field a reader
 * indexes by and a mis-ordered array would put the engine's second choice first. Lines the
 * engine emitted with an empty PV are dropped: a line with no move is not a line, and
 * shipping one would be a ranked slot with nothing in it.
 */
function describeEngineLines(
  lines: readonly EngineLine[],
  fen: string,
  sideToMove: SideToMove,
): readonly EngineLineBlock[] {
  return [...lines]
    .filter((line) => line.pv.length > 0)
    .sort((a, b) => a.multipv_rank - b.multipv_rank)
    .map((line) => {
      const pvSan = renderPvSan(line.pv, fen);
      return {
        rank: line.multipv_rank,
        san: pvSan[0] ?? '',
        uci: line.pv[0] ?? '',
        // The same one-place conversion `evaluation` gets: Raw Score in, White-relative out.
        evaluation: toEvaluation(line, sideToMove),
        depth: line.depth,
        pv_san: pvSan,
        pv_uci: [...line.pv],
      };
    });
}

/**
 * Replays a UCI principal variation to render it in SAN.
 *
 * SAN is only meaningful against the board the move is played on, so the PV is replayed
 * move by move. A move the board rejects ends the rendering rather than throwing: a
 * truncated PV is still evidence, while a failed request is not.
 */
function renderPvSan(pv: readonly string[], fen: string): string[] {
  const board = new Chess(fen);
  const pvSan: string[] = [];

  for (const uci of pv) {
    try {
      pvSan.push(board.move(uci).san);
    } catch {
      break;
    }
  }

  return pvSan;
}
