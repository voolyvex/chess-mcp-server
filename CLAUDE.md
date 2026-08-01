# CLAUDE.md

## What this is

A stateless HTTP MCP server exposing **one tool, `evaluate_position`**, that answers chess
questions with engine evidence. The defining constraint: **every number in a response must
be traceable to a search that actually happened.** The assistant writes the prose; this
server ships numbers and their provenance, and never narrates.

Requirements: `docs/prd.md`. Domain language: `CONTEXT.md`. Why each choice was made,
with measurements: `docs/decisions.md`. Notation and protocol standards: `docs/references.md`.

## Status

`evaluate_position` answers a bare FEN or a Move Sequence with an Evaluation, its Evidence,
the Position's legal moves, and optionally a scored Candidate Move or a ranking of Engine
Lines, addressed by ply or by move number, with every ambiguous input erroring, and repeated
questions served from an engine-keyed LRU cache. Operator discipline ships as a repo skill,
`.claude/skills/chess-engine-operator/` (ADR-0003), versioned with the schema it describes.

**v1 is complete** (tickets 03–10). Latency is measured and recorded in `docs/prd.md` §8,
and the prototype in `legacy/` has been deleted — the authoritative copy of it remains at
`github.com/voolyvex/chess-context`. Next work is the ecosystem components ADR-0004 defers:
a rendering surface and a position database, each its own repo, designed after this one
shipped.

## Commands

```bash
docker compose up -d engine   # Stockfish 18 (bmi2) on :8090
npm ci                        # never `npm install` — see below
npm test
npm start                     # MCP handler on :8091
```

Engine on **:8090**, MCP handler on **:8091**. Connect with:
`claude mcp add --transport http chess http://localhost:8091/mcp`

## Non-negotiables

- **`npm ci`, never `npm install`.** Pinning the engine by checksum while JS dependencies
  float on every run is a pin with a hole in it.
- **No prose in tool output.** No `"White is better (+3.71)"` summary field. If a response
  field could have been invented by an assistant, it does not belong in the response.
- **Ambiguous input errors — it never resolves silently.** A schema that guesses is the
  same defect as an engine that guesses, one layer up.
- **Wall-clock is the budget; depth is the outcome.** Report the depth actually reached,
  never the depth requested.

## Layout

```
CONTEXT.md          domain glossary — read before naming anything
docs/               prd.md · decisions.md · references.md
docs/adr/           one architecture decision per file, with its measurements
engine/             Stockfish container: Dockerfile (pinned) + HTTP-to-UCI bridge
src/                the stateless MCP handler
.claude/skills/     operator discipline, versioned with the schema it describes
```

## Relationship to `chess-context`

`github.com/voolyvex/chess-context` is a **fork of `rutvij26/chess-context`** and is the
prototype this replaces — 13 stdio tools, nothing consuming them. Its conventions, issue
numbers, and Windows paths are inherited from upstream, not authoritative here.

The port is done and the local `legacy/` reference copy is deleted; that repo is now the
only copy and is **reference, not a dependency**. Nothing here should grow a use for it.
What it got wrong is recorded where it is useful — the sign bug and the identity-less cache
key in `docs/decisions.md`, the mocking failure in `.claude/rules/testing.md`.
