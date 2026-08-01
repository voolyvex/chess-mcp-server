# `legal_moves` ships on every response

**Status:** accepted

## Context

Beta testing showed the assistant proposing `Nxe4` in a position where no knight could
capture on e4. The tool caught it — `candidate` is legality-checked by chess.js and the
call errored — but only *after* the move had been named in prose. The check was post-hoc;
the claim was already made.

This is a documented failure class, not a session-specific fluke. Across LLM lineages,
illegal-move rates stay above 30% on out-of-distribution positions even for recent models,
and the cause is architectural: models lack a reliable internal board simulator, and also
fail to detect impossible positions (two kings, both sides in check). The remedy the
literature converges on is structural rather than instructional — supply the legal move
list in-context and constrain generation to it. Telling a model to "be careful" fights the
wrong mechanism, because the model is not forgetting to check; it has nothing to check
against.

## Decision

`position.legal_moves` ships on every `evaluate_position` response: every legal move from
the resolved Position, in both SAN and UCI, computed from the same `Chess` board
`resolveAddress` already builds. Empty on a terminal position, which is the correct answer
rather than a missing one.

Both notations, because `candidate` already accepts either and a model that had to convert
its own UCI guess to SAN before checking would reintroduce a hallucination step into the
verification itself.

It lives in the `position` block rather than `evidence`: it describes the board, not the
search. It is free — the board is already constructed to read `move_number` and
`side_to_move` — and it never touches the engine, so it is exact regardless of budget,
depth, or cache state.

The MCP tool description states the obligation explicitly, so it reaches the assistant at
the protocol level rather than only in a repo skill: check a move against this list before
asserting it is legal, best, or playable.

## Consequences

Every response grows by the legal move list — tens of entries in a middlegame, and the
common case is well under 100. Cheap against a multi-second search.

This is ground truth *before* generation, which is a different guarantee from the
`candidate` legality error. Both stay: the list constrains what the assistant says, the
error catches what it sends anyway.
