import { Chess } from 'chess.js';
import type { ParsedSequence } from './move-sequence.js';
import type { SideToMove } from './raw-score.js';

/**
 * Where in a Move Sequence the caller is asking about.
 *
 * Two schemes, and they are **not parallel coordinate systems**. `ply` names a *position*;
 * `move_number` plus `side` names a *move*, and resolves to the position before it — the
 * point at which that move was still a decision. N moves pass through N+1 positions, so
 * move-number addressing is structurally one short: it can never name the final position,
 * having no move to sit before.
 *
 * Everything optional. Nothing supplied means the final position, which degenerates
 * correctly to "evaluate this FEN" when there is no sequence.
 */
export interface Address {
  /** Half-moves applied to the Start Position, 0-based. Ply 0 *is* the Start Position. */
  readonly ply?: number;
  /** The true game move number, as a PGN or a user would say it. Needs a `side`. */
  readonly move_number?: number;
  /** Which half of `move_number`. Needs a `move_number`. */
  readonly side?: SideToMove;
}

/** A Position named by an address, and every way of naming it echoed back. */
export interface ResolvedPosition {
  readonly resolved_fen: string;
  /** Half-moves applied to the Start Position. */
  readonly ply: number;
  /** The true game move number, read off the resolved board rather than counted. */
  readonly move_number: number;
  readonly side_to_move: SideToMove;
}

/** An address that named no position in the sequence, saying which ones exist. */
export class AddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AddressError';
  }
}

/**
 * Resolves an address against a parsed sequence.
 *
 * Move numbers are converted through the **Start Position's own counters**, never counted
 * from the sequence. A sequence beginning at move 40 has its first move at ply 0, and
 * counting plies from one would name a position 39 moves away — exactly the error this
 * addressing exists to prevent.
 */
export function resolveAddress(sequence: ParsedSequence, address: Address): ResolvedPosition {
  const ply = resolvePly(sequence, address);
  const fen = sequence.positions[ply];

  // Unreachable: `resolvePly` only returns indices it has bounds-checked. Narrowing here
  // rather than asserting keeps the guarantee in the type system instead of a comment.
  if (fen === undefined) {
    throw new AddressError(`ply ${ply} names no position in a sequence of ${lastPly(sequence)}`);
  }

  const board = new Chess(fen);
  return {
    resolved_fen: fen,
    ply,
    move_number: board.moveNumber(),
    side_to_move: board.turn(),
  };
}

/** The address, reduced to the one index into `positions` it names. */
function resolvePly(sequence: ParsedSequence, address: Address): number {
  const hasPly = address.ply !== undefined;
  const hasMoveNumber = address.move_number !== undefined;
  const hasSide = address.side !== undefined;

  // Two kinds of address at once. Not rejected for redundancy — they address different
  // kinds of thing and cannot be reconciled, so even a pair that happens to agree is an
  // ambiguity made invisible rather than absent.
  if (hasPly && (hasMoveNumber || hasSide)) {
    throw new AddressError(
      `two kinds of address supplied: ply names a position, move_number names a move. ` +
        `They cannot be reconciled — supply ply alone, or move_number with side.`,
    );
  }

  // A colour without a move number, or a move number without one, is half an address.
  // Guessing the other half would evaluate a position the caller did not ask about.
  if (hasMoveNumber && !hasSide) {
    throw new AddressError(
      `move_number ${address.move_number} needs a side ("w" or "b") to name a move. ` +
        `A move number alone names two positions; supply side, or use ply instead.`,
    );
  }
  if (hasSide && !hasMoveNumber) {
    throw new AddressError(
      `side "${address.side}" needs a move_number to name a move. ` +
        `Supply move_number, or use ply to address a position directly.`,
    );
  }

  if (hasPly) return checkedPly(sequence, address.ply as number);
  if (hasMoveNumber) {
    return checkedMoveNumber(sequence, address.move_number as number, address.side as SideToMove);
  }

  // No address: the final position of the sequence.
  return lastPly(sequence);
}

/** The last index in `positions` — the final position, and the largest legal ply. */
function lastPly(sequence: ParsedSequence): number {
  return sequence.positions.length - 1;
}

function checkedPly(sequence: ParsedSequence, ply: number): number {
  const last = lastPly(sequence);
  if (!Number.isInteger(ply) || ply < 0 || ply > last) {
    throw new AddressError(
      `ply ${ply} is outside this sequence, which has plies 0 through ${last} ` +
        `(${sequence.san.length} moves from the Start Position).`,
    );
  }
  return ply;
}

/**
 * The ply a move number names, via the Start Position's own move number and side.
 *
 * The fullmove number increments after Black's move, so each move number spans two plies
 * and the Start Position may land on either half of one. Anchoring the arithmetic at the
 * Start Position's counters is what keeps a mid-game sequence absolute.
 */
function checkedMoveNumber(
  sequence: ParsedSequence,
  moveNumber: number,
  side: SideToMove,
): number {
  const start = new Chess(sequence.start_fen);
  const startMoveNumber = start.moveNumber();
  // Plies elapsed within a move number: White's half is 0, Black's is 1.
  const startOffset = start.turn() === 'w' ? 0 : 1;
  const ply = (moveNumber - startMoveNumber) * 2 + (side === 'w' ? 0 : 1) - startOffset;

  const last = lastPly(sequence);
  // `last`, not `last - 1`, is the largest *ply*; but a move number names the position
  // before a move that was actually played, and no move follows the final position. So
  // move-number addressing stops one short, by construction rather than by accident.
  if (ply < 0 || ply >= last) {
    throw new AddressError(
      `move ${moveNumber} for ${side === 'w' ? 'White' : 'Black'} is outside this sequence, ` +
        `which covers ${describeMoveRange(sequence, startMoveNumber, startOffset)}. ` +
        `A move number names the position before that move, so it can never name the ` +
        `final position of a sequence — address that by ply ${last}.`,
    );
  }
  return ply;
}

/** The moves a sequence actually contains, spelled the way a caller would address them. */
function describeMoveRange(
  sequence: ParsedSequence,
  startMoveNumber: number,
  startOffset: number,
): string {
  if (sequence.san.length === 0) {
    return `no moves — only the Start Position, at ply 0`;
  }
  const lastMovePly = sequence.san.length - 1;
  const lastNumber = startMoveNumber + Math.floor((lastMovePly + startOffset) / 2);
  const lastSide = (lastMovePly + startOffset) % 2 === 0 ? 'w' : 'b';
  const firstSide = startOffset === 0 ? 'w' : 'b';
  return `moves ${startMoveNumber} (${firstSide}) through ${lastNumber} (${lastSide})`;
}
