# Deep analysis mode — a longer budget, opt-in and gated

**Status:** idea, not specified. Raised 2026-08-03 during #6 (the `movetime_ms` bound). No
decisions locked; this is scope to flesh out, not a plan to build from yet.

**Goal:** let a caller ask for a search longer than the default ceiling when they actually
want one — a deep post-game review, an engame study, a position worth minutes rather than
seconds — without reopening the unbounded-CPU exposure #6 closed.

---

## Where this comes from

`MAX_MOVETIME_MS = 30_000` (`src/evaluate-position.ts`) is a single global ceiling, enforced
for every caller alike. It exists because a public URL removes the locality that used to be
the only thing stopping a request from occupying the engine's threads indefinitely — see
`docs/beta-readiness.md` §4.

That ceiling is correct as a *default*. It is not obviously correct as the only option: a
30 s cap is generous for "what's the best move here" and stingy for "walk this endgame out
as deep as you can." The question is whether a caller who genuinely wants the latter should
have a way to ask, without giving that option to everyone.

---

## Shape, sketched

Not decided — the point of this doc is to have somewhere to put the shape once it exists.
Options seen so far, not yet weighed against each other:

- **A second, higher ceiling gated behind auth.** Once #7 (bearer token) lands, an
  authenticated caller could be trusted with a larger `MAX_MOVETIME_MS`, an unauthenticated
  one kept at the current default. Ties the capability to identity, which is the axis the
  security model already uses.
- **An explicit opt-in field**, separate from `movetime_ms` itself, that names a different
  budget tier rather than a bigger number in the same field. Keeps "I want the default
  ceiling raised" a distinct, visible ask from "I want a longer search," rather than one
  number doing both jobs.
- **A distinct tool-level mode**, e.g. a `mode: "deep"` argument the schema documents as
  carrying its own (higher, still bounded) ceiling and its own expectations about latency.

Whatever the shape, it should stay consistent with the two things #6 established:

1. **A budget above any stated ceiling is still refused, not clamped.** Silently shortening
   a search and reporting the depth reached as though the requested budget bought it is the
   failure this project exists to prevent, regardless of which ceiling is active.
2. **The ceiling in force must be discoverable from the schema**, not from source — same as
   `movetime_ms`'s current `.describe()`.

---

## Open questions

- Does "opt-in" mean per-request (a field on `evaluate_position`) or per-caller (tied to the
  auth token, so a given tester's connector is provisioned with a longer ceiling)? These are
  different mechanisms with different blast radii.
- What is the actual upper bound for the long mode, and on what evidence? 30 s came from
  matching the bridge's pre-existing `STOCKFISH_MAX_MOVETIME`. A deep mode's ceiling needs
  its own number, not an arbitrary multiple.
- Does a long-running search change the transport story? The handler is stateless HTTP with
  no session; `docs/decisions.md` #13 already flagged that a multi-second call pushes
  against the same limits a full-game scan would, and deferred that to the
  `io.modelcontextprotocol/tasks` extension or a minted handle rather than a bare long POST.
  A deep-analysis search in the tens-of-seconds-to-minutes range may hit the same wall.
- Interaction with the engine container's own concurrency: one engine process, 4 threads.
  Does a long search block other callers for its duration, and if so, does that change
  whether this is safe to expose at all before there is more than one engine instance to
  route to?
- Does this need its own cache treatment? The existing cache stores the deepest result per
  `(engine_id, fen, multipv)` — a deep search naturally becomes the new cached depth for that
  key, which may be exactly right or may need a separate policy (e.g. not evicting a cheap
  common position's cache entry with a long tail-position search).

---

## Non-goals, for now

Not proposing depth as an input again — `docs/decisions.md` #6 already settled that wall-
clock is the budget and depth is the outcome, for good reason (predictable latency, and
depth-to-time varies too much by position for a depth target to mean anything). A longer
mode still asks in milliseconds; it just permits a bigger number for callers who've earned
the trust to name one.
