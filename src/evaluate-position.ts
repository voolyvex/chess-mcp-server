import { Chess } from 'chess.js';
import { resolveAddress } from './address.js';
import { evaluateCandidate, type CandidateBlock } from './candidate-move.js';
import type { EngineClient, EngineLine } from './engine-client.js';
import { toEvaluation, type Evaluation } from './evaluation.js';
import { parseMoveSequence, START_FEN } from './move-sequence.js';
import type { SideToMove } from './raw-score.js';

export { START_FEN };

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
}

/** The engine's preferred line, in both notations a reader might want. */
export interface BestBlock {
  readonly san: string;
  readonly uci: string;
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
}

export interface EvaluatePositionResult {
  readonly position: PositionBlock;
  readonly evaluation: Evaluation | null;
  readonly best: BestBlock | null;
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
    },
  };
}

/**
 * Renders the principal variation in SAN alongside the UCI the engine emitted.
 *
 * SAN is only meaningful against the board the move is played on, so the PV is replayed
 * move by move. A move the board rejects ends the SAN rendering rather than throwing:
 * a truncated PV is still evidence, while a failed request is not.
 */
function describeBest(best: EngineLine, fen: string): BestBlock {
  const board = new Chess(fen);
  const pvSan: string[] = [];

  for (const uci of best.pv) {
    try {
      pvSan.push(board.move(uci).san);
    } catch {
      break;
    }
  }

  return {
    san: pvSan[0] ?? '',
    uci: best.pv[0] ?? '',
    pv_san: pvSan,
    pv_uci: [...best.pv],
  };
}
