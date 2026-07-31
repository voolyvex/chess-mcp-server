---
paths:
  - "**/*.test.ts"
  - "**/*.integration.test.ts"
---

# Testing rules

## Never mock the engine in a test about what the engine means

The prototype had **28 test files and mocked the engine in all of them**. Its sign bug
survived every one, because the fixture (`makeLines(cp = 30)`) was fed in and then asserted
to be White-relative — the test encoded the same misunderstanding as the code. Mocked
coverage is structurally incapable of catching a bug about engine semantics.

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

Adding the container to CI later is ~3 lines and a ~15s warm-cache cost. Note this is why
the engine is pinned to `bmi2`: GitHub's runner pool mixes Intel Ice Lake with AMD EPYC
Zen 3, so an AVX-512 pin would make that SIGILL on a coin flip.
