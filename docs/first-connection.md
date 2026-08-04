# First connection: Grok over the tunnel, with and without the connector

**Date:** 2026-08-03 · **Endpoint:** `https://39a8c1c0.thymosengine.com/mcp` ·
**Tunnel:** `a869f3cd-a1ff-4215-b48d-d49744ebfa7a` · **Client:** Grok, Fast mode, operator's
own account

`deploy/README.md` calls the first connection "an instrument, not a demo" and
`docs/tunnel-handoff.md` makes it Q0, the question nothing else is learned without. This is
what it measured.

The design is a paired test: **the same prompt twice, in two fresh chats, differing only in
whether the connector was used.** One run is the control. Without it there is no way to tell
whether the connector improved the answer or merely accompanied a good one.

## The prompt

> After 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc4 4. b4 Bxb4 5. c3 where should the black bishop move to?

The second run appended: *"Use the Chess MCP connector."*

Note the prompt contains a **typo**: `3. Bc4 Bc4` should be `3. Bc4 Bc5`. Black cannot play
Bc4 — White's bishop is there. This was unintentional, and it turned into the more
interesting half of the result.

## Result: both runs answered Ba5, and that is not the finding

Both named the same move. A reader stopping there would conclude the connector changed
nothing. The difference is in **what each run could support**, and in what each did with the
malformed input.

### Run 1 — no connector

Reasoning trace: *"Evaluating the bishop retreat options / Identifying the best bishop move."*

Answered **5...Ba5**, correctly identified the Evans Gambit Accepted, and gave three
positional justifications — the bishop leaves the path of White's centre pawns, it pins the
c3-pawn, it can drop back to b6. It then surveyed 5...Be7 (Lasker/Anderssen, "played by
strong players including Anand"), 5...Bc5 ("inferior because 6.d4 gains another useful
tempo"), and 5...Bd6 (Stone-Ware).

This is a good answer. It is also **entirely unfalsifiable from the response itself.** Every
claim is recalled opening theory. The comparative ones — Bc5 is worse than Be7, Bd6 is
"awkward" — are the kind that sound identical whether they are right or invented. Nothing in
the output distinguishes the two.

It did not notice the typo.

### Run 2 — with the connector

Reasoning trace: *"Searching for available Chess MCP tools / Determining the best bishop move."*

Answered **Ba5**, and opened by **correcting the prompt**: "This is the Evans Gambit (after
the standard 3…Bc5, not 'Bc4')." It then published the FEN it had actually searched —
`r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/2P2N2/P2P1PPP/RNBQK2R b KQkq - 0 5` — and a ranked table
attributed to "Stockfish (via the Chess MCP Server, multipv 5, ~5s)":

| Rank | Move | Eval (White-relative, cp) |
|---|---|---|
| 1 | Ba5 | −29 |
| 2 | Be7 | −17 |
| 3 | Bc5 | +9 |
| 4 | Bf8 | +42 |
| 5 | Bd6 | +43 |

It closed by noting that Bxc3 and Ba3 are legal but were not among the top lines.

## Verification: the numbers are real

The claim was re-run against the handler directly, same FEN, `multipv: 5`,
`movetime_ms: 5000`:

```
1 Ba5 -29 d14
2 Be7 -17 d14
3 Bc5   9 d14
4 Bf8  42 d14
5 Bd6  43 d14
```

**Every centipawn value matches, in order, including the one-point Bf8/Bd6 gap** that no
recalled theory would produce and that a fabricator would have had no reason to invent. The
`legal_moves` array confirms the tail claim: the position has exactly seven legal bishop
moves — Ba5, Bc5, Bd6, Be7, Bf8, Bxc3, Ba3 — so Bxc3 and Ba3 are indeed the two the top five
excluded. Grok reported the tool's output faithfully and did not embellish it.

## What this actually demonstrates

**The connector's value here was not a better move. It was a recoverable answer.**

Run 1's Bc5 verdict and Run 2's Bc5 verdict happen to agree. But Run 2's `+9` is checkable —
it was checked, above — and Run 1's "inferior" is not. On a position where recalled theory
is thin or wrong, Run 1 has no error-detection mechanism at all, and its prose would read
exactly the same. That is the failure mode `CLAUDE.md` means by *every number traceable to a
search that actually happened*, observed from the client side.

**The typo is the sharper evidence.** Both runs received an illegal move sequence. The
connector run caught it, because the sequence had to survive contact with a move generator
that rejects illegal input rather than a narrative that smooths over it. This is
`ADR-0002`'s legal-moves-as-ground-truth argument arriving from an unplanned direction: the
tool corrected the human, not just the model.

**Grok drove the tool correctly without operator discipline installed.** It reached for
`multipv` for a "what are the options" question — the exact call `.claude/skills/` prescribes
and which the Grok tester cannot install (`docs/beta-readiness.md` §7). One observation is
not a pattern, but the pessimistic assumption that a filesystem-less client would misuse the
tool did not hold on first contact.

