# chess-mcp-server

A stateless MCP server that gives a chat assistant the power of a chess engine — where
**every number in the answer is traceable to a search that actually happened.**

Ask about a position and get back an evaluation, the engine's best line, and an optional
comparison against a move you're considering. The response is numbers and provenance —
depth reached, engine build, node count, principal variation — and no prose. The assistant
writes the prose; the server never narrates. That's the point: an evaluation without
evidence is indistinguishable from a fluent guess.

## Status

In beta. `evaluate_position` is implemented and tested; see [CLAUDE.md](CLAUDE.md) for
what's left before `legacy/` is retired.

- **[docs/prd.md](docs/prd.md)** — what it does and why
- **[CONTEXT.md](CONTEXT.md)** — domain glossary
- **[docs/decisions.md](docs/decisions.md)** — 19 decisions, each with the measurement behind it
- **[docs/references.md](docs/references.md)** — PGN, FEN, SAN, UCI standards

## Quick start

```bash
docker compose up -d engine    # Stockfish 18 (bmi2, checksum-pinned) on :8090
npm ci                         # never `npm install` — see CLAUDE.md
npm test
npm start                      # MCP handler on :8091

claude mcp add --transport http chess http://localhost:8091/mcp
```

## The tool

`evaluate_position` — accepts a FEN, a move list, a move list from a given FEN, or a full
PGN. Address any position in the sequence by `ply` or by `move_number` + `color`. Pass a
`candidate` move to find out how it compares to the engine's choice.

Replaces the 13-tool stdio prototype at
[voolyvex/chess-context](https://github.com/voolyvex/chess-context).

## License

MIT
