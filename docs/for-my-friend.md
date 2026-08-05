# Chess engine in Grok — how to use it

Everything here fits on one screen. Nothing to install, nothing to clone, no setup call.
Use it however you like and for as long as it is useful — there is nothing you need to
report back and no checklist to work through. If anything here turns out to be wrong, tell
me and I will fix the note.

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

## How to tell the numbers are real

Worth knowing, because it is the whole value of this and you cannot spot it by reading.

**Open the Thoughts panel on any answer.** If the engine was used, you will see:

> **Used Chess MCP Server Evaluate Position**

**If that line is absent, the engine was not called** — however confident the answer looks
or however many decimal places it quotes.

Grok has a fallback: when it cannot reach the connector, it can quietly install its own
chess engine and answer from that instead. I have seen it happen once. The answer looked
completely normal — a ranked table, a stated depth, roughly-correct numbers — and nothing in
the text gave away that no real search had happened.

So if the line is missing and you care about that particular answer, ask again or say "use
the Chess MCP connector" explicitly. If it keeps not firing, text me.

## If you upload a game file on mobile

**Rename it from `.pgn` to `.txt` first.** The Grok app's file picker refuses `.pgn`
outright. The identical file renamed to `.txt` is accepted and works normally.

This is a limitation of the Grok app, not of the engine — the file never reaches my server
at all; Grok reads it and sends the moves. But the rejection gives no hint that renaming is
the fix, so without this note it just looks broken.

You can also paste a game as text instead. Either works.

## What it can do

Just ask in plain English — these are only to show the range.

| Ask it something like | What you get |
|---|---|
| *"Analyse this game: 1. e4 e5 2. Nf3 ..."* | An evaluation of the final position |
| *"What about after move 15 for White?"* | That exact position, not the end of the game |
| *"Was 16...f5 a mistake, and by how much?"* | That move scored specifically, and what it cost in pawns |
| *"What are my options here?"* | Several moves ranked, best first |
| *"Think longer on this one — 20 seconds"* | A deeper search (30s is the cap) |

The third row is the one people tend not to guess. It scores **any** legal move on its own
terms, including bad ones — so instead of "that was inaccurate," you get the exact cost of
the move you actually played versus the one you should have. Most engine interfaces make you
work to get that.

Where it should beat working from memory by the widest margin is **quiet or unusual
positions**, once opening theory runs out. That is also the case I know least about.

## If you feel like saying anything

No obligation — I can see most of what goes wrong from my end anyway. But if something
strikes you, I would genuinely like to hear it: an answer that looked wrong, something that
was annoying or slower than expected, or whether this actually beats having Grok and
Stockfish open in two windows.

"This added nothing" is a completely fine thing to tell me, and more useful than a polite
version of it.

## Worth knowing up front

- **It may occasionally need a restart** — text me and it will be back up shortly.
- **Answers can be slow if we are both using it.** The engine handles one search at a time
  and queues the rest, so a busy moment means waiting a few extra seconds, not an error.
- **This is early days, and the URL will change at some point.** I will give you the new one
  — just do not be surprised when the current one stops answering.
- **Keep the URL to yourself.** There is no password on it; the only thing keeping it private
  is that nobody else has the address.
