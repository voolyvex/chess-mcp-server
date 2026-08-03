import { describe, expect, it } from 'vitest';
import type { EngineClient } from '../src/engine-client.js';
import { evaluatePosition, MAX_MOVETIME_MS } from '../src/evaluate-position.js';
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

describe('legal_moves is ground truth for the resolved position', () => {
  it('lists every legal move from the Start Position, in both notations', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    // Not asserting the engine's opinion — chess.js's, since legal_moves comes from the
    // board alone and never touches the engine. 20 is the true count from the opening
    // array: 16 pawn moves (8 single, 8 double) and 4 knight moves.
    expect(result.position.legal_moves).toHaveLength(20);
    expect(result.position.legal_moves).toContainEqual({ san: 'e4', uci: 'e2e4' });
    expect(result.position.legal_moves).toContainEqual({ san: 'Nf3', uci: 'g1f3' });
  });

  it('describes the position actually resolved, not the Start Position', async () => {
    // ply 1 is after 1. e4 — Black to move, so the list must be Black's legal moves, not
    // White's and not the Start Position's.
    const result = await evaluatePosition(fakeEngine(), { moves: '1. e4 e5 2. Nf3', ply: 1 });

    expect(result.position.legal_moves.length).toBeGreaterThan(0);
    expect(result.position.legal_moves).toContainEqual({ san: 'Nc6', uci: 'b8c6' });
    // A White move must not appear on Black's list.
    expect(result.position.legal_moves).not.toContainEqual({ san: 'd4', uci: 'd2d4' });
  });

  it('is empty on a checkmated position — the correct answer, not a missing one', async () => {
    // Fool's mate, played out to the mated position itself: 1. f3 e5 2. g4 Qh4#.
    const result = await evaluatePosition(fakeEngine(), { moves: '1. f3 e5 2. g4 Qh4#' });

    expect(result.position.legal_moves).toEqual([]);
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

/**
 * Black to move, from the standard array after `1.e4`. Used where the *side to move* is
 * the point: a Raw Score is side-to-move relative, so this is the board that makes the
 * conversion to a White-relative Evaluation observable.
 */
const BLACK_TO_MOVE_AFTER_E4 =
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

describe('multipv ranks Engine Lines without disturbing best', () => {
  it('omits engine_lines entirely when multipv was not asked for', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    // Not an empty array: a solo search produced no ranking, and an array of one would
    // invite reading it as one.
    expect(result.engine_lines).toBeNull();
    expect(result.best).not.toBeNull();
  });

  it('reports multipv 1 in the evidence when unasked, so a reader always knows', async () => {
    const result = await evaluatePosition(fakeEngine(), { fen: START_FEN });

    expect(result.evidence.multipv).toBe(1);
  });

  it('ranks the lines best-first, each with its own evaluation and depth', async () => {
    const engine = fakeEngine({
      lines: [
        line({ multipv_rank: 2, raw_score_cp: 12, depth: 19, pv: ['d2d4', 'd7d5'] }),
        line({ multipv_rank: 1, raw_score_cp: 35, depth: 20, pv: ['e2e4', 'e7e5'] }),
      ],
    });

    const result = await evaluatePosition(engine, { fen: START_FEN, multipv: 2 });

    // Sorted here, not trusted to arrive ordered: rank is what a reader indexes by.
    expect(result.engine_lines?.map((each) => each.rank)).toEqual([1, 2]);
    expect(result.engine_lines?.map((each) => each.san)).toEqual(['e4', 'd4']);
    expect(result.engine_lines?.[1]?.depth).toBe(19);
    expect(result.evidence.multipv).toBe(2);
  });

  it('populates best from rank 1 regardless of the order the engine emitted', async () => {
    const engine = fakeEngine({
      lines: [
        line({ multipv_rank: 2, pv: ['d2d4'] }),
        line({ multipv_rank: 1, pv: ['e2e4'] }),
      ],
    });

    const result = await evaluatePosition(engine, { fen: START_FEN, multipv: 2 });

    // `best` is the contract for callers that never read engine_lines at all.
    expect(result.best?.san).toBe('e4');
    expect(result.engine_lines?.[0]?.san).toBe('e4');
  });

  it('ships each line in both notations, so a renderer needs no chess library', async () => {
    const engine = fakeEngine({ lines: [line({ multipv_rank: 1, pv: ['e2e4', 'e7e5'] })] });

    const result = await evaluatePosition(engine, { fen: START_FEN, multipv: 2 });

    expect(result.engine_lines?.[0]?.uci).toBe('e2e4');
    expect(result.engine_lines?.[0]?.pv_uci).toEqual(['e2e4', 'e7e5']);
    expect(result.engine_lines?.[0]?.pv_san).toEqual(['e4', 'e5']);
  });

  it('drops a ranked slot the engine emitted with no move in it', async () => {
    const engine = fakeEngine({
      lines: [line({ multipv_rank: 1, pv: ['e2e4'] }), line({ multipv_rank: 2, pv: [] })],
    });

    const result = await evaluatePosition(engine, { fen: START_FEN, multipv: 2 });

    expect(result.engine_lines).toHaveLength(1);
  });

  it('keeps an Engine Line White-relative, like every other Evaluation', async () => {
    // Raw Scores are side-to-move relative; Black to move with a positive Raw Score is
    // a position good for *Black*, so the Evaluation must read negative.
    const engine = fakeEngine({
      lines: [line({ multipv_rank: 1, raw_score_cp: 900, pv: ['e7e5', 'g1f3'] })],
    });

    const result = await evaluatePosition(engine, { fen: BLACK_TO_MOVE_AFTER_E4, multipv: 2 });

    expect(result.engine_lines?.[0]?.evaluation.evaluation_cp).toBeLessThan(0);
  });

  it.each([0, 6, 1.5, -1])('rejects multipv %s rather than clamping it', async (multipv) => {
    // Clamping would answer a different question than the one asked, silently — the same
    // defect as an engine that guesses, one layer up.
    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, multipv }),
    ).rejects.toThrow(/multipv/);
  });
});

