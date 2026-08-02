---
paths:
  - "src/**"
  - "engine/**"
---

# Engine output contract

## Raw Score is not an Evaluation

UCI reports `score cp` and `score mate` **from the side-to-move's perspective**. Measured on
Stockfish 18, depth 14, same board with only the turn changed:

| Position | Raw `score cp` |
|---|---|
| White down a queen, White to move | `-638` |
| White down a queen, Black to move | `+671` |

Read the second row as an Evaluation and you report "White is winning" while White is down
a queen.

- **Raw Score** — what the engine said, side-to-move relative.
- **Evaluation** — White-relative: positive favours White regardless of whose turn it is.

They are different quantities and **must never share a variable name**. Convert once, at the
parse boundary, and ship both plus `side_to_move` so a reader can check the conversion
rather than trust it.

## WDL carries the same trap

`wdl <win> <draw> <loss>` is also side-to-move relative. Normalizing to White-relative means
**swapping win and loss** when Black is to move — not merely negating the centipawns.

`UCI_ShowWDL` **defaults to `false`**. Set it explicitly or the field silently never appears.

## Search budget

Wall-clock is the budget, depth is the outcome — `go movetime`, then report the depth
reached. Depth targets cannot give predictable latency: at a 5s budget a middlegame reaches
depth 26 while an endgame reaches 55. Never report the depth *requested* as though it were
the depth *reached*.

## Cache key

`(engine_id, fen, multipv)`. Engine identity is part of the key: omit it and a health-check
failover serves one engine's evaluations as another's.

## Candidate Moves

Play the move, search the result, negate. Never "look for it among the top N MultiPV lines"
— that returns nothing precisely when the answer is *"yes, your move was bad"*, which is the
case the tool exists for. Report the candidate's depth separately; it comes from a different
search.
