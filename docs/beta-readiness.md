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
assumed: ~~the exact auth shapes a custom connector accepts~~ (**closed 2026-08-04** — the
dialog has two fields, Name and Server URL, and sends no headers: ADR-0005); ~~whether tool
descriptions are truncated~~ (**closed 2026-08-05** — they are not; Grok recited the
description verbatim, §7); and whether `grok.com` chat has any per-connector instructions
field.

**Working assumption:** individual paid plan, mobile-first, browser available. If the
tester's reply contradicts this, revisit §1 before building.

---

## 2. Decisions locked

| # | Decision | Choice |
|---|---|---|
| 1 | Target surface | `grok.com`, individual paid plan, mobile-first tester |
| 2 | Unauthenticated quick tunnel | **Ruled out** |
| 3 | Security posture | Bearer token + `movetimeMs` clamp — prerequisite, not optional |
| 4 | Hosting | Paid ARM VPS (~€6/mo) — *revised 2026-08-02 from Oracle free ARM, see §5* |
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

  > **Partly wrong, corrected 2026-08-03 while building step 1.** The *handler* had no
  > bound, as written. But `engine/server.js` has clamped at `STOCKFISH_MAX_MOVETIME`
  > (30 s) since before this spec — silently, via `Math.min`. So the exposure was a 30 s
  > search per request, not an unbounded one: still a real defect for a public URL, and
  > still worth fixing, but smaller than "forever." The fix moves the bound to the handler
  > and makes it **refuse** rather than clamp, because a silently shortened search reports
  > the depth it reached as though the requested budget had bought it. The bridge clamp
  > stays as defence in depth for any caller reaching it directly.

Same-machine clients (Claude Code, Codex) are protected by locality. **Grok removes that
protection by design** — xAI's servers are the client, so the URL is public by necessity.

Two changes, both prerequisites to any public deployment:

1. **Bound `movetimeMs`** at a documented maximum. A genuine defect for any non-local
   deployment, independent of Grok. *Done 2026-08-03: `MAX_MOVETIME_MS = 30_000`, enforced
   in `evaluatePosition` before any search dispatches, and carried in the `movetime_ms`
   schema description so the ceiling is discoverable without reading source.*
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

**Chosen: paid ARM VPS** (Hetzner CAX11 — 2 dedicated Ampere cores, 4 GB, ~€6/mo). Set a
billing alert at a near-zero threshold (~$0.01) on whatever account holds it: on a fixed-price
box anything above zero is a surprise, and the alert is what makes it a cheap one.

*Revised 2026-08-02.* This was originally Oracle free ARM, on the strength of 4 Ampere cores
and 24 GB against ~3 vCPU on a paid x86 box. Two facts killed that: Oracle **halved** the
Always Free A1 allowance to 2 OCPU / 12 GB on 2026-06-15, so it no longer beats the paid box
on cores; and its idle-reclamation rule (95th-percentile CPU, network, and — on A1 shapes —
memory, all under 20% over 7 days) is one this workload **meets by construction** at
`Hash=256`. Reclamation would be the expected outcome, not a tail risk. Paid ARM keeps the
port meaningful, and removes both the capacity wait and the reclamation clause.

Free ARM remains fine for a throwaway §6 measurement run, where a 7-day reclamation window
does not matter. If capacity blocks that, the error is transient: poll `LaunchInstance` every
30–60 s from an always-free AMD micro instance, using the `subnetId`/`imageId`/`compartmentId`
from a failed launch. PAYG gets launch priority more cheaply. Whatever script does the
polling holds a key that can create billable infrastructure — read it first;
`hitrov/oci-arm-host-capacity` is the one usually named but was archived in 2024.

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

### What §8 did not contain

> **Resolved 2026-08-02.** The harness is `bench/depth-at-budget.ts` with its fixture at
> `bench/fixture.json`, and the x86 baseline is recorded as `docs/prd.md` §8 criterion 7:
> **opening 24, middlegame 22, endgame 55**, overhead 4ms median / 12ms max. The rest of
> this section is kept as written — it is the reasoning the harness was built from, and the
> ARM half of the comparison is still outstanding.

**No benchmark harness had ever existed.** Nothing named bench/perf/measure/latency appeared
anywhere in git history, including deleted files. `scripts/` held only
`normalize_trailers.py`. The §8 numbers were produced ad hoc on 2026-08-01, method
uncommitted.

**And §8 measures the wrong quantity for this comparison.** Its numbers are *latency*, which
§8 itself explains is pinned to the budget by design: a 2000 ms search takes 2000 ms on any
hardware. Those figures will be near-identical on ARM — ~2050 ms and ~4030 ms — and will say
**nothing** about whether Ampere cores search as well as a Ryzen. Wall-clock is the budget;
depth is the outcome. §8 measured the budget.