## Q0 status: answered in part

Answered:

- **End-to-end works.** Grok on the free tier reached the tunnel, called the tool, and got
  a real search back. The paired transcripts are the proof.
- **Streamable HTTP suffices.** No `endpoint`-event fix was needed. The contingent SSE work
  in `docs/tunnel-handoff.md` stays unbuilt.
- **Q3 answered: no.** Grok connected to a server declaring no authentication, and did not
  demand an OAuth flow.

**Still open, and the reason is worth recording:** the wire-level questions — which path
Grok requests, whether it opens the SSE GET, what headers it sends, and above all **what
source addresses it arrives from** — were *not* captured. The journal rotated between the
session and the log read (`systemctl status` reports "journal has been rotated since unit
was started"), taking the request records with it.

That last one has a consequence: **the IP-allowlist question from ADR-0005 remains
unanswerable.** An allowlist is the only real access control available for a connector
dialog with no headers field, and deciding whether it is viable needs xAI's egress addresses,
which are now not in hand.

Re-running this costs one prompt. Before doing so, capture the log first:

```bash
journalctl --user -u chess-tunnel.service -f | tee ~/grok-first-connect.log
```

Cloudflare's dashboard (Zero Trust → Networks → Tunnels → chess-mcp) retains request
metadata independently of the local journal and is the more durable source for the source-IP
question.

---

# The wire-level run (2026-08-04)

The first run answered the client-facing questions and lost the wire-level ones to a
journal rotation. This run captured them.

## What had to be fixed first

**The journal rotation was not the only reason the data was lost.** `cloudflared` at its
default `INF` log level **does not log individual requests at all** — only connection
lifecycle. A probe on 2026-08-04 returned HTTP 200 and left no trace in the journal. Had
the run been repeated with only the `tee` fix from the first attempt, it would have
produced the same empty result a second time.

The fix is `loglevel: debug` in `~/.cloudflared/config.yml`, verified with a marked probe
before the real run. Debug logs full request headers, which is what makes the source-IP
question answerable — and also why it is a beta-test setting rather than a permanent one.

## What Grok actually sent

Nine requests across three connect cycles, each one `initialize` (254 bytes) →
`tools/list` (54) → `tools/call` (1063, 1070, 343). Zero errors.

| Question | Answer, from the wire |
|---|---|
| **Path** | `/mcp`, every request. Never `/sse` — the placeholder in Grok's dialog was a red herring. |
| **Method** | **POST only. Zero GETs**, across all nine requests. |
| **SSE GET (Q5)** | **Answered: no.** Grok never opens the stream, though it sends `Accept: text/event-stream, application/json`. |
| **Transport** | Streamable HTTP, `Mcp-Protocol-Version: 2025-11-25`. Confirmed directly, no longer inferred from success. |
| **User-Agent** | `grok-connectors-manager/0.1.0` |
| **Auth headers** | None. No `Authorization`, no custom headers — ADR-0005's central finding, now observed rather than inferred from the dialog's two fields. |

## The IP allowlist: measured, and ruled out

**`Cf-Connecting-Ip: 35.221.25.200`.** `whois` places it in `GOOGLE-CLOUD`, Google LLC,
within `35.208.0.0/12`. xAI runs its connectors on Google Cloud.

An allowlist therefore means one of two things, and neither is access control:

- **The `/12`** — roughly a million addresses of shared public cloud. Every GCP tenant is
  inside the perimeter. This authenticates nothing.
- **The single `/32`** — brittle. Managed-cloud egress addresses rotate without notice,
  and the failure arrives as a silent 403 mid-session, indistinguishable from a bug in the
  handler.

ADR-0005 listed the allowlist as the one genuine control still available and made the beta's
defensible length conditional on it. That condition is now resolved against, and the ADR has
been amended: **the beta runs on an obscure hostname and edge rate limiting, and nothing
else.**

The `Cf-Ray` suffixes are all `-IAD` (Ashburn), one region in one session. A different
region would not rescue the allowlist — it would widen the range that needed allowing, so
further observation can only strengthen this conclusion, not reverse it.

## Caveats

- **One prompt, one position, one mode.** Fast mode only; no phone test yet, so the phone
  question in `docs/tunnel-handoff.md` is still open.
- **Both runs agreeing on Ba5 makes this a weak test of move quality** — Ba5 is heavily
  documented main-line theory, the case where recall is strongest. The connector's advantage
  should be larger on quiet or unusual positions, and that is untested.
- **The verification re-ran the search locally**, not through the tunnel, and at a different
  time than Grok's call. Matching to the centipawn across all five lines makes a coincidence
  implausible, but it is reproduction, not capture of the original response.
