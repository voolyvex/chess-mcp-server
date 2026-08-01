import { createServer } from 'node:http';
import { cachingEngine } from './cache.js';
import { createChessMcpHandler } from './mcp-handler.js';
import { DEFAULT_ENGINE_URL, httpEngineClient } from './http-engine-client.js';

const PORT = Number(process.env['PORT'] ?? 8091);
const ENGINE_URL = process.env['ENGINE_URL'] ?? DEFAULT_ENGINE_URL;

/**
 * The engine client and its cache, as a **module-level singleton** — deliberately outside
 * the per-request server the handler builds.
 *
 * The handler is stateless and mints a fresh `McpServer` per request; neither the engine
 * connection nor the cache may follow it. A per-request connection re-establishes the one
 * the container exists to keep warm, and a per-request cache is not a cache at all — it
 * would be empty on arrival and discarded on the way out, which matters here because the
 * 2026-07-28 spec dropped stream resumability: a dropped response is re-issued by the
 * client, and the cache is what makes that retry cheap.
 */
const engine = cachingEngine(httpEngineClient(ENGINE_URL));

const handler = createChessMcpHandler(() => engine);

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    void (async () => {
      try {
        const body = Buffer.concat(chunks);
        const request = new Request(`http://localhost${req.url ?? '/'}`, {
          method: req.method ?? 'GET',
          headers: req.headers as Record<string, string>,
          ...(body.length > 0 ? { body } : {}),
        });

        const response = await handler.fetch(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        // The engine being unreachable is the common case here. Say so plainly rather
        // than letting the socket hang.
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    })();
  });
});

server.listen(PORT, () => {
  console.log(`[chess-mcp] listening on :${PORT}/mcp — engine at ${ENGINE_URL}`);
});
