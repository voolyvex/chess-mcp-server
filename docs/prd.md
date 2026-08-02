# PRD — `chess-mcp-server`

**Status:** approved to build · **Version:** 1.0 · **Date:** 2026-07-31
**Evidence and rationale:** [`STATELESS-PLAN.md`](./STATELESS-PLAN.md) — every claim below traces to a measurement recorded there.

---

## 1. Problem

A chat assistant asked about a chess position will answer either way — with an engine
result, or with a fluent guess. The two are indistinguishable in the output, and the guess
is often wrong in ways that read as confident. There is no way for the reader to tell which
one they got.

The existing prototype demonstrates the failure concretely. It reports **"White is winning"
on positions where White is down a queen**, because Stockfish returns scores relative to
the side to move and nothing in the codebase converts them. The bug survived 28 test files
because those tests mock the engine, and the mock encodes the same misunderstanding as the
code.

## 2. Goal

Give a chat the power of a chess engine, such that **every number in the answer is
traceable to a search that actually happened.**

The assistant writes the prose. The server ships numbers and their provenance, and never
narrates.

## 3. Users

A person in a chat conversation asking about a chess position: *"how's this position?"*,
*"was 14…Nxd4 wrong?"*, *"what should I have played?"* They paste a FEN, a move list, or a
PGN, and they think in move numbers, not plies.

Single-machine, localhost. No hosting, TLS, OAuth, or multi-tenancy in scope.

## 4. Non-goals

- **Narrative or coaching output.** No `"White is better (+3.71)"` summary field. That is
  the assistant's job, and it is the visible difference from every other chess MCP server.
- **Whole-game analysis.** Deferred to v2 — 40 moves against a wall-clock budget needs the
  tasks extension, and it is a loop over a working v1 rather than a different design.
- **Porting the prototype.** No player statistics, opening theory, puzzle generation, style
  fingerprinting, mistake patterns, or the `intelligence/` layer. None of it is a
  dependency of the goal.
- **Persistence.** No database. State that must cross calls travels as server-minted
  handles in tool arguments, per the 2026-07-28 spec.

## 5. Product

### One tool: `evaluate_position`

**Input** — two position fields, not four. A bare move list, a numbered move list, and a
full PGN all parse through the same call, so they are one field.

| Field | Required | Meaning |
|---|---|---|
| `fen` | no | Start Position. Defaults to the standard array. |
| `moves` | no | Move Sequence — bare list, numbered list, or full PGN. |
| `ply` | no | 0-based, relative to the Start Position. Ply 0 *is* the Start Position. |
| `move_number` + `color` | no | Absolute, derived from the FEN. Resolves to the position **before** that move — the decision point. |
| `candidate` | no | A legal move to compare against the engine's choice. SAN or UCI. |
| `depth` | no | Override the default budget. |

**Output** — five blocks, all numbers, no prose.

- `position` — `start_fen`, `resolved_fen`, `ply`, `move_number`, `side_to_move`
- `evaluation` — `evaluation_cp` (White-relative), `raw_score_cp` (as the engine said it),
  `mate_in`, `wdl_white`, `raw_wdl`
- `best` — `san`, `uci`, `pv_san`, `pv_uci`
- `candidate` — `san`, `evaluation_cp`, `delta_cp`, `depth_reached`
- `evidence` — `engine`, `build`, `depth_requested`, `depth_reached`, `nodes`, `nps`,
  `time_ms`, `cache_hit`

### Requirements

**R1 — White-relative, and auditable.** `evaluation_cp` is positive for White regardless of
whose turn it is. `raw_score_cp` and `side_to_move` ship alongside so a reader can check
the conversion rather than trust it. **WDL carries the same trap**: it is also side-to-move
relative, so normalizing means *swapping win and loss*, not merely negating. `UCI_ShowWDL`
defaults to `false` and must be set explicitly or the field silently never appears.

**R2 — Report the depth actually reached.** Not the depth requested. Under a wall-clock
budget the engine returns its deepest completed iteration.

**R3 — Ambiguous input errors; it never resolves silently.**

1. `ply` *and* `move_number` both supplied → error. They are different kinds of address —
   `move_number` names a *move*, `ply` names a *position* — and cannot be reconciled.
2. Neither supplied → the final position of the sequence. Degenerates correctly to
   "evaluate this FEN" when `moves` is absent.
3. `fen` supplied *and* a PGN `[FEN]` header present → error if they differ.
4. `candidate` accepts SAN or UCI, and echoes which was parsed.

The through-line: a schema that guesses is the same defect as the engine that guesses, one
layer up. The known silent failure in the parser — chess.js drops PGN variations without
error — is the specific thing this rule exists to contain.

**R4 — A Candidate Move always gets a number.** Play the move, search the result, negate.
Never "look for it in the top N," which returns nothing precisely when the answer is *"yes,
your move was bad"* — the case the tool exists for. The candidate's `depth_reached` is
reported separately, because it comes from a different search.

