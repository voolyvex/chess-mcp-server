import { describe, expect, it } from 'vitest';
import { AddressError, resolveAddress } from '../src/address.js';
import { evaluatePosition, type EvaluatePositionInput } from '../src/evaluate-position.js';
import { MoveSequenceError, parseMoveSequence, START_FEN } from '../src/move-sequence.js';
import { fakeEngine } from './helpers/fake-engine.js';

/**
 * Tier 1: the ambiguity guards. A schema that guesses is the same defect as an engine that
 * guesses, one layer up — so each of these asserts an *error*, and asserts that the error
 * names what was ambiguous rather than merely failing.
 *
 * Each rule is paired with its valid neighbour, because a guard that rejects too much is
 * as wrong as one that rejects too little.
 */

/** A King-and-pawn ending at move 40, for sequences that start mid-game. */
const MIDGAME_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40';

describe('a variation errors rather than being reduced to its mainline', () => {
  it('rejects a recursive annotation variation, naming it as a variation', () => {
    // The one parser failure that yields a confident answer to a question nobody asked:
    // dropping `(2. d4 exd4)` silently answers about a game that was never played.
    const pgn = '1. e4 e5 2. Nf3 (2. d4 exd4) 2... Nc6';
    expect(() => parseMoveSequence(pgn)).toThrow(MoveSequenceError);
    expect(() => parseMoveSequence(pgn)).toThrow(/variation/i);
  });

  it('names what the caller can do about it', () => {
    expect(() => parseMoveSequence('1. e4 e5 2. Nf3 (2. d4 exd4)')).toThrow(/mainline|one line/i);
  });

  it('rejects a variation on the very first move', () => {
    expect(() => parseMoveSequence('1. e4 (1. d4 d5) 1... e5')).toThrow(/variation/i);
  });

  it('rejects a nested variation', () => {
    expect(() => parseMoveSequence('1. e4 e5 (1... c5 (1... c6) 2. Nf3)')).toThrow(/variation/i);
  });

  it('rejects a variation whose moves would all have been legal in the mainline', () => {
    // The dangerous case: nothing here is unplayable, so only a guard that detects the
    // parenthesis itself catches it. Without one this parses and answers confidently.
    expect(() => parseMoveSequence('1. e4 e5 2. Nf3 (2. Nc3)')).toThrow(/variation/i);
  });

  it('rejects an unclosed variation rather than reading past it', () => {
    expect(() => parseMoveSequence('1. e4 e5 2. Nf3 (2. d4')).toThrow(MoveSequenceError);
  });

  it('still accepts parentheses inside a comment, which annotate rather than branch', () => {
    // The valid neighbour. A `{ }` comment is prose about the move, not a second line of
    // play, so its parentheses carry no ambiguity.
    const parsed = parseMoveSequence('1. e4 {a strong move (the most common)} e5 2. Nf3');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('still accepts a mainline with no variations at all', () => {
    expect(parseMoveSequence('1. e4 e5 2. Nf3 Nc6').san).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
  });
});

describe('two Start Positions error unless they agree', () => {
  it('rejects a fen argument that disagrees with a [FEN] header', () => {
    // There is no basis for preferring one, so preferring either is a guess.
    const pgn = `[FEN "${MIDGAME_FEN}"]\n\n40. e4`;
    expect(() => parseMoveSequence(pgn, START_FEN)).toThrow(MoveSequenceError);
    expect(() => parseMoveSequence(pgn, START_FEN)).toThrow(/Start Position/i);
  });

  it('names both boards, so the caller can see which to drop', () => {
    const pgn = `[FEN "${MIDGAME_FEN}"]\n\n40. e4`;
    expect(() => parseMoveSequence(pgn, START_FEN)).toThrow(/4k3/);
    expect(() => parseMoveSequence(pgn, START_FEN)).toThrow(/rnbqkbnr/);
  });

  it('accepts identical Start Positions, which name one board and no ambiguity', () => {
    const parsed = parseMoveSequence(`[FEN "${MIDGAME_FEN}"]\n\n40. e4`, MIDGAME_FEN);
    expect(parsed.start_fen).toBe(MIDGAME_FEN);
    expect(parsed.san).toEqual(['e4']);
  });

  it('accepts a header with no fen argument', () => {
    expect(parseMoveSequence(`[FEN "${MIDGAME_FEN}"]\n\n40. e4`).start_fen).toBe(MIDGAME_FEN);
  });

  it('accepts a fen argument with no header', () => {
    expect(parseMoveSequence('40. e4', MIDGAME_FEN).start_fen).toBe(MIDGAME_FEN);
  });
});

describe('two kinds of address error when supplied together', () => {
  it('rejects ply and move_number together', () => {
    // Not because they are redundant — because they address different kinds of thing.
    const sequence = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(() => resolveAddress(sequence, { ply: 2, move_number: 2, side: 'w' })).toThrow(
      AddressError,
    );
    expect(() => resolveAddress(sequence, { ply: 2, move_number: 2, side: 'w' })).toThrow(
      /ply.*move_number|move_number.*ply/s,
    );
  });

  it('rejects them even when they happen to name the same position', () => {
    // Agreement is not a reason to accept: it makes the ambiguity invisible rather than
    // absent, and the next caller's pair will not agree.
    const sequence = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(() => resolveAddress(sequence, { ply: 2, move_number: 2, side: 'w' })).toThrow(
      AddressError,
    );
  });

  it('rejects ply supplied alongside a bare side', () => {
    const sequence = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(() => resolveAddress(sequence, { ply: 2, side: 'w' })).toThrow(AddressError);
  });

  it('accepts either address on its own', () => {
    const sequence = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(resolveAddress(sequence, { ply: 2 }).ply).toBe(2);
    expect(resolveAddress(sequence, { move_number: 2, side: 'w' }).ply).toBe(2);
  });
});

describe('no ambiguous input returns an Evaluation', () => {
  const ambiguous: { name: string; input: EvaluatePositionInput }[] = [
    { name: 'a variation', input: { moves: '1. e4 e5 2. Nf3 (2. d4 exd4)' } },
    {
      name: 'two Start Positions',
      input: { moves: `[FEN "${MIDGAME_FEN}"]\n\n40. e4`, fen: START_FEN },
    },
    { name: 'two kinds of address', input: { moves: '1. e4 e5', ply: 1, moveNumber: 1, side: 'b' } },
    { name: 'a move number with no side', input: { moves: '1. e4 e5', moveNumber: 1 } },
    { name: 'a side with no move number', input: { moves: '1. e4 e5', side: 'w' } },
  ];

  for (const { name, input } of ambiguous) {
    it(`refuses to evaluate anything for ${name}`, async () => {
      // The whole rule in one assertion per case: the tool errors, and no Evaluation of a
      // position the user did not ask about escapes.
      await expect(evaluatePosition(fakeEngine(), input)).rejects.toThrow();
    });
  }
});
