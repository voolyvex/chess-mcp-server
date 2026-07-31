import { describe, expect, it } from 'vitest';
import { AddressError, resolveAddress } from '../src/address.js';
import { parseMoveSequence } from '../src/move-sequence.js';

/**
 * Tier 1: addressing. No engine is involved — an address either names a position in a
 * parsed sequence or says why it cannot, and neither outcome depends on a search.
 *
 * The two schemes are not parallel: Ply names a *position*, Move Number names a *move*.
 * These tests hold that distinction rather than treating them as two spellings of one
 * coordinate.
 */

/** `1. e4 e5 2. Nf3 Nc6` — four plies, five positions. */
const SPANISH_OPENING = '1. e4 e5 2. Nf3 Nc6';

/** A King-and-pawn ending at move 40, for sequences that start mid-game. */
const MIDGAME_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 40';

describe('ply addresses a position, counted from the Start Position', () => {
  it('resolves ply 0 to the Start Position itself', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { ply: 0 });

    expect(resolved.ply).toBe(0);
    expect(resolved.resolved_fen).toBe(sequence.start_fen);
  });

  it('resolves ply p to the position after p half-moves', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { ply: 3 });

    expect(resolved.resolved_fen).toBe(sequence.positions[3]);
    // Three half-moves applied: White has moved twice, Black once, so Black is to move.
    expect(resolved.side_to_move).toBe('b');
  });

  it('reaches the final position, which no Move Number can name', () => {
    // The boundary the two schemes disagree at. N moves pass through N+1 positions, so
    // the last one sits after every move and before none.
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { ply: 4 });

    expect(resolved.ply).toBe(4);
    expect(resolved.resolved_fen).toBe(sequence.positions.at(-1));
  });

  it('counts from a mid-game Start Position, not from move one', () => {
    // Ply is always relative to the Start Position, whatever move number that position is.
    const sequence = parseMoveSequence('40. e4 Kd7', MIDGAME_FEN);
    const resolved = resolveAddress(sequence, { ply: 1 });

    expect(resolved.ply).toBe(1);
    expect(resolved.move_number).toBe(40);
    expect(resolved.side_to_move).toBe('b');
  });
});

describe('move number addresses a move, and resolves to the position before it', () => {
  it('resolves a move number and colour to the position the move was decided in', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { move_number: 2, side: 'w' });

    // Before White's second move: two plies have been applied.
    expect(resolved.ply).toBe(2);
    expect(resolved.move_number).toBe(2);
    expect(resolved.side_to_move).toBe('w');
  });

  it('resolves Black to the ply after White has moved', () => {
    // The fullmove number increments after Black's move; this is where the off-by-one
    // lives, and the reason this field exists rather than being converted by hand.
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { move_number: 2, side: 'b' });

    expect(resolved.ply).toBe(3);
    expect(resolved.side_to_move).toBe('b');
  });

  it('resolves move 1 for White to the Start Position of a standard game', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(resolveAddress(sequence, { move_number: 1, side: 'w' }).ply).toBe(0);
  });

  it('stays absolute when the Start Position is mid-game', () => {
    // Derived from the FEN, never counted from the sequence: move 40 is ply 0 here, not
    // ply 78. Counting from the sequence would name a position 39 moves away.
    const sequence = parseMoveSequence('40. e4 Kd7', MIDGAME_FEN);
    const resolved = resolveAddress(sequence, { move_number: 40, side: 'w' });

    expect(resolved.ply).toBe(0);
    expect(resolved.resolved_fen).toBe(MIDGAME_FEN);
  });

  it('resolves a later move of a mid-game sequence', () => {
    const sequence = parseMoveSequence('40. e4 Kd7', MIDGAME_FEN);
    const resolved = resolveAddress(sequence, { move_number: 40, side: 'b' });

    expect(resolved.ply).toBe(1);
    expect(resolved.move_number).toBe(40);
    expect(resolved.side_to_move).toBe('b');
  });

  it('resolves a Start Position where Black is to move', () => {
    // Move 40 has already had its White half played, so `40 w` names no position here
    // and `40 b` is ply 0. The scheme is anchored to the FEN's own counters.
    const blackToMove = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 40';
    const sequence = parseMoveSequence('40... Kd7', blackToMove);

    expect(resolveAddress(sequence, { move_number: 40, side: 'b' }).ply).toBe(0);
    expect(() => resolveAddress(sequence, { move_number: 40, side: 'w' })).toThrow(AddressError);
  });
});

