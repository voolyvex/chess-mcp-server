import { Chess } from 'chess.js';

/** The standard array. The Start Position when nothing else supplies one. */
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * A Move Sequence that parsed, and the boards it passes through.
 *
 * `positions` holds every position the sequence visits, Start Position first, so
 * `positions[p]` *is* the position at ply `p`. N moves yield N+1 positions — the identity
 * ply addressing is built on, and the reason a Move Number can never name the last one.
 */
export interface ParsedSequence {
  /** Where the sequence was played from — a `[FEN]` header, the `fen` argument, or the standard array. */
  readonly start_fen: string;
  /** The moves, in canonical SAN, as played. Empty when no sequence was supplied. */
  readonly san: readonly string[];
  /** Every position visited, Start Position at index 0. Always one longer than `san`. */
  readonly positions: readonly string[];
  /** The Start Position declared by a `[FEN]` header, if the input carried one. */
  readonly declared_fen: string | null;
}

/** A Move Sequence that did not parse, naming what went wrong. */
export class MoveSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoveSequenceError';
  }
}

/**
 * Parses a Move Sequence in any of its three forms — a bare move list, a numbered move
 * list, or a full PGN with headers and annotations.
 *
 * All three are the same thing: moves played from a Start Position. Whether they arrive
 * numbered, commented, or wrapped in a Seven Tag Roster is a detail of the text, so this
 * is **one parse with one output**, not three code paths that could disagree.
 *
 * `fen` is the caller's Start Position. A `[FEN]` header inside the text does not override
 * it silently — a header that disagrees with the argument is an ambiguity and errors here,
 * because there is no basis for preferring one board over the other.
 */
export function parseMoveSequence(text: string | undefined, fen?: string): ParsedSequence {
  const declaredFen = text === undefined ? null : declaredStartPosition(text);

  // Two Start Positions that disagree name two different games, and there is no basis for
  // preferring one — so this errors rather than resolving. Identical is not a conflict.
  if (declaredFen !== null && fen !== undefined && declaredFen !== fen) {
    throw new MoveSequenceError(
      `two Start Positions that disagree: the fen argument ${JSON.stringify(fen)} and the ` +
        `[FEN] header ${JSON.stringify(declaredFen)}. There is no basis for preferring ` +
        `one — supply whichever names the board you mean, and drop the other.`,
    );
  }

  const startFen = declaredFen ?? fen ?? START_FEN;
  const board = startingBoard(startFen);

  const positions: string[] = [board.fen()];
  const san: string[] = [];

  // Moves are applied one at a time rather than handed to `loadPgn` wholesale. Two reasons,
  // both load-bearing: a `loadPgn` failure names the parser's expectations rather than the
  // move that broke, and a recursive variation is silently reduced to its mainline —
  // the one parser failure that yields a confident answer to a question nobody asked.
  for (const token of moveTokens(text ?? '')) {
    try {
      san.push(board.move(token).san);
    } catch {
      throw new MoveSequenceError(
        `illegal move ${JSON.stringify(token)} in position ${board.fen()}. ` +
          `A Move Sequence must be legal from its Start Position; a sequence starting ` +
          `mid-game needs that position supplied as a fen argument or a [FEN] header.`,
      );
    }
    positions.push(board.fen());
  }

  return { start_fen: startFen, san, positions, declared_fen: declaredFen };
}

/** The Start Position as a board, rejecting a FEN no game could be played from. */
function startingBoard(fen: string): Chess {
  try {
    return new Chess(fen);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new MoveSequenceError(`invalid Start Position ${JSON.stringify(fen)}: ${detail}`);
  }
}

/**
 * The `[FEN]` header's Start Position, if the text declares one.
 *
 * `[SetUp "1"]` is not required. It is the standard's way of saying the `[FEN]` header is
 * meaningful, but a `[FEN]` header that is present and ignored for want of a sibling tag
 * would evaluate a board the user did not paste — the failure mode this server exists to
 * prevent, so the header is honoured whenever it appears.
 */
function declaredStartPosition(text: string): string | null {
  const match = /^[^\S\n]*\[\s*FEN\s+"([^"]*)"\s*\]/im.exec(text);
  return match?.[1] ?? null;
}

/** Header lines, `{ }` comments, and the `;` rest-of-line form — consumed and dropped. */
function stripHeadersAndComments(text: string): string {
  return text
    .replace(/^[^\S\n]*\[[^\]\n]*\]\s*$/gm, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ');
}

/** Game termination markers. A sequence may end with one, or with nothing at all. */
const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/**
 * Splits the text into the move tokens to be played, dropping everything that is notation
 * *about* the moves rather than a move: numbering, annotations, and the result.
 *
 * A variation is rejected outright before any move is played. Stripping it would answer
 * confidently about a game nobody asked about, and letting it reach the board would report
 * an illegal move where the real content was a second line of play.
 */
function moveTokens(text: string): string[] {
  const body = stripHeadersAndComments(text);
  rejectVariations(body);
  const tokens: string[] = [];
  let terminated = false;

  for (const raw of body.split(/\s+/)) {
    const token = raw.trim();
    if (token === '') continue;

    // A result token ends the game. Anything after it belongs to a second game, and two
    // concatenated games have no single final position to evaluate — so this is an error
    // rather than a sequence that quietly runs the two together into one board.
    if (RESULT_TOKENS.has(token)) {
      terminated = true;
      continue;
    }
    if (terminated) {
      throw new MoveSequenceError(
        `content after the game termination marker: ${JSON.stringify(token)}. ` +
          `Two concatenated games have no single final position — supply one game.`,
      );
    }

    // `1.` `1...` and a bare `1` when the dot was spaced away from its number.
    if (/^\d+\.*$/.test(token)) continue;
    // A NAG.
    if (/^\$\d+$/.test(token)) continue;

    const move = stripSuffixAnnotations(token);
    if (move === '') continue;
    tokens.push(move);
  }

  return tokens;
}

/**
 * Rejects a recursive annotation variation, naming it as one.
 *
 * This runs on text with comments already removed, so parentheses inside a `{ }` comment
 * are prose and never reach it. Every remaining parenthesis opens a branch — a second line
 * of play whose moves were not played in the game the caller pasted.
 *
 * It is the only parser failure that would otherwise yield a *confident answer to a
 * question nobody asked*: a variation of legal moves parses cleanly once dropped, so
 * nothing downstream could notice the game had been altered.
 */
function rejectVariations(body: string): void {
  if (!/[()]/.test(body)) return;
  throw new MoveSequenceError(
    `the Move Sequence contains a variation, and a variation names moves that were not ` +
      `played. Which line to evaluate cannot be decided here — supply the single mainline ` +
      `you mean, with the parenthesised variations removed.`,
  );
}

/**
 * Removes `!`, `?` and their pairs from a move token.
 *
 * chess.js accepts SAN with these attached, but a token that is *only* annotation would
 * otherwise reach the board as a move and fail there, reporting an illegal move where the
 * real content was an annotation the format allows.
 */
function stripSuffixAnnotations(token: string): string {
  return token.replace(/[!?]+$/, '');
}
