import type { RawScore, SideToMove, WdlTriple } from './raw-score.js';

/**
 * An engine's assessment of a Position, always **White-relative**: positive favours
 * White, negative favours Black, regardless of whose turn it is.
 *
 * The Raw Score the engine reported ships alongside, with the side to move, so a reader
 * can check the conversion rather than trust it.
 */
export interface Evaluation {
  /** Centipawns, White-relative. Null when the engine reported a forced mate. */
  readonly evaluation_cp: number | null;
  /** Mate distance, White-relative: positive means White mates, negative means Black does. */
  readonly mate_in: number | null;
  /** `[win, draw, loss]` in per mille, from **White's** point of view. */
  readonly wdl_white: WdlTriple;
  /** Exactly what the engine said, side-to-move relative. */
  readonly raw_score_cp: number | null;
  /** Exactly what the engine said, side-to-move relative. */
  readonly raw_wdl: WdlTriple;
  /** Which side was to move — the term that decides whether the conversion negates. */
  readonly side_to_move: SideToMove;
}

/**
 * Raised when the engine reported a line without a WDL triple.
 *
 * Distinct from a generic error so a caller can tell "the engine is misconfigured" from
 * "the search failed" — the usual cause is `UCI_ShowWDL` not being set on the engine.
 */
export class MissingWdlError extends Error {
  constructor(sideToMove: SideToMove) {
    super(
      `engine reported no WDL for a ${sideToMove === 'w' ? 'White' : 'Black'}-to-move ` +
        `position; enable UCI_ShowWDL on the engine. An Evaluation without a WDL is not ` +
        `shipped as a silently absent field.`,
    );
    this.name = 'MissingWdlError';
  }
}

/**
 * Converts a Raw Score into an Evaluation. **The only place this conversion happens.**
 *
 * Both quantities ship in the result, so the caller never has to choose between them and
 * a reader can audit the arithmetic. See `.claude/rules/engine-contract.md` for the
 * measurements this implements.
 *
 * Throws when the engine reported no WDL. A distribution is not optional decoration on an
 * Evaluation: a response that quietly omits it is indistinguishable from one where the
 * conversion dropped it, and the field that is missing is exactly the one carrying the
 * trap this type exists to close.
 */
export function toEvaluation(raw: RawScore, sideToMove: SideToMove): Evaluation {
  if (raw.raw_wdl === null) throw new MissingWdlError(sideToMove);

  // The whole conversion, in one term. Black to move means the engine spoke from Black's
  // side, so every White-relative quantity is the mirror of what it said.
  const mirrored = sideToMove === 'b';

  return {
    evaluation_cp: mirrored ? negate(raw.raw_score_cp) : raw.raw_score_cp,
    mate_in: mirrored ? negate(raw.raw_score_mate) : raw.raw_score_mate,
    // WDL is side-to-move relative too, and mirroring it means **swapping win and loss** —
    // negating centipawns alone would leave the distribution describing the wrong player.
    wdl_white: mirrored ? swapWinAndLoss(raw.raw_wdl) : raw.raw_wdl,
    raw_score_cp: raw.raw_score_cp,
    raw_wdl: raw.raw_wdl,
    side_to_move: sideToMove,
  };
}

/** Negation that preserves "the engine did not report this" rather than turning it into 0. */
function negate(value: number | null): number | null {
  return value === null ? null : -value;
}

function swapWinAndLoss(wdl: WdlTriple): WdlTriple {
  const [win, draw, loss] = wdl;
  return [loss, draw, win];
}