describe('with no address, the final position is what gets evaluated', () => {
  it('defaults to the last position of the sequence', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, {});

    expect(resolved.ply).toBe(4);
    expect(resolved.resolved_fen).toBe(sequence.positions.at(-1));
  });

  it('degenerates to the Start Position when there is no sequence', () => {
    const sequence = parseMoveSequence(undefined, MIDGAME_FEN);
    const resolved = resolveAddress(sequence, {});

    expect(resolved.ply).toBe(0);
    expect(resolved.resolved_fen).toBe(MIDGAME_FEN);
  });
});

describe('every resolution echoes where it landed', () => {
  it('reports resolved FEN, ply, move number, and side to move', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    const resolved = resolveAddress(sequence, { ply: 2 });

    expect(resolved).toMatchObject({
      resolved_fen: expect.stringContaining(' '),
      ply: 2,
      move_number: 2,
      side_to_move: 'w',
    });
  });

  it('reports the move number from the resolved board, not from the Start Position', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(resolveAddress(sequence, { ply: 4 }).move_number).toBe(3);
  });
});

describe('an address past the end of the sequence errors, naming the range that exists', () => {
  it('rejects a ply beyond the last position', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { ply: 5 })).toThrow(AddressError);
    // The range is what the caller needs to correct the request.
    expect(() => resolveAddress(sequence, { ply: 5 })).toThrow(/0.*4/s);
  });

  it('rejects a negative ply', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { ply: -1 })).toThrow(AddressError);
  });

  it('rejects a move number past the end, naming the moves that exist', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { move_number: 9, side: 'w' })).toThrow(AddressError);
    // Four plies: moves 1 (w) through 2 (b) were played, and those are what can be named.
    expect(() => resolveAddress(sequence, { move_number: 9, side: 'w' })).toThrow(
      /moves 1 \(w\) through 2 \(b\)/,
    );
  });

  it('rejects a move number before the Start Position', () => {
    const sequence = parseMoveSequence('40. e4 Kd7', MIDGAME_FEN);
    expect(() => resolveAddress(sequence, { move_number: 39, side: 'w' })).toThrow(AddressError);
  });

  it('names no move at all when there is no sequence, though ply 0 still resolves', () => {
    // A bare FEN has one position and zero moves, so every move number is unaddressable
    // while ply 0 names the board perfectly well. The one-short property at its limit.
    const sequence = parseMoveSequence(undefined, MIDGAME_FEN);
    expect(resolveAddress(sequence, { ply: 0 }).resolved_fen).toBe(MIDGAME_FEN);
    expect(() => resolveAddress(sequence, { move_number: 40, side: 'w' })).toThrow(AddressError);
  });

  it('cannot name the final position, and says so rather than clamping', () => {
    // Four plies means moves 1w 1b 2w 2b were played, and the fifth position sits before
    // no move at all. `3 w` is the move that would follow — structurally unaddressable.
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { move_number: 3, side: 'w' })).toThrow(AddressError);
  });
});

describe('a half-supplied address errors rather than guessing the other half', () => {
  it('rejects a colour with no move number', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { side: 'w' })).toThrow(AddressError);
    expect(() => resolveAddress(sequence, { side: 'w' })).toThrow(/move_number/);
  });

  it('rejects a move number with no colour', () => {
    const sequence = parseMoveSequence(SPANISH_OPENING);
    expect(() => resolveAddress(sequence, { move_number: 2 })).toThrow(AddressError);
    expect(() => resolveAddress(sequence, { move_number: 2 })).toThrow(/side/);
  });
});