**Depth reached at 2000 ms was never recorded.** That is the number this comparison needs,
and it did not exist for x86 either. It does now — see the note above.

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

**Closed 2026-08-05: Grok does not truncate the description.** Asked to state the tool's
rules back, Grok returned the description word for word — through to the final clause, *"a
shallow search is a weaker claim."* Compared against `src/mcp-handler.ts`: no elision, no
paraphrase, no dropped tail. The concern that shaped the writing (§ below: put the
prohibition first, because a truncated tail loses whatever sits at the end) turns out not to
bind on this client. The register is still worth keeping — it is cheap, and it is the only
form that survives a client which *does* truncate — but it is now insurance rather than a
live constraint.

**What the recital covers, and what covers the rest.** The recital was of the *tool
description*, carrying rules 1 and 3 — and the same answer attached the depth to the
evaluation ("depth 19, 5 seconds") unprompted, which is rule 3 obeyed rather than merely
quoted. Rules 2 and 4 live on parameter descriptions, which this recital did not ask for;
they are covered instead by the 2026-08-04 behavioural evidence in the table below. **Every
rule is now confirmed to reach the model by one route or the other.**

### Where the four rules actually landed (2026-08-05)

Two were already carried before this was audited, which is why the step read as undone
rather than half-done. All four are now in the schema, but **spread across three fields,
not gathered in the tool description**:

| Rule | Home | Added | Verified reaching the model |
|---|---|---|---|
| 1. Never name a move outside `legal_moves` | tool description | pre-existing | Recited verbatim 2026-08-05 |
| 2. Never characterise an unscored move | `candidate` field | **2026-08-05** | Obeyed 2026-08-04 — `exf6` scored as a dedicated candidate before being called a mistake |
| 3. Read the depth before trusting the number | tool description | **2026-08-05** | Recited, *and* obeyed unprompted |
| 4. Engine Lines ≠ Candidate Moves | `multipv` field | pre-existing | Obeyed 2026-08-04 — reported "depth ~17–21", bracketing the multipv and candidate depths separately |

**Parameter descriptions are read, not just the tool description.** The 20:31 run of
`docs/first-connection.md` shows Grok issuing a `multipv: 5` call *and* a separate `candidate`
call for `exf6`, then quoting "depth ~17–21" — the two real depths of the two different
searches. Keeping an Engine Line's depth distinct from a Candidate's *is* rule 4, and scoring
`exf6` before characterising it *is* rule 2. Behaviour is stronger evidence than recitation:
rules 1 and 3 are known to arrive, rules 2 and 4 are known to be acted on.

Rules 2 and 4 sit on the parameter that triggers them, where a model reaching for that field
reads the constraint at the moment it applies. Rules 1 and 3 are about *reading the
response*, so they have no parameter to attach to and belong in the description.

**Written as one-sentence imperatives with the prohibition first**, deliberately: a rule
buried mid-paragraph is diluted, and if Grok truncates, whatever sits at the end is what
disappears. The reasoning behind each rule stays in the two `SKILL.md` files, which is what
keeps this third artifact short enough to survive both problems. Evidence for the register:
the two pre-existing rules are the two crisply-phrased ones, and Grok obeyed both on first
contact (`docs/first-connection.md`).

*Half of that reasoning was retired on 2026-08-05 — Grok does not truncate (above). The
dilution half stands, and the brevity is what made the verbatim recital legible enough to
check against the source in the first place.*

---

## 8. Work, in dependency order

| # | Step | Depends on | Blocked? |
|---|---|---|---|
| 1 | ~~Bound `movetimeMs`~~ **Done 2026-08-03**. ~~Bearer token auth~~ **Ruled out 2026-08-04** — Grok's connector dialog sends no headers (ADR-0005) | — | No |
| 2 | ~~Benchmark harness + 9-position fixture~~ **Done 2026-08-02** — `bench/` | — | No |
| 3 | ~~Run on x86 here — establishes the missing baseline~~ **Done 2026-08-02** — `docs/prd.md` §8.7 | 2 | No |
| 4 | ~~Operator rules into the tool description~~ **Done 2026-08-05** — all four now in the schema | — | No |
| 5 | ARM-repin the Dockerfile (asset, checksum, `SF_BUILD`) | — | Writable, **not verifiable** here |
| 6 | Provision Oracle; deploy; run the harness | 1, 2, 5 | **Yes — needs the instance** |
| 7 | Compare per-phase depth; decide Oracle vs paid x86 | 3, 6 | Yes |
| 8 | Docs: §8 gains a depth baseline and an ARM section as a distinct engine identity; README gains remote deployment + Grok connector setup | 7 | Yes |

