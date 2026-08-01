import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createChessMcpHandler } from '../src/mcp-handler.js';
import { fakeEngine } from './helpers/fake-engine.js';

/**
 * Tier 1, over real HTTP: the server-to-client SSE stream at `GET /mcp`.
 *
 * The SDK answers GET with `405` under `legacy: 'stateless'` — defensible, since there is
 * no session for a stream to belong to, and invisible to clients that only POST. Clients
 * that open the stream during connection setup instead read the 405 as a failed
 * connection and show no tools, which is not a chess bug and so has no other test that
 * would catch it.
 *
 * These drive a real socket. An in-process call would skip the streaming behaviour that
 * is the entire subject: a buffered body would hang on a stream that never ends.
 */

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
        const abort = new AbortController();
        // Scoped to this exchange. `res.on('close')` would also fire when a keep-alive
        // socket is reused, aborting the *next* request to arrive on it.
        res.once('finish', () => abort.abort());
        req.once('aborted', () => abort.abort());

        const request = new Request(`http://localhost${req.url ?? '/'}`, {
          method: req.method ?? 'GET',
          headers: req.headers as Record<string, string>,
          signal: abort.signal,
          ...(body.length > 0 ? { body } : {}),
        });

        const response = await handler.fetch(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));

        if (response.body === null) {
          res.end();
          return;
        }
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done || res.writableEnded) break;
          if (value !== undefined) res.write(Buffer.from(value));
        }
        res.end();
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

describe('GET /mcp opens the server-to-client stream', () => {
  it('answers an event-stream request with 200, not 405', async () => {
    const abort = new AbortController();
    const response = await fetch(endpoint, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });

    expect(response.status).toBe(200);
    abort.abort();
  });

  it('serves it as an event stream', async () => {
    const abort = new AbortController();
    const response = await fetch(endpoint, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    abort.abort();
  });

  it('holds the stream open rather than ending it', async () => {
    // An immediately-closed stream would satisfy the status code and still fail the
    // client, which is waiting for a stream it can keep.
    const abort = new AbortController();
    const response = await fetch(endpoint, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });

    const reader = response.body!.getReader();
    const firstChunk = await reader.read();

    expect(firstChunk.done).toBe(false);
    expect(new TextDecoder().decode(firstChunk.value)).toContain(':');

    await reader.cancel();
    abort.abort();
  });

  it('sends no events, because this server never initiates a message', async () => {
    // Whatever arrives before the client hangs up must be SSE comment lines only. A
    // `data:` line here would be a message the client did not ask for.
    const abort = new AbortController();
    const response = await fetch(endpoint, {
      headers: { accept: 'text/event-stream' },
      signal: abort.signal,
    });

    const reader = response.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);

    expect(text).not.toContain('data:');
    expect(text.trimStart().startsWith(':')).toBe(true);

    await reader.cancel();
    abort.abort();
  });

  it('leaves POST alone — the tool still answers', async () => {
    // The GET path is added in front of the SDK handler, so the risk it introduces is to
    // the path that already worked.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"serverInfo"');
  });

  it('serves a client that accepts only JSON, instead of refusing it', async () => {
    // The SDK rejects these with 406 before dispatch, so `initialize` fails and the
    // client never connects. This server can serve them: it returns a single JSON body
    // for a plain exchange, which is exactly what such a client asked for.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'json-only', version: '1' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"serverInfo"');
  });

  it('serves a client that sends no Accept header at all', async () => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: '*/*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('evaluate_position');
  });

  it('lets the tool answer for a JSON-only client, not just the handshake', async () => {
    // Connecting is not the point; being able to ask a chess question is.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'evaluate_position', arguments: { moves: '1. e4' } },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('legal_moves');
  });

  it('leaves a client demanding an incompatible type to the SDK', async () => {
    // Widening exists to serve clients that asked for less than they might get, not to
    // ignore what a client asked for. One demanding XML is still refused.
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/xml' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
    });

    expect(response.status).toBe(406);
    await response.text();
  });

  it('does not hand a stream to a client that did not ask for one', async () => {
    // A plain GET is not an SSE client; answering it with an endless stream would hang
    // it. The SDK's 405 is the right answer there and must survive.
    const response = await fetch(endpoint, { method: 'GET' });
    expect(response.status).toBe(405);
    await response.text();
  });
});
