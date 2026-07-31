import { describe, expect, it } from 'vitest';
import { evaluatePosition } from '../src/evaluate-position.js';
import { fakeEngine, line } from './helpers/fake-engine.js';

/**
 * Tier 1: the tool's shape, driven by a fake engine that speaks Raw Scores.
 *
 * Nothing here asserts what a score *means* — the fake's numbers are invented, so any
 * such assertion would be tautological. What a score means is tier 2's job, against a
 * real engine. These tests pin the contract: which fields exist, that none of them is
 * prose, and that the depth reported is the one reached.
 */

/** The standard array — the Start Position when no FEN is supplied. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** White down a queen, Black to move. The board the prototype got wrong. */
const BLACK_TO_MOVE = 'rnb1kbnr/pppp1ppp/8/4p3/6q1/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 3';

describe('evaluate_position answers a bare FEN', () => {
  it('resolves a FEN into a Position block', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    expect(result.position.start_fen).toBe(START_FEN);
    expect(result.position.resolved_fen).toBe(START_FEN);
    expect(result.position.side_to_move).toBe('w');
  });

  it('defaults to the standard array when no FEN is given', async () => {
    const result = await evaluatePosition(fakeEngine(), {});
    expect(result.position.resolved_fen).toBe(START_FEN);
  });

  it('reports ply 0 and the move number the FEN carries', async () => {
    // A bare FEN is a Start Position with an empty Move Sequence, so ply 0 *is* it.
    const result = await evaluatePosition(fakeEngine(), { fen: BLACK_TO_MOVE });
    expect(result.position.ply).toBe(0);
    expect(result.position.move_number).toBe(3);
  });

  it('carries an evaluation, a best move, and evidence', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    expect(result.evaluation).toBeDefined();
    expect(result.best).toBeDefined();
    expect(result.evidence).toBeDefined();
  });
});

describe('the best move is reported in both notations', () => {
  it('converts the engine PV from UCI into SAN', async () => {
    const result = await evaluatePosition(
      fakeEngine({ lines: [line({ pv: ['e2e4', 'e7e5', 'g1f3'] })] }),
      { fen: START_FEN },
    );

    expect(result.best?.uci).toBe('e2e4');
    expect(result.best?.san).toBe('e4');
    expect(result.best?.pv_uci).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(result.best?.pv_san).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('reports no best move when the engine returned no lines', async () => {
    // A terminal position: the engine emits `bestmove (none)` and no pv.
    const result = await evaluatePosition(fakeEngine({ lines: [], depth_reached: 0 }), {
      fen: START_FEN,
    });
    expect(result.best).toBeNull();
  });
});

describe('evidence reports the depth reached', () => {
  it('reports the depth the engine actually reached, not one that was requested', async () => {
    // The engine reached 12 under its budget. Nothing may report 20 because 20 was asked
    // for; `depth_reached` is an outcome.
    const result = await evaluatePosition(
      fakeEngine({ depth_reached: 12, lines: [line({ depth: 12 })] }),
      { fen: START_FEN },
    );

    expect(result.evidence.depth_reached).toBe(12);
  });

  it('carries engine identity, build, nodes, nps, time, and the resolved FEN', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: BLACK_TO_MOVE });

    expect(result.evidence.engine).toBe('FakeEngine');
    expect(result.evidence.engine_version).toBe('0');
    expect(result.evidence.build).toBe('fake');
    expect(result.evidence.nodes).toBe(1_234_567);
    expect(result.evidence.nps).toBe(987_654);
    expect(result.evidence.time_ms).toBe(1_250);
    expect(result.evidence.resolved_fen).toBe(BLACK_TO_MOVE);
  });
});

describe('an address selects which position of a sequence is evaluated', () => {
  it('evaluates the addressed ply rather than the final position', async () => {
    const result = await evaluatePosition(fakeEngine(), { moves: '1. e4 e5 2. Nf3', ply: 1 });

    expect(result.position.ply).toBe(1);
    expect(result.position.side_to_move).toBe('b');
    // The Evidence must be about the board that was searched, not the one at the end.
    expect(result.evidence.resolved_fen).toBe(result.position.resolved_fen);
  });

  it('evaluates the position before an addressed move', async () => {
    const result = await evaluatePosition(fakeEngine(), {
      moves: '1. e4 e5 2. Nf3',
      moveNumber: 2,
      side: 'w',
    });

    expect(result.position.ply).toBe(2);
    expect(result.position.move_number).toBe(2);
  });

  it('evaluates the final position when no address is given', async () => {
    const result = await evaluatePosition(fakeEngine(), { moves: '1. e4 e5 2. Nf3' });
    expect(result.position.ply).toBe(3);
  });
});

describe('no response field is prose', () => {
  it('contains no field an assistant could have written', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    // A summary field is the specific thing this server refuses to ship. Assert on the
    // whole payload rather than a hand-picked block, so a narrating field added anywhere
    // later trips this.
    const forbidden = ['summary', 'assessment', 'explanation', 'narrative', 'comment', 'advice'];
    const keys = allKeys(result);
    for (const name of forbidden) {
      expect(keys, `"${name}" is prose and must not be a response field`).not.toContain(name);
    }
  });

  it('ships only numbers, notation, and identity — no free-form sentences', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    // Every string in the payload is notation (FEN, SAN, UCI) or an identifier. None is
    // a sentence, and a sentence is what prose looks like structurally.
    for (const value of allStrings(result)) {
      expect(value, `"${value}" reads as prose`).not.toMatch(/\s\w+\s\w+\s\w+\s/);
    }
  });
});

function allKeys(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return found;
  for (const [key, nested] of Object.entries(value)) {
    found.push(key);
    allKeys(nested, found);
  }
  return found;
}

function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  if (value === null || typeof value !== 'object') return found;
  for (const nested of Object.values(value)) allStrings(nested, found);
  return found;
}
