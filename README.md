# chess-mcp-server

An MCP server that gives a chat assistant a (Stockfish) chess engine. Ask about a position and
get back an evaluation, the engine's best line, a ranking of the top options, and an
optional comparison against a move you are considering.

Every number in the response comes from a verified search, and ships with the
evidence for it: the engine and build that produced it, the depth reached, the node count,
and the principal variation. The server returns numbers, not sentences. Your assistant
writes the explanation.

## Requirements

Docker (for the engine) and Node 20.19 or newer.

## Quick start

```bash
docker compose up -d engine    # Stockfish 18 on :8090
npm ci
npm start                      # MCP server on :8091
```

## Connecting an assistant

The server speaks streamable HTTP MCP at `http://localhost:8091/mcp`.

Claude Code:

```bash
claude mcp add --transport http chess http://localhost:8091/mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.chess]
url = "http://localhost:8091/mcp"
```

Gemini CLI, in `~/.gemini/settings.json`:

```json
{ "mcpServers": { "chess": { "httpUrl": "http://localhost:8091/mcp" } } }
```

GitHub Copilot in VS Code, in `.vscode/mcp.json`:

```json
{ "servers": { "chess": { "type": "http", "url": "http://localhost:8091/mcp" } } }
```

Other clients follow one of these two shapes. Most want a name and a URL; the field is
usually `url`, sometimes `httpUrl`, and VS Code puts servers under `servers` rather than
`mcpServers`.

## The tool

`evaluate_position` accepts a FEN, a list of moves, a list of moves from a starting FEN, or
a full PGN. When you pass a sequence, address any position in it by `ply` or by
`move_number` plus `side`.

Options:

- `candidate` scores a specific move against the engine's choice, so you can ask "is this
  move bad?" and get an answer even when the move is terrible.
- `multipv` (1 to 5) ranks that many moves in a single search, instead of asking about
  each one separately.

A list of the position's legal moves is with every response, reducing hallucination.

## Default engine

Stockfish comes default with the project. `docker compose up` downloads a checksum-pinned
Stockfish 18 binary and wraps it in a small HTTP service, no manual install 

## Using a different engine

Any UCI engine works. The server talks to an HTTP service, and it picks up
the engine's identity at runtime, so swapping engines needs no code change.

Point `engine/Dockerfile` at a different binary and rebuild:

```dockerfile
RUN curl -fsSL -o /usr/local/bin/engine "https://example.com/your-engine" \
 && chmod 0755 /usr/local/bin/engine
ENV STOCKFISH_PATH=/usr/local/bin/engine
```

Or run your engine's HTTP service anywhere and point the server at it:

```bash
ENGINE_URL=http://localhost:8095 npm start
```


## Configuration

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8091` | Port the MCP server listens on |
| `ENGINE_URL` | `http://localhost:8090` | Where the engine service is |
| `STOCKFISH_THREADS` | `4` | Engine threads (set in `docker-compose.yml`) |
| `STOCKFISH_HASH` | `256` | Engine hash table, in MB |
| `STOCKFISH_MOVETIME` | `2000` | Default search budget, in milliseconds |

A longer search time budget reaches a deeper search;
the depth that it reached is reported.

## Troubleshooting

**`engine unreachable at http://localhost:8090`** — the engine container is not running.
Start it with `docker compose up -d engine`, and check it answers:

```bash
curl localhost:8090/health    # {"status":"ready", ...}
```

The first `docker compose up` builds the image and downloads Stockfish, so it takes a
minute or two. Until `status` reads `ready`, searches will fail.

**The assistant cannot see the tool** — check the server is up (`curl localhost:8091/mcp`
should answer, not refuse the connection), then restart the assistant. Most clients read
their MCP config only at startup.

**Port already in use** — set `PORT` for the MCP server, or change the published port in
`docker-compose.yml` for the engine and point at it with `ENGINE_URL`.

## More

- [docs/prd.md](docs/prd.md) for what it does and why
- [CONTEXT.md](CONTEXT.md) for the vocabulary
- [docs/decisions.md](docs/decisions.md) and [docs/adr/](docs/adr/) for the decisions and
  their measurements
- [docs/references.md](docs/references.md) for the PGN, FEN, SAN and UCI standards

## License

MIT
