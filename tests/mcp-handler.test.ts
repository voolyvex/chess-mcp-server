import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createChessMcpHandler } from '../src/mcp-handler.js';
import { fakeEngine } from './helpers/fake-engine.js';

/**
 * Tier 1, over real HTTP.
 *
 * The criterion is "`claude mcp add --transport http` connects, and the one tool is
 * discoverable" — so these drive an actual socket rather than calling the handler's
 * internals. What a real client exercises (transport, the 2025-era legacy shim, the
 * JSON-RPC envelope) is exactly what an in-process call would skip.
 */

const PROTOCOL_VERSION = '2026-07-28';
/** What a 2025-era client sends. The legacy shim exists for these. */
const LEGACY_PROTOCOL_VERSION = '2025-06-18';

let server: Server;
let endpoint: string;

beforeAll(async () => {
  const handler = createChessMcpHandler(() => fakeEngine());

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const body = Buffer.concat(chunks);
        const request = new Request(`http://localhost${req.url ?? '/'}`, {
          method: req.method ?? 'GET',
          headers: req.headers as Record<string, string>,
          ...(body.length > 0 ? { body } : {}),
        });
        const response = await handler.fetch(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      })();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  endpoint = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Reads the JSON-RPC body whether it arrived as JSON or as an SSE data frame. */
async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const payload = text.startsWith('event:') || text.startsWith('data:')
    ? (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5).trim()
    : text;
  return JSON.parse(payload) as Record<string, unknown>;
}

/**
 * One 2026-07-28 exchange. There is no `initialize` handshake in this revision: each
 * request is self-describing, carrying the client envelope in `params._meta` and
 * mirroring its routing in `Mcp-Method` / `Mcp-Name` headers. The handler rejects a
 * request whose headers and body disagree, which is what makes it safe to serve
 * statelessly.
 */
async function rpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const name = params['name'];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      'mcp-method': method,
      ...(typeof name === 'string' ? { 'mcp-name': name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });

  return readBody(response);
}

/** One 2025-era exchange, in the shape a client of that revision actually sends. */
async function legacyRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  return readBody(response);
}

describe('the handler serves MCP over HTTP', () => {
  it('identifies itself as the chess server', async () => {
    const body = await rpc('tools/list');
    const meta = (body['result'] as Record<string, unknown>)['_meta'] as
      | Record<string, unknown>
      | undefined;
    const serverInfo = meta?.['io.modelcontextprotocol/serverInfo'] as
      | Record<string, unknown>
      | undefined;

    expect(body['error']).toBeUndefined();
    expect(serverInfo?.['name']).toBe('chess');
  });

  it('still serves 2025-era clients through the legacy shim', async () => {
    // The v2 SDK's `legacy: 'stateless'` shim is load-bearing: Claude client support for
    // the 2026-07-28 spec is still rolling out, so shipping without it strands clients.
    // Those clients open with an `initialize` handshake, which the modern revision drops.
    const body = await legacyRpc('initialize', {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'legacy-client', version: '0' },
    });

    const result = body['result'] as Record<string, unknown> | undefined;

    expect(body['error']).toBeUndefined();
    expect(result?.['protocolVersion']).toBe(LEGACY_PROTOCOL_VERSION);
    expect((result?.['serverInfo'] as Record<string, unknown>)['name']).toBe('chess');
  });
});

describe('one tool is discoverable', () => {
  it('lists evaluate_position, and nothing else', async () => {
    const body = await rpc('tools/list');
    const tools = (body['result'] as { tools: Array<{ name: string }> }).tools;

    // "One tool" is a product decision (D#13), so assert the count, not merely that
    // `evaluate_position` is present.
    expect(tools.map((tool) => tool.name)).toEqual(['evaluate_position']);
  });

  it('advertises a schema accepting a FEN', async () => {
    const body = await rpc('tools/list');
    const tools = (body['result'] as { tools: Array<Record<string, unknown>> }).tools;
    const schema = tools[0]?.['inputSchema'] as { properties?: Record<string, unknown> };

    expect(schema.properties).toHaveProperty('fen');
  });
});

describe('calling the tool returns an auditable Evaluation', () => {
  it('answers a bare FEN with position, evaluation, best, and evidence', async () => {
    const body = await rpc('tools/call', {
      name: 'evaluate_position',
      arguments: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    });

    const result = body['result'] as { structuredContent?: Record<string, unknown> };
    const payload = result.structuredContent;

    expect(payload).toBeDefined();
    expect(payload).toHaveProperty('position');
    expect(payload).toHaveProperty('evaluation');
    expect(payload).toHaveProperty('best');
    expect(payload).toHaveProperty('evidence');
  });

  it('rejects a FEN that is not a legal position rather than evaluating something else', async () => {
    // A schema that guesses is the same defect as an engine that guesses, one layer up.
    const body = await rpc('tools/call', {
      name: 'evaluate_position',
      arguments: { fen: 'not-a-fen' },
    });

    const result = body['result'] as { isError?: boolean } | undefined;
    expect(result?.isError ?? body['error'] !== undefined).toBe(true);
  });
});
