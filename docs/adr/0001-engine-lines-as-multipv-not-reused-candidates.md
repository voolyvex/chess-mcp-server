# Engine Lines are a MultiPV search, and never satisfy a Candidate Move

**Status:** accepted

## Context

Beta testing (`qgd-exchange-session.md`) asked for "White's top 3 moves" in a position.
`evaluate_position` has no concept of ranked alternatives, so the agent reconstructed a
top-3 table by calling the tool 4 times — once for the position, three times more with
each move as a `candidate`. The engine bridge (`engine/server.js`) already runs MultiPV=3
by default on every search; `evaluate-position.ts` was discarding ranks 2 and 3 and paying
their depth cost for nothing.

Two domain terms were conflated going in: a legal move the *engine* ranks, and a legal
move a *player* is weighing. `CONTEXT.md`'s existing "Candidate Move" entry defined the
term by authorship ("the user is asking about"), which doesn't match how chess players
use the phrase — a candidate move is any move under consideration, engine-proposed or not.

The tempting shortcut, once the engine returns ranked lines: reuse the cached rank-1
Engine Line as the answer to a Candidate Move search, when they name the same move,
skipping a redundant search. Measured against Stockfish 18 (bmi2) on this host, same
position, same 5s wall-clock budget:

| Search | Depth | Rank-1 move | Rank-1 cp |
|---|---|---|---|
| MultiPV=1 | 24 | Qc2 | +35 |
| MultiPV=1 | 25 | Qc2 | +39 |
| MultiPV=3 | 20 | Qc2 | +30 |
| MultiPV=3 | 23 | Qc2 | +39 |

MultiPV=3 reached 2-5 fewer plies than MultiPV=1 at equal wall-clock, and its rank-1 score
for the identical move did not reliably match the MultiPV=1 score at comparable depth
(+30 vs +35 at depth 20/24). This matches Stockfish's own MultiPV limitation
(official-stockfish/Stockfish#5230): MultiPV can't use the alpha-beta cutoffs a single-PV
search relies on, and "evals outside the [aspiration] window are totally unreliable" for
ranks below 1. There is no `Threads`/`Hash` tuning that closes this gap — it is an
algorithmic property of how MultiPV search works, not a configuration choice.

A later measurement on the same position, taken while writing the operator skill, shows the
effect at the rank this decision actually turns on. The move `a3`, 4s budget both ways:

| Asked as | Score | Depth |
|---|---|---|
| Engine Line, rank 3 | +28 | 10 |
| Candidate Move (dedicated search) | +37 | 19 |

Nine centipawns and nine plies apart, for the same move in the same position. Read from the
ranking, `a3` looks like a distinctly third-best option; searched on its own terms it is
1 cp behind best. The rank-1 rows above understate the problem, because rank 1 is the line
MultiPV searches *most* like a solo search — the divergence grows as rank falls, which is
precisely where a substitution would be tempting.

## Decision

Two domain terms, not one:

- **Candidate Move** — a move a player is weighing, named by the user, always scored by
  its own dedicated MultiPV=1 search (unchanged from today — D#19, play-and-search).
- **Engine Line** — one ranked variation from a MultiPV search: a move, its Evaluation,
  and the PV behind it. The engine's own ordering, not a player's selection.

They never share an output field, and an Engine Line is never substituted for a Candidate
Move's search, even on an exact move match with a cached Engine Line at sufficient depth.
The measurement above is why: the numbers are not interchangeable, so reusing one as the
other would reintroduce the sign-bug failure class this project exists to prevent — a
number in the response that isn't traceable to the search it claims to be from.

`evaluate_position` gains a `multipv` input (1-5). When `multipv > 1`, the response gains
an `engine_lines` array (rank, Evaluation, PV) alongside the unchanged `best`, which always
reflects rank 1 of whatever search ran. `evidence.multipv` ships on every response
(default 1), so a reader can tell a single-line search from a multi-line one — otherwise
two depth-20 results for the same position could silently disagree with no way to tell why.

## Consequences

"What are White's top 3 moves" becomes one call instead of four. A `multipv > 1` search
is measurably shallower than a `multipv = 1` search at the same wall-clock budget, so a
Candidate Move check remains the only way to get an exact number for a specific move —
Engine Lines answer "what does the engine suggest," not "was my move good."