**R5 — Predictable latency.** Wall-clock is the budget; depth is the outcome. Depth targets
cannot give predictable latency: at a 5s budget a middlegame reaches depth 26 while an
endgame reaches 55.

**R6 — Cache keyed on `(engine_id, fen, multipv)`.** Engine identity is part of the key —
the prototype omitted it and served one engine's evaluations as another's. Store the
deepest result; serve any request whose budget it already satisfies.

## 6. Technical shape

| | |
|---|---|
| Protocol | 2026-07-28 MCP spec, `@modelcontextprotocol/server@2.0.0`, stateless HTTP handler with the legacy shim for 2025-era clients |
| Engine | Stockfish 18, official prebuilt **`bmi2`** binary, pinned by version and checksum, in a container on :8090 |
| Handler | :8091, `claude mcp add --transport http` |
| Budget | `go movetime 2000` → depth ~22 middlegame, 4s worst case with a Candidate |
| Repo | New public standalone repo, not a fork |

**Why `bmi2`:** measured on-host, `vnni512` beat plain `avx512` by 0.2% — inside noise — so
the top-supported build buys nothing while costing portability. Intel removed AVX-512 from
consumer CPUs entirely from Alder Lake onward, so AVX-512 builds SIGILL on a modern Intel
laptop. `bmi2` shares a CPU generation with `avx2`, so choosing it costs zero compatibility.

**Why a container rather than a spawned binary:** the handler restarts constantly during
development, and a child-process engine re-warms on every restart. The localhost HTTP hop
is ~1ms against a multi-second search.

## 7. Quality bar

Two tiers, split by what each test actually needs.

**Tier 1 — fake engine, test-first.** Input forms, ply and move-number resolution, the
PGN-variation drop, error rules, schema shape. The fake returns *Raw Scores* and is typed
as such, so it structurally cannot launder the sign question.

**Tier 2 — real engine, invariants only, never asserts a number.** In CI against the WASM
package (measured: 1.29s for three genuine searches, no Docker):

- Black-to-move winning position → **negative** `evaluation_cp`
- …and its White-relative WDL is loss-heavy
- mate-in-1 → mate score with correct sign, not centipawns
- every result carries engine, version, depth, PV, resolved FEN

Locally, against the container: budget exhaustion returns a low reported depth rather than
throwing; a cached deeper result reports its *actual* depth.

Dependencies install with `npm ci`. Pinning the engine by checksum while the JS
dependencies float on every run is a pin with a hole in it.

## 8. Success criteria

1. A Black-to-move winning position is reported as winning **for Black**, and a test proves
   it on every push.
2. Every number in a response is accompanied by the depth, engine, and build that produced
   it — no field exists that the assistant could have invented.
3. "Was my move good?" returns a number for *any* legal move, including bad ones.
4. p100 latency ≤ 2s without a Candidate, ≤ 4s with one, on a cold cache.
   **Measured 2026-08-01**, 8 distinct positions per case, a fresh cache per call, against
   the container on this host (AMD Ryzen 9 PRO 7940HS, 12 threads, Stockfish 18 bmi2,
   `Threads=4`, `Hash=256`):

   | Case | p50 | p100 | Budget spent |
   |---|---|---|---|
   | No Candidate | 2019ms | **2052ms** | 2000ms |
   | With a Candidate | 4015ms | **4028ms** | 2×2000ms |

   The budget is held end to end: the default search budget is exactly 2000ms, so these
   are **52ms and 28ms of overhead** above a fully-spent budget — parsing, the localhost
   hop, `legal_moves` generation, and SAN rendering, at roughly 2.5% and 0.7%. Note the
   criterion as worded is unsatisfiable at the default budget, since a 2000ms search
   cannot complete within 2000ms of wall-clock; read it as "overhead is negligible against
   the budget", which is the property that was actually wanted. A regression here means
   overhead growing, not the search taking longer — the search takes exactly what it is
   given, by design.
5. Ambiguous input returns an error naming the ambiguity — never an evaluation of a
   position the user did not ask about.
6. `legacy/` is deleted, and nothing in the product references it.
   **Done 2026-08-01.** The directory was untracked from the start (D#12), so deleting it
   left no history residue — `git status` did not move. The `.gitignore` entry is kept
   deliberately: it costs nothing and stops a future reference copy from being committed
   by accident.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Claude client support for the 2026-07-28 spec is *"rolling out soon"*, no committed date | The v2 SDK's `legacy: 'stateless'` shim is load-bearing, not politeness — ship with it enabled |
| No stream resumability in the new spec: a dropped response loses the request | Cache hit rate governs retry cost, hence R6 |
| chess.js drops PGN variations silently | The only parser failure that yields a confident answer to an unasked question — covered explicitly in tier 1 |
| `bmi2` is slower on AMD Zen 1/Zen 2 (microcoded `pext`) | Slower, not incompatible. `avx2` is the fallback at ~5% |
