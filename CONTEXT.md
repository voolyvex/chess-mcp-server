# ChessContext

Chess intelligence exposed to a chat assistant over MCP. The defining constraint: every
claim the assistant makes about a chess position must be traceable to an engine that
actually searched it, not to the assistant's own judgement.

## Language

### Naming a position

**Start Position**:
The board state a Move Sequence begins from. Defaults to the standard initial array; a
FEN supplies a different one.
_Avoid_: initial position, root, base FEN

**Move Sequence**:
An ordered list of moves played from the Start Position. Whether it arrives as a bare
list, a numbered move list, or a full PGN is a parsing detail — all three are the same
thing.
_Avoid_: PGN, game, movetext, line

**Position**:
A Start Position plus a Move Sequence, resolved to a single board state. The unit an
Evaluation is about. Every input form the tool accepts is a front-end onto this pair.
_Avoid_: FEN, board, state

**Ply**:
A count of half-moves applied to the Start Position, 0-based — ply 0 *is* the Start
Position. Always relative to the Start Position, never to the beginning of the game, so
it carries no before/after ambiguity: ply _p_ means "after _p_ plies".
_Avoid_: half-move, index, move index

**Move Number**:
The true game move number, absolute even when the Start Position is mid-game, derived
from the Start Position's FEN rather than counted from the Move Sequence. Addressing a
Move Number resolves to the position *before* that move — the point at which the move was
a decision.
_Avoid_: turn, move index, ply

**Candidate Move**:
A legal move a player is weighing in a Position, named by the user and scored by a search
of its own. Its number is exact for any legal move, however bad — which is what answers
"was my move any good?".
_Avoid_: user move, played move, suggested move

**Engine Line**:
One variation from a ranked multi-variation search: a move, its Evaluation, and the
principal variation behind it. The engine's own ordering of what is worth considering.
A Candidate Move is what a player is weighing; an Engine Line is what the engine offers.
The two are never the same number — an Engine Line's score comes from a shared, ranked
search, a Candidate Move's from a search of that move alone — so they never share a field.
_Avoid_: top move, suggested move, multipv line, alternative

### Engine output

**Evaluation**:
An engine's assessment of a Position, in centipawns or as a forced mate distance, always
**White-relative**: positive favours White, negative favours Black, zero is balanced. The
sign never depends on whose turn it is.
_Avoid_: score, eval number, cp

**Raw Score**:
What a UCI engine actually reports, which is relative to the **side to move** — so a
winning position for Black yields a *positive* Raw Score when it is Black's turn. A Raw
Score becomes an Evaluation only by negating it when Black is to move. The two are
different quantities and must never share a variable name.
_Avoid_: cp, score_cp, engine eval

**Evidence**:
The provenance attached to an Evaluation — search depth, principal variation, engine
identity — that lets a reader tell an engine result from a plausible guess. An
Evaluation without Evidence is indistinguishable from the assistant's own opinion, which
is the failure mode this project exists to prevent.
_Avoid_: metadata, provenance, proof
