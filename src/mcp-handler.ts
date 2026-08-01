import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { EngineClient } from './engine-client.js';
import { evaluatePosition, MAX_MULTIPV } from './evaluate-position.js';

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
  multipv: z
    .number()
    .int()
    .min(1)
    .max(MAX_MULTIPV)
    .optional()
    .describe(
      'How many Engine Lines to rank, 1-5. Above 1 the response carries engine_lines, ' +
        'ranked best-first. Prefer one multipv call to N candidate calls when asking ' +
        '"what are the options" — but an Engine Line is scored against its rivals in a ' +
        'narrowed window, so its number is not a Candidate Move\'s dedicated search and ' +
        'must never be quoted as one. Costs depth: a ranked search widens instead of ' +
        'deepening on the same clock.',
    ),
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
  const handler = createMcpHandlerFor(engine);

  return {
    ...handler,
    /**
     * `GET /mcp` opens the server-to-client SSE stream the streamable HTTP transport
     * describes, in front of the SDK handler.
     *
     * The SDK answers GET with `405` by design: under `legacy: 'stateless'` there is no
     * session for a stream to belong to, so it treats GET as a 2025-era session operation
     * it does not implement. That is defensible, and clients that only POST — Claude Code
     * among them — never notice.
     *
     * Others open this stream during connection setup and take the 405 as a failed
     * connection, showing no tools at all. Nothing is lost by answering it: this server
     * never initiates a message to the client, so the correct stream is simply an open,
     * empty one. It is held open with comment-line keep-alives, and carries no session id
     * because there is no session — which is what being stateless means, not a gap in it.
     *
     * Everything else still goes to the SDK, including POST and the DELETE that ends a
     * session it never issued.
     */
    fetch: async (request: Request): Promise<Response> => {
      if (request.method.toUpperCase() !== 'GET') return handler.fetch(request);

      // Only a client asking for the event stream gets one. A bare GET from a browser or
      // a health check is not an SSE client, and answering it with a stream that never
      // ends would hang it.
      if (!(request.headers.get('accept') ?? '').includes('text/event-stream')) {
        return handler.fetch(request);
      }

      return sseKeepAliveStream(request);
    },
  };
}

/**
 * How often a comment line is sent to keep the stream from being reaped.
 *
 * An idle connection is closed by intermediaries and by some clients; this server has
 * nothing to say on the stream, so without traffic every stream would be idle by
 * definition. A comment line is the SSE no-op — clients ignore it, and it resets the clock.
 */
const SSE_KEEPALIVE_MS = 15_000;

/**
 * An open, empty SSE stream that stays open.
 *
 * It carries no events because this server never initiates a message to the client. Its
 * value is entirely in existing: a client that requires the stream can finish connecting.
 */
function sseKeepAliveStream(request: Request): Response {
  let timer: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      // An initial comment flushes headers, so the client sees the stream open now rather
      // than on the first keep-alive.
      controller.enqueue(encoder.encode(': open\n\n'));

      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          // The client vanished between the abort signal and this tick. Nothing to
          // report — stopping the timer is the whole remedy.
          clearInterval(timer);
        }
      }, SSE_KEEPALIVE_MS);

      // The client hanging up is the normal end of this stream, not a failure.
      request.signal.addEventListener('abort', () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime tearing down the request.
        }
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Proxies that buffer would defeat the point of a stream whose only content is
      // liveness.
      'x-accel-buffering': 'no',
    },
  });
}

/** The SDK handler, with the tool registered on a fresh server per request. */
function createMcpHandlerFor(engine: () => EngineClient): ReturnType<typeof createMcpHandler> {
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
            'White regardless of whose turn it is. Returns numbers only — no prose. ' +
            'The response always includes legal_moves for the resolved position: check a ' +
            'move against this list before asserting it is legal, best, or playable — do ' +
            'not rely on your own board simulation, which is an unreliable substitute.',
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
            ...(args.multipv === undefined ? {} : { multipv: args.multipv }),
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
