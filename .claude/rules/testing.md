---
paths:
  - "**/*.test.ts"
  - "**/*.integration.test.ts"
---

# Testing rules

## Never mock the engine in a test about what the engine means

A mock that returns `makeLines(cp = 30)` and is then asserted to be White-relative encodes
the same misunderstanding as the code it tests. It will pass across any number of test
files while the sign is inverted in all of them. Mocked coverage is structurally incapable
of catching a bug about engine semantics — only a real search can.

## Two tiers

**Tier 1 — fake engine, fast, test-first.** Input forms, ply and move-number resolution, the
silent PGN-variation drop, error rules, schema shape. The fake returns **Raw Scores** and is
typed as such, so it cannot launder the sign question.

**Tier 2 — real engine, invariants only. Never assert a number.** Assert contracts:

- Black-to-move winning position → **negative** `evaluation_cp`
- …and its White-relative WDL is loss-heavy
- mate-in-1 → mate score with the correct sign, not centipawns
- every result carries engine, version, depth, PV, resolved FEN
- budget exhaustion → returns a low reported depth, does not throw
- a cached deeper result reports its **actual** depth, not the requested one

## Where tier 2 runs

The engine-agnostic invariants run **in CI against the WASM package** — measured at 1.29s
for three genuine depth-12 searches, no Docker required. Container-path tests (budget
exhaustion, cache identity) run **locally**, skipped when the engine is unreachable.
