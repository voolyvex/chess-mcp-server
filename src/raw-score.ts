/**
 * What a UCI engine actually reported, relative to the **side to move**.
 *
 * A winning position for Black yields a *positive* `raw_score_cp` when it is Black's
 * turn. This type exists so that fact is visible in the type system: anything holding a
 * `RawScore` has not yet been converted, and a function returning one cannot be mistaken
 * for a function returning an Evaluation.
 *
 * Never widen this to a shared "score" type with `Evaluation`. They are different
 * quantities and must never share a variable name.
 */
export interface RawScore {
  /** Centipawns, side-to-move relative. Null when the engine reported a forced mate. */
  readonly raw_score_cp: number | null;
  /** Mate distance in moves, side-to-move relative. Null when the score is centipawns. */
  readonly raw_score_mate: number | null;
  /** `[win, draw, loss]` in per mille, side-to-move relative. Null if unreported. */
  readonly raw_wdl: WdlTriple | null;
}

/** `[win, draw, loss]` in per mille. Whose win it is depends on which type holds it. */
export type WdlTriple = readonly [number, number, number];

/** Which side moves next in a Position. As FEN spells it. */
export type SideToMove = 'w' | 'b';
