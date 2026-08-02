# Beta readiness — reaching a tester on Grok

**Status:** specified, not built. Grilled 2026-08-01. Decisions locked; no code changed yet.

**Goal:** a chess player, recruited as a beta tester, uses `evaluate_position` from the Grok
app on their phone without cloning anything, without running anything, and without a setup
call.

**Scope note.** The question that opened this was packaging — how to ship the repo for users
on different AI platforms. The answer turned out to be that packaging is not the problem:
**the server has to become remotely deployable first.** That is a larger change than the
framing implied, touching the handler's auth surface, the engine pin, the tool schema, and
the measured claims in §8 of the PRD. Recorded here so the scope is chosen rather than
discovered.

---

## 1. What Grok actually is, as a client

Established from xAI's documentation on 2026-08-01. Facts, not assumptions, except where
marked.

| Property | Finding | Consequence here |
|---|---|---|
| Custom MCP | Supported. `grok.com/connectors` → New Connector → Custom → URL + auth | The tool is reachable in principle |
| Network path | **xAI's servers call the MCP server**, not the user's device | The URL must be public; the tester's phone is irrelevant to networking |
| localhost | **Rejected outright.** Private addresses too | `http://localhost:8091/mcp` — the README's only instruction — cannot work |
| Transport | Streamable HTTP works. SSE breaks through Cloudflare quick tunnels | This server speaks streamable HTTP: already the compatible shape |
| Connector scope | Account-level, not device-level | Added once on any surface, works on phone and browser both |
| Skills | Real, and Claude-compatible — but **Grok Build (CLI)**, not `grok.com` chat | No filesystem for a mobile tester: `.claude/skills/` cannot reach them |
| Tier | Individual paid tiers self-serve. **Business/Enterprise requires a team admin** to add it at `console.x.ai` first | Confirm the tester's plan is individual, or an admin is a blocker |

**Not a thing:** there is no Grok desktop app with MCP support. Searches surface *Groq*
Desktop — a different company, one letter apart. The surfaces are `grok.com` web,
iOS/Android, Grok Build CLI, and the API.