**Steps 1–4 are unblocked; 2 and 3 are done.** Step 5 can be written but not verified without
ARM hardware.
Steps 6–8 need the ARM instance, which cannot be provisioned from here — a paid box removes
the capacity wait (§5), so this is a purchase, not a queue. **If ARM measures badly in §6,
D4 reverts to x86 and steps 5–7 largely evaporate** — the rest of the spec stands unchanged.

---

## 9. Verify with the tester before building

1. **Plan tier** — individual (self-serve) or Business/Enterprise (needs an admin at
   `console.x.ai` first). A blocker worth finding now, not on test day.
2. Confirm `grok.com` chat, not Grok Build.

## 10. Desktop only — mobile silently invalidates the measurement

**On 2026-08-04 the Grok mobile app answered a chess question with specific centipawn
numbers, a ranked table, and a stated search depth, having never contacted this server.**
The connector was enabled. Zero requests reached the tunnel; a probe minutes later proved
the capture was live. Grok pip-installed its own engine and answered from that
(`docs/first-connection.md`).

The numbers were roughly right — +0.8 against a measured +0.89, correct move order, correct
verdict. **That is what makes it dangerous.** Nothing in the response distinguishes it from
the desktop run that did call the engine.

**This invalidates the beta's premise on mobile.** §6 scopes the beta to analysis quality:
Grok-with-the-tool versus Grok-without-it. A mobile tester runs the second condition twice,
sees no difference, and reports accurately that the tool adds nothing — a conclusion drawn
from data where the tool was never used.

**So: the tester runs on desktop, and is told why.** If mobile cannot be excluded, the
tester needs a positive signal that the engine was actually called — the operator watching
the log in real time is the only one available today, which caps mobile testing at
supervised sessions.

> **Not reversed, but read this with it (2026-08-04 evening).** Three further mobile runs
> that same evening **all called the connector** — including one with the engine deliberately
> saturated, and one with the game attached as a file. The 16:30 failure did not reproduce
> under any varied condition, and Zero Trust logging was enabled only afterwards, so no
> edge-side record of it exists or ever will (`docs/first-connection.md`).
>
> One failure in four, cause unknown and now unknowable. That weakens "mobile is broken" but
> **does not retire the decision**: the failure produced a confident, roughly-correct answer
> with invented provenance, and a rare silent failure is still silent. Revisit deliberately,
> with the tester's supervision cost weighed against a ~1-in-4 observed rate on a sample of
> four.

> **Revisited and reversed, 2026-08-05. The beta is not desktop-only.**
>
> Three things decided it, in order of weight:
>
> 1. **The tester can see the provenance himself.** Grok's Thoughts panel names the tool it
>    used — *"Used Chess MCP Server Evaluate Position"*. The failure this section is built
>    on is therefore **not silent to the tester**, only silent in the prose. This section's
>    central claim — "the only thing distinguishing fabricated provenance from real
>    provenance was a log on the operator's machine" — is **wrong as written**, and
>    `docs/first-connection.md` contains the evidence against it: the fallback was visible
>    in the client at the time ("Grok began installing packages and running Python").
> 2. **The platform rule did not target the failure.** Nothing establishes that the 16:30
>    substitution was a *mobile* fact rather than a *Grok* fact observed on mobile. Desktop
>    has one observation, not zero risk. Excluding mobile bought less than it appeared to
>    while costing the thing being measured.
> 3. **Desktop-only measures the wrong thing.** The premise is a tester using this on his
>    own games in his own life. A phone is where that happens.
>
> **What carries the risk instead is one line in the tester's instructions**, telling him
> what to look for and that an answer without it does not count
> (`docs/for-my-friend.md`). §11's `.pgn` → `.txt` note is in the same document, since
> mobile is now in scope rather than excluded.
>
> Unchanged: the failure mode is real and its cause is still unknown.

## 11. Tell the tester this, or it reads as our bug

**On mobile, rename `.pgn` to `.txt` before uploading.** The Grok app's file picker rejects
`.pgn` outright; the identical file as `.txt` is accepted and behaves the same
(`docs/first-connection.md`, observed 2026-08-04).

This is Grok's limitation, not the server's — the file never reaches `src/`, since Grok
parses the PGN and sends move text in the JSON body. But the tester's natural workflow is
to export a game from chess software, which emits `.pgn`, and the rejection offers no hint
that renaming fixes it. Unmentioned, it costs a session and reads as a defect in the tool
being evaluated.

§6 scopes this beta to analysis quality on the premise that a tester who installs nothing
meets no setup friction. This is the counterexample: friction that survives having nothing
to install.
