# AGENTS.md

## What this is

A stateless HTTP MCP server exposing **one tool, `evaluate_position`**, that answers chess
questions with engine evidence. The defining constraint: **every number in a response must
be traceable to a search that actually happened.** The assistant writes the prose; this
server ships numbers and their provenance, and never narrates.

**To use the tool, you need none of this file.** Analysing a position is governed by the
`chess-engine-operator` skill in `.agents/skills/`. Read that, not this. The rest of this
file is for changing the server, not operating it.

When you are changing it: domain language in `CONTEXT.md` (read before naming anything),
requirements in `docs/prd.md`, choices and their measurements in `docs/decisions.md`,
notation and protocol standards in `docs/references.md`.

## Commands

```bash
docker compose up -d engine   # Stockfish 18 (bmi2) on :8090
npm ci                        # never `npm install` — see below
npm test
npm start                     # MCP handler on :8091
```

Engine on **:8090**, MCP handler on **:8091**. Connect Codex by adding to
`~/.codex/config.toml`:

```toml
[mcp_servers.chess]
url = "http://localhost:8091/mcp"
```

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
deploy/             systemd user units, and what they assume — see deploy/README.md
.agents/skills/     operator discipline, in Codex's project-local convention
.claude/skills/     the same discipline for Claude — longer, but the four rules and
                    their measured cases must not diverge in substance
```

`AGENTS.md` and `CLAUDE.md` are both entry points, for Codex and Claude respectively. A
change to how the server is operated belongs in the skills; a change to how it is built
belongs in both entry points.

## Traps this design exists to avoid

Three, recorded where they bite: the side-to-move sign and the identity-less cache key in
`.claude/rules/engine-contract.md`, mocking the engine in a test about engine semantics in
`.claude/rules/testing.md`.
