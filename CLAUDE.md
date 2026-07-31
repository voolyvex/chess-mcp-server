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
and optionally a scored Candidate Move, addressed by ply or by move number, with every
ambiguous input erroring, and repeated questions served from an engine-keyed LRU cache
(tickets 03–09). Remaining: ship and retire `legacy/` — see
`.scratch/evaluate-position-v1/issues/`.

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
engine/             Stockfish container: Dockerfile (pinned) + HTTP-to-UCI bridge
src/                the stateless MCP handler
legacy/             gitignored reference copy of the superseded prototype
```

## Relationship to `chess-context`

`github.com/voolyvex/chess-context` is a **fork of `rutvij26/chess-context`** and is the
prototype this replaces — 13 stdio tools, nothing consuming them. Its conventions, issue
numbers, and Windows paths are inherited from upstream, not authoritative here. Port only
what proves worth porting, then delete `legacy/`.
