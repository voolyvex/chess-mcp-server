import { describe, expect, it } from 'vitest';
import { MissingWdlError, toEvaluation } from '../src/evaluation.js';
import type { RawScore } from '../src/raw-score.js';

/**
 * The conversion boundary, tested directly. Shipping a Raw Score as though it were an
 * Evaluation reports "White is winning" on a position where White is down a queen —
 * the failure this server exists to make impossible.
 *
 * The expected values below are the measurements recorded in
 * `.claude/rules/engine-contract.md` — Stockfish 18, depth 14, one board with only the
 * turn changed. They are a known-good literal, not a number recomputed here the way the
 * implementation computes it.
 */

/** White down a queen, White to move — the engine reported `-638`. */
const whiteToMove: RawScore = {
  raw_score_cp: -638,
  raw_score_mate: null,
  raw_wdl: [12, 60, 928],
};

/** The same board, Black to move — the engine reported `+671`. */
const blackToMove: RawScore = {
  raw_score_cp: 671,
  raw_score_mate: null,
  raw_wdl: [928, 60, 12],
};

describe('Raw Score becomes an Evaluation', () => {
  it('leaves the sign alone when White is to move', () => {
    const evaluation = toEvaluation(whiteToMove, 'w');
    expect(evaluation.evaluation_cp).toBe(-638);
  });

  it('negates when Black is to move, so White down a queen reads as losing for White', () => {
    // The whole bug in one assertion: pass +671 through unconverted and you have called
    // a board where White is down a queen "White is winning".
    const evaluation = toEvaluation(blackToMove, 'b');
    expect(evaluation.evaluation_cp).toBe(-671);
  });

  it('ships the Raw Score and the side to move, so a reader can check the conversion', () => {
    const evaluation = toEvaluation(blackToMove, 'b');
    expect(evaluation.raw_score_cp).toBe(671);
    expect(evaluation.side_to_move).toBe('b');
  });

  it('agrees on who is winning regardless of whose turn it is', () => {
    // Same board, two turns. Raw Scores disagree in sign; Evaluations must not.
    const fromWhite = toEvaluation(whiteToMove, 'w');
    const fromBlack = toEvaluation(blackToMove, 'b');
    expect(Math.sign(fromWhite.evaluation_cp ?? 0)).toBe(
      Math.sign(fromBlack.evaluation_cp ?? 0),
    );
  });
});

describe('WDL carries the same trap', () => {
  it('leaves win and loss in place when White is to move', () => {
    const evaluation = toEvaluation(whiteToMove, 'w');
    expect(evaluation.wdl_white).toEqual([12, 60, 928]);
  });

  it('swaps win and loss when Black is to move — negating centipawns is not enough', () => {
    // Black to move is winning, so White's own win/loss reads 12/928, not 928/12.
    const evaluation = toEvaluation(blackToMove, 'b');
    expect(evaluation.wdl_white).toEqual([12, 60, 928]);
  });

  it('ships the raw triple alongside, as the engine reported it', () => {
    const evaluation = toEvaluation(blackToMove, 'b');
    expect(evaluation.raw_wdl).toEqual([928, 60, 12]);
  });

  it('ships both forms, and with Black to move they actually differ', () => {
    // The guard against an identity conversion passing this suite. Every other WDL
    // assertion here would still pass if `wdl_white` were `raw_wdl` under another name on
    // a symmetric triple; this one cannot.
    const evaluation = toEvaluation(blackToMove, 'b');
    expect(evaluation.wdl_white).not.toEqual(evaluation.raw_wdl);
  });

  it('leaves the two forms equal when White is to move', () => {
    const evaluation = toEvaluation(whiteToMove, 'w');
    expect(evaluation.wdl_white).toEqual(evaluation.raw_wdl);
  });

  it('fails explicitly when the engine reported no WDL, rather than omitting the field', () => {
    // A silently absent field is indistinguishable from a conversion that dropped it.
    const noWdl: RawScore = { raw_score_cp: 35, raw_score_mate: null, raw_wdl: null };
    expect(() => toEvaluation(noWdl, 'w')).toThrow(MissingWdlError);
  });

  it('names the cause, so a misconfigured engine is diagnosable from the message', () => {
    const noWdl: RawScore = { raw_score_cp: 35, raw_score_mate: null, raw_wdl: null };
    expect(() => toEvaluation(noWdl, 'w')).toThrow(/UCI_ShowWDL/);
  });
});

describe('a forced mate is a distance, not centipawns', () => {
  it('keeps a positive mate distance for White when White is to move', () => {
    const mate: RawScore = { raw_score_cp: null, raw_score_mate: 1, raw_wdl: [1000, 0, 0] };
    const evaluation = toEvaluation(mate, 'w');
    expect(evaluation.mate_in).toBe(1);
    expect(evaluation.evaluation_cp).toBeNull();
  });

  it('reports Black mating in 1 as a negative distance, not as centipawns', () => {
    const mate: RawScore = { raw_score_cp: null, raw_score_mate: 1, raw_wdl: [1000, 0, 0] };
    const evaluation = toEvaluation(mate, 'b');
    expect(evaluation.mate_in).toBe(-1);
    expect(evaluation.evaluation_cp).toBeNull();
  });

  it('reports White getting mated as a negative distance', () => {
    const mate: RawScore = { raw_score_cp: null, raw_score_mate: -2, raw_wdl: [0, 0, 1000] };
    expect(toEvaluation(mate, 'w').mate_in).toBe(-2);
  });

  it('never fakes a mate as a large centipawn score', () => {
    const mate: RawScore = { raw_score_cp: null, raw_score_mate: 1, raw_wdl: [1000, 0, 0] };
    const evaluation = toEvaluation(mate, 'w');
    expect(evaluation.evaluation_cp).toBeNull();
    expect(evaluation.raw_score_cp).toBeNull();
  });
});
