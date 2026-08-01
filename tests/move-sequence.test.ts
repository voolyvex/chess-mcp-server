import { describe, expect, it } from 'vitest';
import { MoveSequenceError, parseMoveSequence, START_FEN } from '../src/move-sequence.js';

/**
 * Tier 1: the parse boundary. No engine is involved — a Move Sequence either resolves to a
 * board or names why it did not, and neither outcome depends on a search.
 *
 * All three input forms go through one parse, so these tests assert they *agree* rather
 * than checking three code paths separately.
 */

/** `1. e4 e5 2. Nf3` — the same three plies, however they arrive. */
const AFTER_THREE_PLIES = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';

/** A King-and-pawn ending at move 40, for sequences that start mid-game. */
const MIDGAME_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40';

describe('a Move Sequence arrives in any of three forms', () => {
  it('parses a bare move list, with no numbers and no result', () => {
    const parsed = parseMoveSequence('e4 e5 Nf3');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
    expect(parsed.positions.at(-1)).toBe(AFTER_THREE_PLIES);
  });

  it('parses a numbered move list', () => {
    const parsed = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('parses a full PGN, and all three forms reach the same board', () => {
    const pgn = [
      '[Event "Casual game"]',
      '[Site "Internet"]',
      '[Date "2024.01.01"]',
      '[Round "1"]',
      '[White "Alice"]',
      '[Black "Bob"]',
      '[Result "*"]',
      '',
      '1. e4 {a comment} e5 $1 2. Nf3 *',
    ].join('\n');

    const fromPgn = parseMoveSequence(pgn);
    // One parse, so the three forms cannot disagree — asserted rather than assumed.
    expect(fromPgn.san).toEqual(parseMoveSequence('e4 e5 Nf3').san);
    expect(fromPgn.positions).toEqual(parseMoveSequence('1. e4 e5 2. Nf3').positions);
  });

  it('consumes clock and eval annotations rather than rejecting them', () => {
    const parsed = parseMoveSequence('1. e4 {[%clk 0:03:00]} e5 {[%eval 0.24]} 2. Nf3');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('consumes NAGs and suffix annotations', () => {
    const parsed = parseMoveSequence('1. e4! e5?! 2. Nf3 $14');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('accepts a result token, and does not treat it as a move', () => {
    const parsed = parseMoveSequence('1. e4 e5 2. Nf3 1-0');
    expect(parsed.san).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('a PGN may declare its own Start Position', () => {
  it('honours a [FEN] header with [SetUp "1"]', () => {
    const parsed = parseMoveSequence(`[SetUp "1"]\n[FEN "${MIDGAME_FEN}"]\n\n40. e4 Kd7`);
    expect(parsed.start_fen).toBe(MIDGAME_FEN);
    expect(parsed.san).toEqual(['e4', 'Kd7']);
  });

  it('honours a [FEN] header without [SetUp], rather than ignoring the board it names', () => {
    // Ignoring a [FEN] header for want of a sibling tag would evaluate a board the user
    // never pasted — the failure this server exists to prevent.
    const parsed = parseMoveSequence(`[FEN "${MIDGAME_FEN}"]\n\n40. e4 Kd7`);
    expect(parsed.start_fen).toBe(MIDGAME_FEN);
  });

  it('reports the declared FEN separately from the resolved Start Position', () => {
    const parsed = parseMoveSequence(`[FEN "${MIDGAME_FEN}"]\n\n40. e4`, MIDGAME_FEN);
    expect(parsed.declared_fen).toBe(MIDGAME_FEN);
    expect(parsed.start_fen).toBe(MIDGAME_FEN);
  });

  it('errors when the header and the fen argument disagree, rather than preferring one', () => {
    // The clash is decided here rather than reported onward: see tests/ambiguity.test.ts.
    expect(() => parseMoveSequence(`[FEN "${MIDGAME_FEN}"]\n\n40. e4`, START_FEN)).toThrow(
      MoveSequenceError,
    );
  });

  it('carries no declared FEN when the text has no header', () => {
    expect(parseMoveSequence('1. e4 e5').declared_fen).toBeNull();
  });
});

describe('the sequence resolves to a board', () => {
  it('visits one more position than it has moves', () => {
    // N moves pass through N+1 positions. Ply addressing is built on this identity.
    const parsed = parseMoveSequence('1. e4 e5 2. Nf3');
    expect(parsed.positions).toHaveLength(parsed.san.length + 1);
  });

  it('holds the Start Position at index 0, even when it is mid-game', () => {
    const parsed = parseMoveSequence('40. e4 Kd7', MIDGAME_FEN);
    expect(parsed.positions[0]).toBe(MIDGAME_FEN);
    expect(parsed.positions[0]).toBe(parsed.start_fen);
  });

  it('evaluates the Start Position when no sequence is supplied', () => {
    const parsed = parseMoveSequence(undefined, MIDGAME_FEN);
    expect(parsed.san).toEqual([]);
    expect(parsed.positions).toEqual([MIDGAME_FEN]);
  });

  it('treats empty text as no sequence at all', () => {
    expect(parseMoveSequence('   ').positions).toEqual([START_FEN]);
  });

  it('defaults to the standard array when nothing supplies a Start Position', () => {
    expect(parseMoveSequence(undefined).start_fen).toBe(START_FEN);
  });
});

describe('a Move Sequence that cannot be played errors, naming what broke', () => {
  it('names the illegal move', () => {
    expect(() => parseMoveSequence('1. e4 e5 2. Qh9')).toThrow(MoveSequenceError);
    expect(() => parseMoveSequence('1. e4 e5 2. Qh9')).toThrow(/"Qh9"/);
  });

  it('names the position the move was illegal in, so the failure is locatable', () => {
    expect(() => parseMoveSequence('1. e4 e5 2. Bxf7')).toThrow(/rnbqkbnr/);
  });

  it('errors on a fragment starting mid-sequence', () => {
    // `3... Nf6` is legal in its own game and meaningless from the standard array.
    expect(() => parseMoveSequence('3... Nf6 4. Ng5')).toThrow(MoveSequenceError);
  });

  it('accepts that same fragment when its Start Position is supplied', () => {
    // The guard rejects an unplayable sequence, not a mid-game one — the neighbour case.
    const fen = 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 4';
    expect(() => parseMoveSequence('4. Ng5', fen)).not.toThrow();
  });

  it('errors on two concatenated games rather than running them together', () => {
    // Silently playing on past the result would evaluate a board from neither game.
    expect(() => parseMoveSequence('1. e4 e5 1-0 1. d4 d5 0-1')).toThrow(MoveSequenceError);
    expect(() => parseMoveSequence('1. e4 e5 1-0 1. d4 d5 0-1')).toThrow(/termination/);
  });

  it('errors on an invalid Start Position, naming it', () => {
    expect(() => parseMoveSequence('e4', 'not-a-fen')).toThrow(MoveSequenceError);
    expect(() => parseMoveSequence('e4', 'not-a-fen')).toThrow(/Start Position/);
  });
});
