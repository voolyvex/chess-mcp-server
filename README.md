# chess-mcp-server

A stateless MCP server that gives a chat assistant the power of a chess engine — where
**every number in the answer is traceable to a search that actually happened.**

Ask about a position and get back an evaluation, the engine's best line, and an optional
comparison against a move you're considering. The response is numbers and provenance —
depth reached, engine build, node count, principal variation — and no prose. The assistant
writes the prose; the server never narrates. That's the point: an evaluation without
evidence is indistinguishable from a fluent guess.

## Status

v1. `evaluate_position` is implemented, tested, and measured; the prototype it replaces has
been retired. See [CLAUDE.md](CLAUDE.md) for the current shape and
[docs/adr/](docs/adr/) for the decisions behind it.

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
PGN. Address any position in the sequence by `ply` or by `move_number` + `side`. Pass a
`candidate` move to find out how it compares to the engine's choice, or `multipv` (1–5) to
rank several options in one search. Every response carries the position's `legal_moves`, so
a move can be checked before it is claimed.

Scores are **White-relative**: positive favours White regardless of whose turn it is. The
side-to-move-relative number the engine actually emitted ships alongside, so the conversion
is auditable.

Operator discipline — read the depth before trusting a number, never name a move no search
touched — ships as a skill in
[`.claude/skills/chess-engine-operator/`](.claude/skills/chess-engine-operator/SKILL.md),
versioned with the schema it describes.

Replaces the 13-tool stdio prototype at
[voolyvex/chess-context](https://github.com/voolyvex/chess-context).

## License

MIT
