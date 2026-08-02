# This server searches; other tools know things; the agent composes them

**Status:** accepted

## Context

Beta testing raised two features that both felt in scope and neither of which is:

- **A chessboard UI.** Reading `Qc2 +35 depth 24` as text is worse than seeing the position
  with an arrow on it. Options floated were a plugin, or plugging an agent session into the
  user's own full-stack project `chess-wiz`.
- **A database cross-check.** Engine-best is not the same as known theory. In the beta
  transcript the assistant suggested `10...Nxg3` and floated `10...g4`/`10...Bxc3+`; a
  database might have surfaced `10...Bg4`, believed to be a published repertoire
  recommendation. The engine had no way to raise it, because "what has been played here"
  is not a question search can answer.

Both are real. Neither is a defect in `evaluate_position`, and the recurring difficulty in
discussing them was that they kept being framed as features of this repo.

The reframing that resolved it: **this server is not the product.** It is one component of
an agent-centered chess analysis ecosystem. A rendering surface, a position database, and a
FEN→annotation service (ADR-0003) are *sibling components*, not fields in this response.

This generalizes ADR-0003. That decision ruled on annotation specifically — separate tool,
own provenance, never a field here. The same reasoning applies unchanged to every other
kind of chess knowledge, which makes it a composition rule rather than a one-off ruling.

## Decision

**This server searches. Other tools know things. The agent composes them.**

Anything that answers a question search cannot answer — what has been played here, what a
master would say about it, what it looks like — is a **separate component with its own
provenance**, addressed by the agent, never called by this server and never a field in an
`evaluate_position` response.

The three kinds of claim ADR-0003 named — engine evidence, learned annotation, assistant
reasoning — extend to a fourth, recorded fact from a database. Distinct sources, distinct
tools, so a reader can always tell which one they hold. The PRD already reaches the same
conclusion from two directions: "opening theory" sits in non-goals under *porting the
prototype*, and *persistence* is a non-goal in its own right.

Dispositions for the two features raised:

- **UI is a rendering consumer of the existing response shape**, not a component this
  server knows about. No change is required to enable it: `best` ships `san` and `uci`, the
  principal variation ships as both `pv_san` and `pv_uci`, and `position.legal_moves`
  (ADR-0002) ships in both notations. A renderer can draw the position, the best-move
  arrow, and the full PV without owning a chess library or re-deriving the board. That dual
  notation was not added for renderers — UCI is what the engine said and SAN is what a
  human reads, so provenance demanded it anyway — but it is what makes the seam free.
- **Database cross-check is a separate MCP tool**, on the ADR-0003 pattern. Lichess's
  opening API is the obvious start; serious users would want their own ChessBase/Fritz
  databases, whose `.cbh` format is proprietary. Large feature, its own repo, its own
  cadence.

Ecosystem architecture is designed in its own session, after v1 ships. This ADR records the
composition rule and the dispositions; it deliberately does not design the ecosystem.

## Consequences

Two things this rules out inside this repo, both of which look like foresight and are not:

- **Extension points for consumers that do not exist.** Plugin slots, a `sources` array
  with one element, a `provider` field that is always `"stockfish"`. The seam that survives
  is the tool contract; scaffolding for imagined callers is speculative generality.
- **Making the server aware it is part of something.** A field hinting that a database
  might also have an opinion, or a handle format presuming a session that outlives the
  call, would break statelessness for a design that does not exist yet.

The cost is the one ADR-0003 already named: a pure operator cannot tell which questions are
interesting, and until a database tool exists, sidelines the engine does not rank stay
invisible. That is a known gap with a known owner, not an argument for widening this
server.

Building the ecosystem before this component is finished would repeat the prototype's
failure precisely — it shipped 13 tools with nothing consuming them. Server first.
