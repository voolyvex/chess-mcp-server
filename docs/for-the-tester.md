# Chess engine in Grok — how to use it

Everything here fits on one screen. There is nothing to install, nothing to clone, and no
setup call. If something in this document turns out to be wrong, that is worth telling me —
it means the instructions are the defect, not you.

## What this is

A Stockfish 18 engine wired into Grok as a connector. When Grok uses it, the numbers in its
answer come from a real search rather than from memory. That is the whole point: Grok on its
own can write a fluent, confident paragraph about a position it has never analysed, and you
cannot tell the difference by reading it. With the engine attached, the numbers are real.

## Setup, once

1. Go to `grok.com/connectors` (browser or app — the connector is attached to your account,
   so adding it once covers every device).
2. **New Connector → Custom.**
3. Name it whatever you like. Paste the URL I sent you separately as the Server URL.
4. Save.

That is it. There is no authentication step, no token to paste, and no password.

**If it does not connect, it may just need a restart on my end — send me a text and I will
sort it.** Nothing to troubleshoot on your side.

## Check that it actually ran — this is the important part

**Open the Thoughts panel on any answer.** If the engine was used, you will see:

> **Used Chess MCP Server Evaluate Position**

**If that line is absent, the engine was not called** — no matter how confident the answer
looks or how many decimal places it quotes.

This matters more than it sounds. Grok has its own fallback: when it cannot reach the
connector, it can install a chess engine in its own sandbox and answer from that instead,
without saying so. I have seen it happen once. The answer looked completely normal — a
ranked table, a stated depth, roughly-correct numbers — and nothing in the text revealed
that this server was never contacted.

So: **if the Thoughts line is missing, the answer is not part of the test.** Ask again, or
say "use the Chess MCP connector" explicitly. If it keeps not firing, tell me — that is
itself the most useful bug you can find.

## If you upload a game file on mobile

**Rename it from `.pgn` to `.txt` first.** The Grok app's file picker refuses `.pgn`
outright. The identical file renamed to `.txt` is accepted and works normally.

This is a limitation of the Grok app, not of the engine — the file never reaches my server
at all; Grok reads it and sends the moves. But the rejection gives no hint that renaming is
the fix, so without this note it just looks broken.

You can also paste a game as text instead. Either works.

## What it can do — examples

Use it the way you would normally analyse your own games; that is the actual test, not a
checklist. These are just to show the shapes it handles. **If it does something other than
what the right-hand column says, tell me** — that is a bug worth hearing about.

| Ask it something like | What it should do |
|---|---|
| *"Analyse this game: 1. e4 e5 2. Nf3 ..."* | Evaluate the final position |
| *"What about after move 15 for White?"* | Jump to that exact position, not the end |
| *"Was 16...f5 a mistake, and by how much?"* | Score that move specifically and give the cost in pawns |
| *"What are my options here?"* | Rank several moves, best first |
| *"Think longer on this one — 20 seconds"* | Search longer and reach a deeper result (30s is the cap) |

Two cases I am especially curious about, if you feel like it:

- **Quiet or unusual positions**, where opening theory runs out. That is where a real search
  should beat recall by the widest margin, and it is the case I have not tested.
- **A move you already suspect is bad.** It scores any legal move on its own terms, including
  terrible ones — so it can tell you exactly how much a move cost, not just that it was
  wrong.

## What to tell me

Anything, but especially:

- An answer that looked wrong, or that contradicted what you know.
- An answer with **no** Thoughts line where you expected one.
- Anything that was annoying, confusing, or slower than you expected.
- Whether it beat what you get from Grok plus Stockfish in two windows, which is what you
  do today.

Negative results are the useful ones. "This added nothing" is a finding, and I would rather
have it than a polite one.

## The caveats, stated up front

- **It may occasionally need a restart** — text me and it will be back up shortly.
- **Answers can be slow if we are both using it.** The engine handles one search at a time
  and queues the rest, so a busy moment means waiting a few extra seconds, not an error.
- **It is a beta, running a week or two.** After that the URL stops working. I will tell you
  before it does.
- **Do not share the URL.** There is no password on it — the only thing keeping it private
  is that nobody else has the address.
