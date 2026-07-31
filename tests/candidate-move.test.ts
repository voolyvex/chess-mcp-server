import { describe, expect, it } from 'vitest';
import { IllegalCandidateError } from '../src/candidate-move.js';
import { evaluatePosition } from '../src/evaluate-position.js';
import { fakeEngine, line } from './helpers/fake-engine.js';

/**
 * Tier 1: the Candidate's shape and its error rules. What a Candidate's number *means*
 * belongs to tier 2 — the fake's scores are invented, so asserting on their magnitude here
 * would be tautological.
 */

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** After `1. e4 e5 2. Nf3` — Black to move, where an Evaluation and a Raw Score disagree. */
const BLACK_TO_MOVE = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

describe('a Candidate Move is accepted in either notation', () => {
  it('accepts SAN and echoes which form was parsed', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'Nf3' });

    expect(result.candidate?.san).toBe('Nf3');
    expect(result.candidate?.uci).toBe('g1f3');
    expect(result.candidate?.parsed_as).toBe('san');
  });

  it('accepts UCI and echoes which form was parsed', async () => {
    // Failing on `Bxh6` where `c1h6` works is a frequent, avoidable error — a model
    // produces either form, so both are first-class.
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'g1f3' });

    expect(result.candidate?.san).toBe('Nf3');
    expect(result.candidate?.uci).toBe('g1f3');
    expect(result.candidate?.parsed_as).toBe('uci');
  });

  it('reports the same move from either notation', async () => {
    const fromSan = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'Nf3' });
    const fromUci = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'g1f3' });

    expect(fromSan.candidate?.san).toBe(fromUci.candidate?.san);
    expect(fromSan.candidate?.uci).toBe(fromUci.candidate?.uci);
  });
});

describe('a Candidate Move that cannot be played errors', () => {
  it('names the move and the position it was illegal in', async () => {
    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'Qh5' }),
    ).rejects.toThrow(IllegalCandidateError);

    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'Qh5' }),
    ).rejects.toThrow(/"Qh5".*rnbqkbnr/s);
  });

  it('rejects a well-formed UCI move that is not legal here', async () => {
    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'e2e5' }),
    ).rejects.toThrow(IllegalCandidateError);
  });

  it('still evaluates the position normally when no Candidate is supplied', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });
    expect(result.candidate).toBeNull();
    expect(result.evaluation).not.toBeNull();
  });
});

describe('the Candidate carries its own evidence', () => {
  it('reports its own depth, separate from the main search', async () => {
    // Two searches under one wall-clock budget can finish at different depths. That is a
    // consequence to report, not to hide behind a single shared number.
    const result = await evaluatePosition(fakeEngine({ depth_reached: 18 }), {
      fen: START_FEN,
      candidate: 'Nf3',
    });

    expect(result.candidate?.depth_reached).toBe(18);
    expect(result.evidence.depth_reached).toBe(18);
  });

  it('searches the position after the move, and says which board that was', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'e4' });

    // The Candidate's number comes from the board *after* it was played, not before.
    expect(result.candidate?.resolved_fen).toContain('4P3');
    expect(result.candidate?.resolved_fen).not.toBe(result.position.resolved_fen);
  });

  it('ships a White-relative Evaluation with the raw score beside it', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'e4' });

    // Same convention as the main Evaluation: both forms present, conversion auditable.
    expect(result.candidate?.evaluation.side_to_move).toBe('b');
    expect(result.candidate?.evaluation.raw_wdl).not.toBeUndefined();
  });
});

describe('the delta compares two Evaluations, never an Evaluation and a Raw Score', () => {
  it('is the White-relative difference against the engine choice', async () => {
    // The fake reports +35 side-to-move relative on every search. White to move at the
    // root, so the best Evaluation is +35; Black to move after the Candidate, so its
    // Evaluation is -35. The delta is the difference between those two, not between
    // +35 and +35.
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN, candidate: 'e4' });

    expect(result.evaluation?.evaluation_cp).toBe(35);
    expect(result.candidate?.evaluation.evaluation_cp).toBe(-35);
    expect(result.candidate?.delta_cp).toBe(-70);
  });

  it('subtracts the Evaluation, not the Raw Score, when the two differ', async () => {
    // With **Black** to move at the root the two quantities have opposite signs: the
    // Evaluation is -35, the Raw Score is +35. Every other delta assertion here uses a
    // White-to-move root, where they coincide and a delta built on the wrong one still
    // looks right. This is the case that tells them apart.
    const result = await evaluatePosition(fakeEngine(), {
      fen: BLACK_TO_MOVE,
      candidate: 'Nc6',
    });

    expect(result.evaluation?.evaluation_cp).toBe(-35);
    expect(result.evaluation?.raw_score_cp).toBe(35);
    // 35 - (-35). Subtracting the Raw Score would yield 0 — a plausible-looking number
    // that is the difference between two quantities that are not comparable.
    expect(result.candidate?.delta_cp).toBe(70);
  });

  it('is null when a mate sits on either side of the comparison', async () => {
    const mating = fakeEngine({
      lines: [line({ raw_score_cp: null, raw_score_mate: 3, raw_wdl: [1000, 0, 0] })],
    });
    const result = await evaluatePosition(mating, { fen: START_FEN, candidate: 'e4' });

    // A mate and a centipawn score have no difference worth reporting; a number here
    // would be fabricated.
    expect(result.candidate?.delta_cp).toBeNull();
  });
});