**Unknowns xAI's docs do not settle**, to be resolved empirically during setup rather than
assumed: the exact auth shapes a custom connector accepts (the docs say only "complete any
required authentication"), whether tool descriptions are truncated, and whether `grok.com`
chat has any per-connector instructions field.

**Working assumption:** individual paid plan, mobile-first, browser available. If the
tester's reply contradicts this, revisit §1 before building.

---

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Target surface | `grok.com`, individual paid plan, mobile-first tester |
| 2 | Unauthenticated quick tunnel | **Ruled out** |
| 3 | Security posture | Bearer token + `movetimeMs` clamp — prerequisite, not optional |
| 4 | Hosting | Oracle free ARM; paid x86 VPS as fallback |
| 5 | Verification | Depth at fixed movetime, ARM vs x86 |
| 6 | Benchmark fixture | 9 positions, 3 per phase, reported per-phase |
| 7 | Baseline | Establish x86 depth locally **first** — it was never recorded |
| 8 | Operator discipline | Carried in the **tool description** |
| 9 | Repo shape | **One repo.** No per-platform split |

---

## 3. Why one repo, not one per platform

The original question. Once operator discipline rides in the tool description (D8) and the
server has a stable authenticated URL (D3, D4), **nothing platform-specific remains to
split.** The same URL and the same connector serve Grok, Claude, Codex and Gemini alike.

Per-platform repos would duplicate the schema and let the operator rules drift — a failure
`deploy/README.md` already warns about for the two `SKILL.md` files maintained today
("keep the two SKILL.md files in sync — they are versioned with the schema they describe").
Multiplying that by every client is the same defect, scaled.

What the repo is missing is not a split. It is a remote deployment story.

---

## 4. Security: what a public URL changes

Verified against `src/index.ts` on 2026-08-01.

- **No auth, no origin checking, no rate limiting.** Every request goes straight to the MCP
  handler. The `localhost` on line 45 is a dummy base for URL parsing, not a bind
  restriction — `server.listen(PORT)` binds all interfaces.
- **Every request is unbounded CPU.** `movetimeMs` is caller-supplied with no upper clamp;
  only `multipv` is range-checked (1–5). The engine runs 4 threads, 256 MB hash.

Same-machine clients (Claude Code, Codex) are protected by locality. **Grok removes that
protection by design** — xAI's servers are the client, so the URL is public by necessity.

Two changes, both prerequisites to any public deployment:

1. **Clamp `movetimeMs`** to a documented maximum. This is the difference between a bad
   request costing two seconds and costing forever. A genuine defect for any non-local
   deployment, independent of Grok.
2. **Bearer token auth.** Converts "anyone with the URL" into "anyone with the token."
   Subject to the §1 unknown about which auth shapes Grok's connector dialog accepts —
   verify before relying on it.

**Ordering matters and is easy to get backwards:** a hosted deployment without auth is
*worse* than an ephemeral tunnel, because it is permanently public. Hosting does not
substitute for auth; it makes auth mandatory.

---

## 5. Hosting

Rejected: unauthenticated quick tunnel (D2 — a live handle on the CPU while up); the
home desktop (uptime, home IP, and the box becomes committed); Fly/Railway/Render
(shared cores degrade search depth, and depth is the number this project promises is real).

**Chosen: Oracle free ARM** — up to 4 Ampere cores, 24 GB RAM, against roughly 3 vCPU and
4 GB on a €8 Hetzner CPX21. Plausibly *better* for Stockfish, and free.

Accepted risks, explicitly:

- **Reclamation.** Oracle reclaims idle free-tier instances, and this workload is near-idle
  by design — bursty CPU with long quiet gaps. For a service others may depend on
  indefinitely, this is the real risk, not the ARM port.
- **Capacity.** Free ARM is often unavailable in popular regions for days.
- **Fallback is a paid x86 VPS** (Hetzner-class, €5–8/mo) if either bites.

### The ARM port is three coordinated changes

`engine/Dockerfile` hardcodes the architecture in the **asset name**, not merely a build
flag: `stockfish-ubuntu-x86-64-${SF_BUILD}.tar`. ARM therefore needs a different asset
name, a different `SF_SHA256`, and a different `SF_BUILD` — all pinned by design.

**The bmi2 haircut is permanent, not a migration cost.** bmi2 uses x86 `PEXT` for magic
bitboards; there is no ARM equivalent. The Dockerfile records avx2 as ~5% slower than bmi2
on this hardware. ARM is a separate architecture, not "x86 minus bmi2" — only measurement
settles it (§6).

**The ARM container is a distinct engine identity.** `STOCKFISH_BUILD` is part of the cache
key, and `.claude/rules/engine-contract.md` requires engine identity in the key precisely so
a failover cannot serve one engine's evaluations as another's. Nothing to fix — the design
already handles it — but ARM is a *new engine*, not a drop-in, and §8's recorded
measurements belong to the x86 one.

---

## 6. Verification

### What §8 does not contain

**No benchmark harness has ever existed.** Nothing named bench/perf/measure/latency appears
anywhere in git history, including deleted files. `scripts/` holds only
`normalize_trailers.py`. The §8 numbers were produced ad hoc on 2026-08-01, method
uncommitted.

**And §8 measures the wrong quantity for this comparison.** Its numbers are *latency*, which
§8 itself explains is pinned to the budget by design: a 2000 ms search takes 2000 ms on any
hardware. Those figures will be near-identical on ARM — ~2050 ms and ~4030 ms — and will say
**nothing** about whether Ampere cores search as well as a Ryzen. Wall-clock is the budget;
depth is the outcome. §8 measured the budget.

**Depth reached at 2000 ms was never recorded.** That is the number this comparison needs,
and it does not exist for x86 either.

### The harness

Written once, run on both hosts, capturing:

- **Depth reached at fixed movetime, per phase** — the ARM question
- **Overhead above budget** — keeps §8 comparable and catches overhead regressions

**Fixture:** 9 positions committed to the repo, 3 each opening/middlegame/endgame,
**reported per-phase, never pooled.** Depth varies enormously by phase —
`.claude/rules/engine-contract.md` records depth 26 in a middlegame against 55 in an endgame
at the same 5 s budget — so a pooled average is meaningless. Committing the set is what makes
the comparison reproducible instead of another ad hoc run.

**Threading, to be chosen deliberately rather than inherited:** §8's host has 12 threads with
`Threads=4`, so Stockfish had headroom. Oracle's free ARM has 4 cores total, where `Threads=4`
contends with the handler, the bridge, and the OS. Either keep `Threads=4` as the honest
production configuration, or hold total-cores-minus-one constant. Record which.

**No pass/fail threshold is fixed in advance.** Depth-at-fixed-time varies too much by
position for a single number to mean anything. Measure across the fixture, read the spread,
decide with data in hand.

---

## 7. Operator discipline for a client with no filesystem

The repo's answer today is "clone the repo and open your assistant in the folder"
(`README.md`). **A mobile Grok user has no folder.** Grok's Skills feature is Grok Build
(CLI), not `grok.com` chat.

This matters more here than it would elsewhere. The README states the stake: without the
skill you still get correct numbers, but *"nothing stops a fluent guess from sitting in the
same paragraph beside them."* ADR-0003 exists **because a previous beta transcript did
exactly that** — offering "10...g4 or 10...Bxc3+" as alternatives without scoring either.
A chess player is precisely the tester who notices, and who cannot tell whether to blame the
server or the model.

**Decision: the four operator rules travel in the `evaluate_position` tool description.**

The only option that works identically on `grok.com`, mobile, Claude, Codex and every future
client, with nothing for the user to install. Rejected alternatives: a paste-in custom-
instructions block (relies on the tester doing it; mobile paste-in is friction); leaning on
`legal_moves` alone (weakest guarantee); accepting the gap (defensible — it would reveal
whether the skill is load-bearing — but a chess tester is an expensive way to learn it).

**This does not violate the no-prose rule.** CLAUDE.md forbids prose in tool *output* — a
field an assistant could have invented. A tool *description* is schema, and is the documented
place for usage guidance. The boundary is close enough to be worth stating explicitly.

The repo skill stays for clients that support skills. The description is the floor, not a
replacement — and, per `deploy/README.md`, it is now a **third** artifact versioned with the
schema it describes, and must not drift from the other two.

**Open, to verify empirically:** whether Grok surfaces the full description or truncates it.

---

## 8. Work, in dependency order

| # | Step | Depends on | Blocked? |
|---|---|---|---|
| 1 | Clamp `movetimeMs`; bearer token auth | — | No |
| 2 | Benchmark harness + 9-position fixture | — | No |
| 3 | Run on x86 here — establishes the missing baseline | 2 | No |
| 4 | Operator rules into the tool description | — | No |
| 5 | ARM-repin the Dockerfile (asset, checksum, `SF_BUILD`) | — | Writable, **not verifiable** here |
| 6 | Provision Oracle; deploy; run the harness | 1, 2, 5 | **Yes — needs the instance** |
| 7 | Compare per-phase depth; decide Oracle vs paid x86 | 3, 6 | Yes |
| 8 | Docs: §8 gains a depth baseline and an ARM section as a distinct engine identity; README gains remote deployment + Grok connector setup | 7 | Yes |

**Steps 1–4 are unblocked.** Step 5 can be written but not verified without ARM hardware.
Steps 6–8 need the Oracle instance, which cannot be provisioned from here and may wait days
on free-tier capacity. **If capacity never materialises, D4 reverts to the paid x86 box and
steps 5–7 largely evaporate** — the rest of the spec stands unchanged.

---

## 9. Verify with the tester before building

1. **Plan tier** — individual (self-serve) or Business/Enterprise (needs an admin at
   `console.x.ai` first). A blocker worth finding now, not on test day.
2. Confirm `grok.com` chat, not Grok Build.