describe('movetimeMs is bounded, so one request cannot spend unbounded engine CPU', () => {
  /** Wraps an engine to record the budgets it was actually asked to search at. */
  function recordingEngine(): { engine: EngineClient; budgets: (number | undefined)[] } {
    const inner = fakeEngine();
    const budgets: (number | undefined)[] = [];
    return {
      budgets,
      engine: {
        engineIdentity: inner.engineIdentity.bind(inner),
        async analyze(request) {
          budgets.push(request.movetimeMs);
          return inner.analyze(request);
        },
      },
    };
  }

  it.each([MAX_MOVETIME_MS + 1, 600_000, Number.MAX_SAFE_INTEGER])(
    'rejects a %s ms budget rather than shortening it silently',
    async (movetimeMs) => {
      await expect(
        evaluatePosition(fakeEngine(), { fen: START_FEN, movetimeMs }),
      ).rejects.toThrow(/movetimeMs/);
    },
  );

  it.each([0, -1, 2.5])('rejects a %s ms budget as not a budget at all', async (movetimeMs) => {
    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, movetimeMs }),
    ).rejects.toThrow(/movetimeMs/);
  });

  it('names the bound in the error, so a caller learns the ceiling from the refusal', async () => {
    await expect(
      evaluatePosition(fakeEngine(), { fen: START_FEN, movetimeMs: MAX_MOVETIME_MS + 1 }),
    ).rejects.toThrow(String(MAX_MOVETIME_MS));
  });

  it('dispatches no search at all when the budget is refused', async () => {
    // The point of the bound is unspent CPU, not a tidy error. A rejected promise proves
    // the caller was told no; only the absence of an `analyze` call proves the engine was
    // never handed the budget in the first place.
    const { engine, budgets } = recordingEngine();

    await expect(
      evaluatePosition(engine, { fen: START_FEN, movetimeMs: 600_000 }),
    ).rejects.toThrow(/movetimeMs/);

    expect(budgets).toEqual([]);
  });

  it('dispatches no search when an over-budget request also asks for a candidate', async () => {
    // A candidate is a second search on the same budget, so this is the most expensive
    // shape a single request has. It must be refused before either search starts.
    const { engine, budgets } = recordingEngine();

    await expect(
      evaluatePosition(engine, { fen: START_FEN, candidate: 'e4', movetimeMs: 600_000 }),
    ).rejects.toThrow(/movetimeMs/);

    expect(budgets).toEqual([]);
  });

  it('passes a budget at the ceiling through untouched', async () => {
    const { engine, budgets } = recordingEngine();

    await evaluatePosition(engine, { fen: START_FEN, movetimeMs: MAX_MOVETIME_MS });

    expect(budgets).toEqual([MAX_MOVETIME_MS]);
  });

  it.each([1, 200, 2_000])('passes a %s ms budget below the ceiling through untouched', async (movetimeMs) => {
    const { engine, budgets } = recordingEngine();

    await evaluatePosition(engine, { fen: START_FEN, movetimeMs });

    expect(budgets).toEqual([movetimeMs]);
  });

  it('leaves an unspecified budget unspecified, so the engine keeps its own default', async () => {
    const { engine, budgets } = recordingEngine();

    await evaluatePosition(engine, { fen: START_FEN });

    expect(budgets).toEqual([undefined]);
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
