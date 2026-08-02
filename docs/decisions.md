# Stateless Server — Grilling Session State

**Status:** grilling **complete** — 19 decisions locked, no open questions. Everything
remaining is scaffolding (ports, tsconfig, package layout) to be settled while building.
No code has been changed yet. Awaiting go-ahead to build.

Default ports when it is built: engine container **8090** (unchanged from the fork),
stateless MCP handler **8091**.

**Goal as stated:** the quickest path to a stateless MCP that gives a chat the power of a
chess engine — ask about a position, get an evaluation backed by evidence that Stockfish
actually produced.

Companion files already written and current: [`CONTEXT.md`](./CONTEXT.md) (domain
glossary), [`docs/references.md`](./docs/references.md) (PGN/FEN/UCI standards).

---

## Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| 1 | End state | New thin remote server as a separate package, on the v2 SDK's stateless HTTP handler. Not a migration of the 13 existing tools. |
| 2 | Position input | Accept FEN, a move list from the start, a move list from a given FEN, or PGN. |
| 3 | What gets evaluated | Any ply, addressable — plus an optional Candidate Move compared against the engine's best. |
| 4 | Ply addressing | `ply` is 0-based and **relative** to the Start Position (ply 0 *is* the Start Position). Move Number is **absolute**, derived from the FEN. `move_number` + `color` resolves to the position **before** that move — the decision point. Every result echoes resolved FEN, ply, move number, and side to move. |
| 5 | Result shape | Pure engine evidence + WDL. **No dependency on `intelligence/`** — the assistant writes the prose, every number is engine-produced. |
| 6 | Search budget | **REVISED — inverted.** Wall-clock is the *primary* budget, depth is the safety net: `go movetime 2000`, with the depth reached reported as evidence. The original "depth target ~18, 5s cap" was miscalibrated — depth 18 arrives in **under 0.5s**, so the cap would never fire and 4.6s of budget went unused. Depth-to-time also varies enormously by position (an endgame reached depth 55 in 5s vs a middlegame's 26), so a fixed depth target yields wildly variable latency while a fixed time budget yields predictable latency *and* an honest depth-reached figure — which is what #6 wanted to report anyway. Bonus: it dissolves `engine-server`'s reject-on-timeout bug, since the engine stops itself and returns its best completed iteration rather than being killed mid-search. |
| 7 | Deploy target | Localhost first, via `claude mcp add --transport http chess http://localhost:PORT/mcp`. No TLS, OAuth, or hosting on the critical path. |
| 8 | Engine topology | Docker `engine-server` container, **not** a handler-spawned native binary. *(Reversal — see rationale below.)* |
| 9 | Engine binary | Official prebuilt Stockfish 18, pinned by version and checksum, **`bmi2` build**. Replaces `apt-get install stockfish`. See "Instruction-set bench" below. |
| 10 | Cache | Handler-side LRU keyed on **`(engine_id, fen, multipv)`**, storing the deepest result and serving any request whose requested depth ≤ cached depth. |
| 11 | Relationship to v0.7 | **Replacement.** The 13-tool stdio server was the prototype; port only what proves worth porting. |
| 12 | Repo layout | **New git repo** (`chess-mcp-server`) — fresh `git init` at `/home/ghost/projects/chess-mcp-server`, **not a fork**, **public**, GitHub remote created immediately (`gh repo create voolyvex/chess-mcp-server`) so CI runs from the first commit. Prototype code was copied into a `legacy/` folder for reference during the port, **untracked (`.gitignore`)** so deletion left no history residue. `engine-server/` is **product, not legacy**: it lands as `engine/` on day one, with an engine-only `docker-compose.yml` (no postgres). `legacy/` is deleted now the port is done. |
| 13 | Tool surface | **One tool, `evaluate_position`.** All four input forms (#2), optional ply/move-number addressing (#4), optional Candidate Move (#3) are arguments to it, not separate tools. Full-game scan **deferred to v2** — 40 moves × 5s cap = ~80s in one call, and the 2026-07-28 spec removed stream resumability, so it needs the tasks extension or a minted handle. Build it as a loop over a working single-position tool once the cache (#10) is measured. |
| 14 | Sign convention | **White-relative `evaluation_cp`, with `raw_score_cp` and `side_to_move` carried alongside** so the conversion is auditable rather than trusted. Matches `CONTEXT.md`'s locked split between *Evaluation* and *Raw Score*. Enforced by a real-engine test (see #15). |
| 14b | WDL | `UCI_ShowWDL` **defaults to `false`** — the wrapper must set it explicitly or the field silently never appears. Verified output format: `info depth 16 ... score mate 1 wdl 1000 0 0 ... pv f3f7` — three integers per mille (win/draw/loss). **WDL is side-to-move relative too**, so normalizing to White-relative means *swapping win and loss* when Black is to move, not merely negating the centipawns. Second landing site for the same bug; needs its own invariant test (Black-to-move winning → White-relative WDL is loss-heavy). |
| 16 | Input schema | Two position fields, not four: `fen` (Start Position, optional, defaults to the standard array) and `moves` (Move Sequence — bare list, numbered list, or full PGN all go through the same chess.js call). Plus `ply`, `move_number`+`color`, `candidate`, `depth`. **Four rules, all reject rather than resolve:** (1) `ply` *and* `move_number` both supplied → error — not because they're redundant but because they are different kinds of address that cannot be reconciled, see #17; (2) neither supplied → default to the **final position** of the sequence, which degenerates correctly to "evaluate this FEN" when `moves` is absent; (3) `fen` supplied *and* the PGN carries a `[FEN]` header → error if they differ, accept if identical; (4) `candidate` accepts **both SAN and UCI**, echoing back which was parsed, since a model will produce either and `Bxh6` vs `c1h6` failing would be a frequent avoidable error. The through-line: every ambiguous input errors rather than guesses — a schema that guesses is the RAV silent-drop defect one layer up. |
| 17 | `ply` vs `move_number` are **not** parallel coordinate systems | `move_number`+`color` names a **move**; `ply` names a **position**. N moves pass through N+1 positions, so move addressing is structurally one short — it can never name the final position, having no move to sit "before". Verified empirically: Start Position `r1bq1rk1/pp2ppbp/2np1np1/8/2BNP3/2N1B3/PPP2PPP/R2Q1RK1 b - - 3 14`, sequence `14...Nxd4 15.Bxd4 Be6 16.Bxe6 fxe6` → ply 0=(14,black), 1=(15,white), 2=(15,black), 3=(16,white), 4=(16,black), **ply 5 = final position, addressable by nothing**. So `ply` strictly dominates `move_number` in reach; `move_number` earns its place by **fluency**, not reach — PGNs and users both speak in move numbers ("was 14...Nxd4 wrong?"), and forcing manual conversion against a mid-game Start Position invites exactly the off-by-one the PGN standard §16.1.3.6 warns about (fullmove increments *after* Black's move — confirmed in the table above). Consequence for tier-1 tests: rule (2)'s default names the one position `move_number` cannot express, so the ply-N boundary needs explicit coverage. |
| 18 | Output schema | `position` {`start_fen`, `resolved_fen`, `ply`, `move_number`, `side_to_move`} · `evaluation` {`evaluation_cp` White-relative, `raw_score_cp`, `mate_in`, `wdl_white`, `raw_wdl`} · `best` {`san`, `uci`, `pv_san`, `pv_uci`} · `candidate` {`san`, `evaluation_cp`, `delta_cp`, `depth_reached`} · `evidence` {`engine`, `build`, `depth_requested`, `depth_reached`, `nodes`, `nps`, `time_ms`, `cache_hit`}. **No human-readable summary string** — no `"White is better (+3.71)"` field like slothingaway's. Decision #5 taken literally: the assistant writes the prose, the tool ships only numbers with provenance. This is the visible difference from every other chess MCP server, and it is deliberate. |
| 19 | Candidate Move evaluation | **Play-and-search**, with MultiPV=1 for the main line. Apply the Candidate, search the resulting position, negate. Rejected MultiPV-and-look-for-it because it fails exactly when the question is most interesting — a bad move isn't in the top N, so the method returns nothing precisely when the answer is "yes, badly". Play-and-search gives an exact number for any legal move regardless of quality, and the two searches cache independently under #10 so a repeated question is free. Cost is a second search on a cold cache (up to 2× the wall-clock cap) — bounded and cacheable, where the coverage gap is not. **Consequence to report, not hide:** the candidate's number comes from a different search than the best move's, so under a wall-clock cap the two can complete at different depths — hence `candidate.depth_reached` separate from `evidence.depth_reached`. |
| 15 | Testing | Two tiers. **Tier 1** — fake engine, fast, test-first: the four input forms (#2), ply/move-number resolution (#4), RAV silent-drop, PGN errors, schema shape. The fake returns *Raw Scores* and is typed as such, so it cannot launder the sign question. **Tier 2** — real engine, invariants only, never asserts a number. Split by what each test needs: the engine-agnostic ones (sign, mate scoring, evidence completeness) run **in CI against the WASM package** — *measured at 1.29s total for three genuine depth-12 searches, no Docker*; the container-path ones (timeout returns deepest completed search, cache keyed on engine identity) run **locally only**, skipped when the engine is unreachable. Adding the container to CI later is ~3 lines and a ~15s warm-cache cost — deferrable at no cost. Also: use **`npm ci`**, never the fork's `rm -f package-lock.json && npm install`, which discards the lockfile every run and makes pinning the engine by checksum (#9) a pin with a hole in it. |

### Why #8 reversed

Initially recommended spawning a native binary from the handler. Reversed because
`engine-server/server.js` is 189 lines of already-working process management (spawn, UCI
line-buffer reassembly, request queue, timeout, crash-respawn at lines 72 and 79) — the
native path *reimplements* that rather than avoiding it. Decisive factor: with the engine
as a child of the handler, **every handler restart re-warms the engine**, and the handler
will be restarted constantly during development. The localhost HTTP hop is ~1ms against a
multi-second search.

---

## Open questions — all resolved

A → #12 · B → #13 · C → #14, #15 · D → #9 · E → below (leave it) · F → #16, #17 · G → #18, #19

**E. The sign bug — RESOLVED: leave it, move on.** The defect lived in the prototype, not
in this codebase, so there was nothing here to fix. What it taught is kept where it earns
its place: the sign is White-relative by construction, `raw_score_cp` ships alongside the
converted number so the conversion is auditable, and a test asserts the two agree.

---

## Verified facts — do not re-verify

### The 2026-07-28 MCP spec (shipped two days before this session)

- Protocol sessions **removed entirely**: no `Mcp-Session-Id`, no `initialize` handshake.
  Stateless is the protocol, not a mode. Protocol version and client capabilities travel
  in `_meta` on every request; servers **must** implement `server/discover`.
- Cross-call state → **server-minted handles passed as ordinary tool arguments**
  (SEP-2567). This is the sanctioned replacement for the `refresh_games` →
  `get_analysis_progress` pattern.
- **Stream resumability removed.** A broken response stream loses the in-flight request;
  the client must re-issue with a new request ID. This is why cache hit rate now governs
  retry cost.
- `notifications/progress` still flows on its own request's response stream.
- Long-running work → the `io.modelcontextprotocol/tasks` extension, polled via
  `tasks/get`.
- `tools/list` results must carry `ttlMs` and `cacheScope`; deterministic tool ordering
  recommended.
- Sampling, roots, and logging **deprecated** — log to stderr or OpenTelemetry, which this
  project already does.
- **SDK:** the repo is on `@modelcontextprotocol/sdk@^1.29.0` (v1, latest 1.30.0). The new
  spec needs **`@modelcontextprotocol/server@2.0.0`** (published 3 days ago; deps
  `@modelcontextprotocol/core@2.0.0` + zod ^4.2 — repo is already on zod 4.3). Entry point
  is `createMcpHandler(() => {...})`, which builds a **fresh `McpServer` per request** and
  ships a legacy shim (`legacy: 'stateless'`) that still serves 2025-era clients.
  → The engine client and cache must therefore be **module-level singletons**, outside the
  per-request server.
- Claude client support is *"rolling out soon"* with no committed date, so the legacy shim
  is load-bearing, not politeness.

### Engine versions — all measured

| Path | Version | How verified |
|------|---------|--------------|
| Host `apt` (Ubuntu noble) | 16-1build1 | `apt-cache policy stockfish` |
| Container `apt` (Debian bookworm) | **15.1-4** | ran `debian:bookworm-slim` |
| npm WASM package | 18.0.7 | `package.json` |
| Official release | **Stockfish 18**, tag `sf_18`, 2026-01-31 | `gh release list` |

The containerised "native" engine is currently the **oldest** of the three, and two majors
behind the WASM fallback it is supposed to outrank. Official release assets include
`stockfish-ubuntu-x86-64-{avx2,bmi2,avx512,avx512icl,avxvnni,vnni512,sse41-popcnt}.tar`.

**Host CPU:** AMD Ryzen 9 PRO 7940HS (Zen 4), 12 cores. Flags present: `avx2`, `bmi1/2`,
`avx512f/bw/cd/dq/vl/vbmi/vbmi2/ifma/bitalg/vpopcntdq`, `avx512_vnni`, `avx512_bf16`.

### Instruction-set bench — measured on this host (Zen 4, SF 18, default single-thread bench)

| Build | Run 1 | Run 2 | Mean | vs `avx2` | ISA introduced |
|---|---|---|---|---|---|
| `avx2` | 808,679 | 779,479 | ~794k | — | Haswell 2013 |
| `bmi2` | 834,680 | 828,275 | ~831k | **+4.7%** | Haswell 2013 |
| `avx512` | 855,931 | 883,208 | ~870k | +9.5% | Skylake-SP 2017 |
| `vnni512` | 854,860 | 887,796 | ~871k | +9.7% | Cascade Lake 2019 |

Conclusions driving decision #9:

- **`vnni512` beats `avx512` by 0.2%** — inside the ~3.6% run-to-run variance. The VNNI
  instructions buy nothing on this workload, so the "top build this CPU supports" rationale
  purchases no speed while costing portability. Dominated.
- **`avx2` and `bmi2` are the same CPU generation**, so choosing `bmi2` costs *zero*
  compatibility — any CPU or VM CPU model exposing one exposes the other. The only
  difference is AMD Zen 1/Zen 2 (2017–2019), whose microcoded `pext` makes `bmi2` slower
  there. Slower, not incompatible.
- **Intel removed AVX-512 from consumer CPUs** — fused off from Alder Lake (12th gen, 2021)
  onward; it survives only on Xeon parts and 11th-gen Rocket Lake. So AVX-512 builds SIGILL
  on a modern Intel laptop, and `pext`/`pdep` are full-speed hardware on every Intel since
  Haswell — the slow-`pext` caveat is AMD-only. `bmi2` is the best Intel choice outright.
- **AVX-512 would foreclose the deferred CI option in #15.** GitHub's `ubuntu-latest` pool
  mixes Intel Ice Lake (has AVX-512) with AMD EPYC Zen 3 (does not), so an AVX-512 pin turns
  "three lines to add container tests to CI" into "SIGILL on a coin flip".
- **Whole spread is ~9%** against a 5s wall-clock cap (#6) — a fraction of one extra ply.
  Not a meaningful difference in answer quality.
- Runtime binary selection via `/proc/cpuinfo` is closed off: each binary is **108 MB**, so
  a two-binary image is +216 MB to save ~5%. Not economic.
- **Containers do not mask CPU flags** — a `debian:bookworm-slim` container here reports
  `avx2`, `bmi2`, `avx512f`, `avx512_vnni`. Real VMs do: hypervisors present a *CPU model*,
  conservative defaults (`qemu64`, `kvm64`) can omit AVX2 entirely, and live migration
  across a heterogeneous cluster forces a lowest-common-denominator model, so features can
  vanish after a migration. Note this host is already a VM — WSL2 is Hyper-V, passing
  AVX-512 straight through.

### Search-budget calibration — measured (`bmi2`, Threads=4, Hash=256, this host)

| Budget | Middlegame depth | Opening depth | Worst case with a Candidate (2 searches, #19) |
|---|---|---|---|
| 500 ms | 19 | 19 | 1 s |
| 1 s | 21 | 19 | 2 s |
| **2 s** | **22** | **23** | **4 s ← chosen** |
| 3 s | 23 | 24 | 6 s |
| 5 s | 26 | 25 | 10 s |

Returns are steeply diminishing — 10× the time buys +7 ply. Depth 22 is far beyond what the
evaluation-quality question needs, and 4s worst-case keeps a chat responsive; 5s would mean
a 10-second wait on "was my move good?" to buy four plies nobody notices. A separate
endgame probe (`8/5ppp/4k3/8/8/4K3/5PPP/8 w - - 0 40`) reached **depth 55 at 5s** — the
evidence that depth targets cannot give predictable latency.

### Environment

- Docker **is** available (29.2.1); no containers currently running.
- `claude mcp add --transport http <name> <url>` is supported → localhost HTTP MCP works
  with Claude Code today, no hosting or auth.
- The prototype had **no consumers** — unpublished to npm, registered with no MCP client.
  Nothing depended on it, which is why replacing it outright cost nothing (D#11).

### chess.js 1.4.0 parsing — probed directly

| Input | Behaviour |
|-------|-----------|
| Bare move list `"e4 e5 Nf3 Nc6"` | Parses — numbers and result token optional |
| `[FEN "..."]` header, with or without `[SetUp "1"]` | Honoured as Start Position |
| `{[%clk ...]}`, `{[%eval ...]}`, `$1` | Parsed and ignored correctly |
| Variations `2. Nf3 (2. Bc4 Nf6)` | **Mainline taken, RAV silently dropped**, absent from `getComments()`, no error |
| Two games concatenated | Throws `Expected end of input or whitespace` |
| Mid-game fragment `"2... Nc6"` | Throws `Invalid move in PGN` |
| Illegal move | Throws `Invalid move in PGN: <san>` |

Only the RAV case fails silently — the only one that can yield a confident evaluation of a
position nobody asked about.

---

## Known bug in existing code — not yet filed

**UCI `score cp` is reported from the side-to-move's perspective. Confirmed empirically**,
not just from docs — Stockfish 18 WASM (the build in `node_modules`), depth 14, same board
evaluated twice with only the side to move changed:

| Position | Raw `score cp` |
|---|---|
| `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1` (White down a queen, White to move) | `-638` |
| `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR b KQkq - 0 1` (same board, Black to move) | `+671` |

Nothing in `src/` negates it — verified by grepping the whole tree for a sign flip; the
only `sideToMove` in the tree (`analyze-position.ts:158`) feeds board rendering, not the
eval. On row 2 the tool reports **"White is winning"** while White is down a queen.

**Prior art — two valid conventions, and this repo follows neither.**
[`slothingaway/stockfish-mcp`](https://glama.ai/mcp/servers/slothingaway/stockfish-mcp)
normalizes to White and calls the raw convention *"a classic footgun"*, returning `turn`,
`fen`, raw `score` and a normalized `evaluation` side by side (but **no depth and no engine
version** — the gap decision #5 closes).
[`dvip1/mcp-chess`](https://glama.ai/mcp/servers/dvip1/chess_mcp) stays side-to-move
relative and documents it. The defect here is not the choice but that the convention is
stated nowhere in the code, so nothing forces the parse end and the render end to agree.

**Why 28 test files missed it:** they mock the engine
(`analyze-position.test.ts` → `vi.mock("../engines/engine-router.js")`, fixture
`makeLines(cp = 30)`) and then assert the fixture was treated as White-relative. The test
encodes the same wrong contract as the code. Mocked coverage is structurally incapable of
catching a bug about what the engine means — hence tier 2 above.

Path: `engines/stockfish.ts:70` parses raw → `engine-router.getEval()` passes through →
`tools/analyze-game.ts:97 lineToEvalCp()` returns raw → `moveRecords[].evalBefore/After`.

1. `tools/analyze-position.ts:68 evalToText()` treats the raw score as White-relative
   (`scoreCp >= 300 → "White is winning"`). With Black to move and winning, Stockfish
   returns `+500` and the tool reports **"White is winning"** — inverted on every
   Black-to-move position.
2. `intelligence/critical-moments.ts:14` documents its input as
   `// centipawns, from white's perspective` — a contract the engine layer never satisfies
   — then `evalForSideToMove()` negates for Black, stacking a second error.

Traced statically, not executed. Corroborated by the git log entry
`fix: ... inverted black condition in pattern detection`.

## Other pre-existing issues found

- **`cache/index.ts:22`** — key is `${fen}:${depth}:${multiPv}`, with **no engine
  identity**. `engine-router` silently falls between Docker Stockfish (15.1) and WASM
  Stockfish (18.0.7) on health-check failure, so one engine's cached evals are served as
  the other's. Decision #10 fixes this in the new server.
- **`engine-server/server.js:132-139`** — on timeout it writes `stop\n` then **rejects**,
  discarding the partial result. Decision #6 needs it to resolve with the deepest
  completed search instead. `req.lines` already accumulates them, so this is roughly a
  5-line change.
- **`Dockerfile:27`** — `apt-get install stockfish` pins nothing; the engine version is
  whatever the base image's repos carry. Decision #9 replaces this.
