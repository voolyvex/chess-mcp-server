import { Chess } from 'chess.js';
import type { EngineClient, EngineResult } from './engine-client.js';
import { toEvaluation, type Evaluation } from './evaluation.js';
import type { SideToMove } from './raw-score.js';

/** Which notation the caller wrote the Candidate Move in. Echoed, never guessed at silently. */
export type MoveNotation = 'san' | 'uci';

/** A Candidate Move that could not be played, naming the move and the board. */
export class IllegalCandidateError extends Error {
  constructor(move: string, fen: string) {
    super(
      `illegal candidate move ${JSON.stringify(move)} in position ${fen}. ` +
        `Supply a legal move in SAN (Nf3, Bxh6, O-O) or UCI (g1f3, c1h6, e1g1).`,
    );
    this.name = 'IllegalCandidateError';
  }
}

/**
 * A Candidate Move, searched and scored.
 *
 * Its Evaluation comes from a **different search** than the best move's — the move is
 * played and the resulting position is searched — so under a wall-clock budget the two can
 * finish at different depths. `depth_reached` is the Candidate's own, reported separately
 * rather than folded into the main evidence, because a reader comparing two numbers is
 * entitled to know they were not searched equally hard.
 */
export interface CandidateBlock {
  /** The move in canonical SAN, whichever notation it arrived in. */
  readonly san: string;
  /** The move in UCI long algebraic. */
  readonly uci: string;
  /** Which notation the caller supplied. */
  readonly parsed_as: MoveNotation;
  /** White-relative, on the same convention as the main Evaluation. */
  readonly evaluation: Evaluation;
  /**
   * White-relative centipawn delta against the engine's own choice. Negative means the
   * Candidate is worse than what the engine would play, from White's point of view.
   * Null when either side of the comparison is a mate rather than a centipawn score.
   */
  readonly delta_cp: number | null;
  /** The depth this Candidate's own search reached. */
  readonly depth_reached: number;
  /**
   * Whether this Candidate's search was served from cache. Its own field, separate from
   * the main search's, because the two are independent searches on different boards and
   * either can hit while the other misses.
   */
  readonly cache_hit: boolean;
  /** The board after the Candidate was played — what was actually searched. */
  readonly resolved_fen: string;
}

/**
 * Scores a Candidate Move by **playing it and searching the result**.
 *
 * Not "look for it among the top N engine lines": that method returns nothing precisely
 * when the answer is *yes, badly*, because a bad move is not in the top N. Play-and-search
 * gives an exact Evaluation for any legal move regardless of quality — which is the case
 * the tool exists for.
 *
 * The score comes back side-to-move relative to the position *after* the move, which is
 * the opponent's turn. `toEvaluation` handles that: it is told whose turn it now is, so
 * the sign lands White-relative without a second negation applied by hand here.
 */
export async function evaluateCandidate(
  engine: EngineClient,
  fen: string,
  move: string,
  best: Evaluation | null,
  movetimeMs?: number,
): Promise<CandidateBlock> {
  const board = new Chess(fen);
  const played = playCandidate(board, move, fen);

  const afterFen = board.fen();
  const sideToMoveAfter: SideToMove = board.turn();

  const result = await engine.analyze({
    fen: afterFen,
    ...(movetimeMs === undefined ? {} : { movetimeMs }),
  });

  const line = result.lines.find((candidate) => candidate.multipv_rank === 1) ?? result.lines[0];
  if (line === undefined) {
    // A terminal position after the Candidate — checkmate or stalemate — has no line to
    // score. That is a real outcome, and it is scored from the board rather than invented.
    return terminalCandidate(played, board, afterFen, best, result);
  }

  // The one conversion. The engine spoke from the *opponent's* side, because the Candidate
  // has already been played; naming that side is the whole of the sign correction.
  const evaluation = toEvaluation(line, sideToMoveAfter);

  return {
    san: played.san,
    uci: played.uci,
    parsed_as: played.parsed_as,
    evaluation,
    delta_cp: delta(evaluation, best),
    depth_reached: result.depth_reached,
    cache_hit: result.cache_hit ?? false,
    resolved_fen: afterFen,
  };
}

interface PlayedMove {
  readonly san: string;
  readonly uci: string;
  readonly parsed_as: MoveNotation;
}

/**
 * Plays the Candidate, accepting SAN or UCI.
 *
 * A model will produce either, and failing on `Bxh6` where `c1h6` works is a frequent and
 * avoidable error. chess.js accepts both through `move()`, so the notation is identified by
 * shape rather than by trying one and falling back — the echo must say what the caller
 * actually wrote, not which attempt happened to succeed.
 */
function playCandidate(board: Chess, move: string, fen: string): PlayedMove {
  const token = move.trim();
  if (token === '') throw new IllegalCandidateError(move, fen);

  const parsedAs: MoveNotation = looksLikeUci(token) ? 'uci' : 'san';

  try {
    const played = board.move(token);
    return { san: played.san, uci: `${played.from}${played.to}${played.promotion ?? ''}`, parsed_as: parsedAs };
  } catch {
    throw new IllegalCandidateError(token, fen);
  }
}

/** UCI long algebraic: two squares and an optional promotion piece, e.g. `g1f3`, `e7e8q`. */
function looksLikeUci(token: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(token);
}

/**
 * The Candidate's cost, in White-relative centipawns.
 *
 * Computed between two **Evaluations**, never between an Evaluation and a Raw Score: the
 * two are different quantities, and subtracting one from the other yields a number that
 * looks like a delta and is worth nothing. A mate on either side has no centipawn
 * difference, so the delta is null rather than a fabricated large number.
 */
function delta(candidate: Evaluation, best: Evaluation | null): number | null {
  if (best === null) return null;
  if (candidate.evaluation_cp === null || best.evaluation_cp === null) return null;
  return candidate.evaluation_cp - best.evaluation_cp;
}

/**
 * A Candidate that ends the game. The engine returns no line for a terminal board, so the
 * result is read off the position: mate is a mate distance, anything else is a draw at 0.
 */
function terminalCandidate(
  played: PlayedMove,
  board: Chess,
  afterFen: string,
  best: Evaluation | null,
  result: EngineResult,
): CandidateBlock {
  const sideToMove: SideToMove = board.turn();

  // The side to move is the one checkmated, so the mate favours whoever just moved. Mate
  // is already on the board, so the distance is 0 — and 0 carries no sign in JSON, which
  // is why the winner is read from `wdl_white` rather than from the sign of `mate_in`.
  const evaluation: Evaluation = board.isCheckmate()
    ? {
        evaluation_cp: null,
        mate_in: 0,
        wdl_white: sideToMove === 'w' ? [0, 0, 1000] : [1000, 0, 0],
        raw_score_cp: null,
        // The engine's convention for a side that has been mated: a certain loss.
        raw_wdl: [0, 0, 1000],
        side_to_move: sideToMove,
      }
    : {
        // Stalemate and the other drawn terminals are dead level, not unscored.
        evaluation_cp: 0,
        mate_in: null,
        wdl_white: [0, 1000, 0],
        raw_score_cp: 0,
        raw_wdl: [0, 1000, 0],
        side_to_move: sideToMove,
      };

  return {
    san: played.san,
    uci: played.uci,
    parsed_as: played.parsed_as,
    evaluation,
    delta_cp: delta(evaluation, best),
    depth_reached: result.depth_reached,
    cache_hit: result.cache_hit ?? false,
    resolved_fen: afterFen,
  };
}
