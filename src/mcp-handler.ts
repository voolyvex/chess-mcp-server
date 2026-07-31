import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { EngineClient } from './engine-client.js';
import { evaluatePosition } from './evaluate-position.js';

/** How the tool is addressed. One tool, named for the question it answers. */
export const TOOL_NAME = 'evaluate_position';

const inputSchema = z.object({
  fen: z
    .string()
    .optional()
    .describe('Start Position as a FEN. Defaults to the standard initial array.'),
  moves: z
    .string()
    .optional()
    .describe(
      'A Move Sequence: a bare move list ("e4 e5 Nf3"), a numbered move list ' +
        '("1. e4 e5"), or a full PGN with headers and annotations. A [FEN] header ' +
        'supplies the Start Position. Without an address, the final position is evaluated.',
    ),
  ply: z
    .number()
    .int()
    .optional()
    .describe(
      'Which position to evaluate: half-moves applied to the Start Position, 0-based. ' +
        'Ply 0 is the Start Position itself. Ply reaches every position including the ' +
        'final one. Cannot be combined with move_number.',
    ),
  move_number: z
    .number()
    .int()
    .optional()
    .describe(
      'Which position to evaluate, named by the move about to be played: the true game ' +
        'move number, absolute even when the Start Position is mid-game. Resolves to the ' +
        'position BEFORE that move, and requires side. Cannot name the final position of ' +
        'a sequence — use ply for that.',
    ),
  side: z
    .enum(['w', 'b'])
    .optional()
    .describe('Which half of move_number. Required with move_number, and meaningless without it.'),
  candidate: z
    .string()
    .optional()
    .describe(
      'A move to score on its own terms, in SAN ("Bxh6") or UCI ("c1h6"). It is played ' +
        'and the resulting position searched, so any legal move gets an exact evaluation ' +
        'regardless of quality.',
    ),
  movetime_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Wall-clock search budget in milliseconds. Depth is an outcome, not an input.'),
});

/**
 * Builds the HTTP handler for the chess MCP server.
 *
 * The handler is **stateless**: a fresh `McpServer` is built per request and holds
 * nothing between them. The engine client is *not* built here — it is passed in as an
 * accessor so the caller can own it as a module-level singleton. Building it per request
 * would re-establish the engine connection on every call, which is the cost the
 * container exists to avoid.
 */
export function createChessMcpHandler(engine: () => EngineClient): ReturnType<typeof createMcpHandler> {
  return createMcpHandler(
    () => {
      const server = new McpServer({ name: 'chess', version: '0.1.0' });

      server.registerTool(
        TOOL_NAME,
        {
          title: 'Evaluate a chess position',
          description:
            'Search a chess position with an engine and return the evaluation with the ' +
            'evidence that produced it. Scores are White-relative: positive favours ' +
            'White regardless of whose turn it is. Returns numbers only — no prose.',
          inputSchema,
        },
        async (args) => {
          const result = await evaluatePosition(engine(), {
            ...(args.fen === undefined ? {} : { fen: args.fen }),
            ...(args.moves === undefined ? {} : { moves: args.moves }),
            ...(args.ply === undefined ? {} : { ply: args.ply }),
            ...(args.move_number === undefined ? {} : { moveNumber: args.move_number }),
            ...(args.side === undefined ? {} : { side: args.side }),
            ...(args.candidate === undefined ? {} : { candidate: args.candidate }),
            ...(args.movetime_ms === undefined ? {} : { movetimeMs: args.movetime_ms }),
          });

          return {
            // The payload is the structured block. The text content is the same JSON, not
            // a summary of it — a narrated `content` field would reintroduce exactly the
            // prose this server refuses to ship.
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            structuredContent: result as unknown as Record<string, unknown>,
          };
        },
      );

      return server;
    },
    {
      // Claude client support for the 2026-07-28 spec is still rolling out, so serving
      // 2025-era traffic is load-bearing rather than politeness.
      legacy: 'stateless',
    },
  );
}
