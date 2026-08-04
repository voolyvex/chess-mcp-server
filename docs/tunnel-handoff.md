# Tunnel handoff: exposing the server to a free-tier Grok user

Date: 2026-08-03. Everything below dated because tunnel free tiers move.

> **This research has been grilled and its recommendation overturned. Read
> `docs/adr/0005-a-tunnel-is-not-hosting-and-the-endpoint-is-not-authenticated.md` first —
> it records what was decided and why. This file is kept as the evidence behind that
> decision, not as a live proposal.**
>
> What the grilling changed, in one place:
>
> - **Cloudflare, not ngrok.** The operator owns `thymosengine.com` and `claricengine.com`
>   outright. The "needs a domain already on Cloudflare DNS" objection was a ten-minute
>   nameserver change, not a blocker, and it takes ngrok's 20k/month request quota off the
>   table entirely. Cloudflare Zero Trust free covers 50 users and 50 applications.
> - **Header auth is dead.** Grok's Custom connector dialog was observed to have exactly
>   two fields, **Name** and **Server URL**, with a placeholder of
>   `https://mcp.example.com/sse`. No auth-type selector, no headers field. That kills
>   bearer tokens (option 2 below) *and* Cloudflare Access service tokens, which need two
>   headers rather than one. Q2 and Q3 below are answered: it can send neither.
> - **The endpoint will be unauthenticated, knowingly.** Obscure hostname, edge rate
>   limiting, and an IP allowlist if xAI's egress proves stable. Only the last is real
>   access control. See the ADR's consequences.
> - **`/sse` in the placeholder is a transport hint, not a blocker.** The handler does not
>   route on path, so `/sse` already reaches the same code and already answers a
>   `text/event-stream` GET. The gap, if Grok speaks the older HTTP+SSE transport, is one
>   `endpoint` event — a small contingent fix, not a rewrite.
> - **Multi-week beta**, operator-run. The operator is the tester's uptime.
>
> Still open, and all answered by the same first connection: which transport Grok speaks,
> whether it opens the SSE GET, what it sends on the wire, and whether xAI's source
> addresses are stable enough to allowlist. Connect from the operator's own account and
> read Cloudflare's logs before the tester sees a URL.

Research only. No code changed by the research itself; the ADR, `deploy/cloudflared/`, and
`deploy/systemd/chess-tunnel.service` came out of the grilling that followed.

**How to read this.** Claims are marked by strength. **Observed** = seen first-hand.
**Primary** = from ngrok's or xAI's own docs. **Secondary** = blogs and aggregators,
which have already been wrong once here (see the paywall section). **Inference** = my
reasoning from a verified fact, flagged as such. Where a claim could not be verified it
says so rather than being quietly dropped.

## The shape of the plan being tested

Operator runs the engine and the MCP handler on their own laptop, exposes `:8091/mcp`
through a tunnel with a stable public URL, and hands the tester a URL to paste into
grok.com → Connectors → New Connector → Custom. The tester installs nothing.

**Who the tester is** (shapes what matters): a friend who already uses Grok to analyse
chess games with Stockfish alongside it, manually. Not a developer being asked to
evaluate an install. This is a real workflow upgrade for him — the engine numbers arrive
inside the conversation instead of being copied between two windows. Consequences:

- The "this tests analysis quality, not installability" tradeoff below is **the right
  tradeoff**, not a compromise. He is the target user for the tool, not for the repo.
- He has a **baseline to compare against** — his current manual Stockfish workflow. That
  makes him a genuinely useful tester of whether the numbers and the discipline hold up.
- Phone support matters more than it would for a developer tester (see below).

## Question that was asked: can a free tunnel hold a stable URL?

**Yes. Both candidates do, and this is no longer the differentiator it was.** The "URL
shuffles on every restart" problem was real for years and is the thing most write-ups
still warn about. It has been fixed on ngrok's free tier since 2023 and was never a
property of Cloudflare *named* tunnels.

### ngrok free — one assigned static domain

- One auto-assigned dev domain, form `something-something.ngrok-free.app`, tied to the
  account, **stable across agent restarts**. Claimed once from the dashboard, then used
  with `ngrok http 8091 --url <domain>`.
- **No endpoint timeout.** ngrok's own docs: "Free endpoints have no timeout—they can
  stay online indefinitely." The widely-repeated "2-hour session limit" traces to
  competitor marketing (InstaTunnel blog posts), not to ngrok. Treat it as false.
- Custom/branded domains need a paid plan. The assigned one is free and sufficient.

### Cloudflare named tunnel — stable, but needs a domain

- A *named* tunnel mapped to a hostname never changes, free plan. Requires **a domain
  already on Cloudflare DNS** — that's the cost, not money. (Secondary sources; I did not
  confirm named-tunnel limits against Cloudflare's own docs. The claim of "no request cap
  of note" in an earlier draft was **unverified** — if Cloudflare becomes the chosen
  path, check its actual free-plan limits before relying on that.)
- The `trycloudflare.com` **quick** tunnel is the ephemeral one: random URL, changes on
  restart, 200 concurrent request cap, and **no SSE support**. This is what the xAI docs
  warn about, and it is a different product from a named tunnel. Do not conflate them.

### Recommendation — SUPERSEDED

~~**ngrok**, unless a Cloudflare-managed domain is already on hand~~ — a Cloudflare-managed
domain *was* on hand. The operator owns `thymosengine.com` (currently on Namecheap
nameservers, serving nothing) and `claricengine.com` (GitHub Pages, live). **Cloudflare
named tunnel on a random subdomain of `thymosengine.com` is the decision** — see ADR-0005.

The conditional in the original recommendation was the right one; it just resolved the
other way once the domains were known. Cloudflare's free-plan limits, flagged unverified
below, were subsequently checked: Zero Trust free covers 50 users and 50 protected
applications, with no request quota comparable to ngrok's 20,000/month.

A note for anyone tempted by GitHub Pages, since the operator asked: **it cannot host this
server.** Pages serves static files with no server-side execution; this handler is a live
Node process holding a warm Stockfish container over an HTTP hop. The domain is useful as
the front door to a tunnel; the hosting is not.

## Free-tier limits that actually apply (ngrok)

From ngrok's own pricing-limits docs, not third parties:

| Limit | Free plan | Does it bite? |
|---|---|---|
| Static dev domain | 1, assigned | No — this is the whole ask |
| Endpoint timeout | none | No |
| HTTP requests | 20,000/month | **Watch this** — see below |
| Rate limit | 4,000/min | No |
| Data transfer | 1 GB/month | No — JSON responses are tiny |
| Online endpoints | 3 | No |
| Interstitial page | browser HTML only | **No** — see below |

**The interstitial is a non-issue.** ngrok's docs are explicit that it does not affect
programmatic/API access — it targets browser HTML traffic. Grok's connector is an API
client. If it ever did appear, `ngrok-skip-browser-warning` or a non-standard User-Agent
clears it. Several blog posts imply this breaks API use; they are wrong.

**20k requests/month is the only real ceiling.** My estimate is that one tester analysing
games makes tens of calls per session rather than thousands, which leaves large headroom
— but that is an **inference about usage, not a measurement**, and this tester analyses
chess games as an existing habit, so his volume is unknown. The ngrok dashboard reports
actual request counts; check it after the first real session instead of trusting the
estimate. MCP handshakes and any connector polling count toward the quota too, and
polling in particular could change the arithmetic entirely if Grok does it.

## Transport: verified compatible, and this was the live risk

The xAI tunneling docs warn that Cloudflare quick tunnels don't support SSE and steer
SSE-dependent servers to ngrok. That warning **does not bite this server**, and the
reason is already documented in the code:

- The server is **Streamable HTTP** on `:8091/mcp` (`src/index.ts`), the modern
  transport — explicitly the proxy-friendly one.
- `src/mcp-handler.ts:128-143` records that under `responseMode: 'auto'` a plain
  request/response exchange is answered with **a single JSON body**, and the only thing
  that would upgrade it to a stream is the handler emitting a related message before its
  result — "This one never does — it registers a single tool that returns once, with no
  progress or logging notifications."
- The SSE path (`mcp-handler.ts:119-123`) is a keep-alive stream served **only** to a GET
  that explicitly asks for `text/event-stream`. Tool calls are POSTs answered with JSON.

So tool traffic is ordinary request/response JSON. Proxy buffering — the classic tunnel
failure for SSE — has nothing to buffer. **Either tunnel works.** ngrok's SSE support
just removes the residual risk on the GET path.

Unverified: whether Grok's connector opens the SSE GET at all. Cheap to observe in the
ngrok request inspector on first connect.

## The paywall blocker: CLEARED by direct observation (2026-08-03)

**Custom connectors are available on the free tier.** Checked first-hand on a free
(non-SuperGrok) account: *Skills and Connectors → Connectors → New Connector → + Custom*
is present and prompts for an **MCP Server URL**.

This **overturns** the secondary sources that claimed BYO-MCP requires SuperGrok or
higher (SegmentStream, Plurality, PortEden all say so). They are wrong, or describe a
gate xAI has since removed. Direct observation beats them. xAI's own doc — "Connectors
are available to all Grok users" — turns out to have meant what it said.

The tunnel plan is therefore **viable for a free-tier tester**. Grok Skills is still
reported paid-only, but as noted below that is moot.

Not yet observed, and worth checking in the same dialog: what the *Custom* form offers
**besides** the URL field — specifically whether there is an auth-type selector, an
optional headers field, or nothing at all. That answer picks the auth design (below).

Grok Skills, separately: reported (secondary sources; **not confirmed in xAI's own docs,
and not observed**) to be a real upload surface accepting `.md` / `.skill` / `.zip` in the
Anthropic SKILL.md format, loaded into the system prompt — a distinct UI surface, not
chat-pasting. Also reported paid-only; given those same sources were wrong about the
connector paywall, **that gating claim deserves no confidence either** and can be checked
in the same visit as the connector dialog.

**Largely moot regardless.** Operator discipline ships in the tool description — this
part is **verified in the code**: `src/mcp-handler.ts:237-241` carries "check a move
against this list before asserting it is legal, best, or playable," and the `movetime_ms`
description at :60-76 carries depth-as-outcome. A tester with no Skills access still
receives the constraints that matter, because they arrive with the tool itself. The skill
file is reinforcement, not the carrier.

## Phone: expected to work, and the architecture is why

**The tester's device never touches the tunnel.** Grok's connectors execute on xAI's
servers — that is the same property that forced the tunnel in the first place (localhost
is rejected because *xAI's* infrastructure must reach the URL, not the user's browser).
The phone sends a prompt to xAI; xAI calls the ngrok URL; the laptop answers. The phone
is a thin client and never resolves `ngrok-free.app` itself.

This is a **deduction from a verified fact**, not a separately verified one. It follows
directly from the documented localhost rejection, and it is strong — but see below.

Supporting, from secondary sources only: connectors are reported to have launched on
Grok Web, iOS, and Android (May 2026), with connectors tied to the account so setup on
web carries to mobile. **xAI's own announcement page (x.ai/news/grok-connectors) returned
403 and could not be read**, so platform availability rests on secondary reporting. One
of those same sources also repeats the "paid tiers only" claim that direct observation
has already disproved — so treat their *detail* as unreliable even where the *direction*
is corroborated.

Two things worth noting for the test:

- Mobile connector settings are reported at **Settings → Connectors** rather than the
  web's Skills-and-Connectors screen. Whether a *custom* connector can be **created** on
  mobile, versus only used once created on web, is **unverified** — and it does not
  matter much, since the operator creates the connector on web anyway.
- Nothing about the tunnel, transport, or auth changes between phone and desktop. Same
  URL, same JSON-over-POST traffic, same request quota.

**Cheap to confirm:** the operator tests on their own account first (already the plan) —
add the connector on web, then open Grok on a phone and ask a chess question. If the
answer carries engine numbers, mobile works. Costs one prompt.

## Security: the part that needs a decision, not a ticket

**The server has no authentication.** No bearer token, no origin check, nothing in
`src/index.ts`. Correct for a localhost bind; **not** correct behind a public URL.

A tunnel makes it internet-reachable. Consequences of an open endpoint:

- Anyone reaching it drives Stockfish on the operator's laptop — CPU burn, and a trivially
  effective way to exhaust the 20k/month request quota.
- It is an unauthenticated compute endpoint on a personal machine.

**Claim strength, stated honestly.** An earlier draft asserted "the `.ngrok-free.app`
space is scanned." **That was my inference, not a sourced finding** — searching for
evidence of scanning campaigns against ngrok-free domains turned up ngrok feature
announcements and generic best-practice advice, no security research documenting it.
What *is* documented, from ngrok's own material: leaving a static URL without access
controls "leaves it open to the public," and exposing endpoints without authentication is
listed as a common mistake. The argument for auth rests on the endpoint being
unauthenticated and reachable, which is certain — not on a scanning claim I cannot
support. Treat the risk as real but unquantified.

With the paywall cleared, **this is now the deciding design question**, and it is
awkward — because it is not obvious Grok's custom-connector UI can send a static token.

### The complication

The observed dialog asks for an **MCP Server URL**. Whether it also offers an auth-type
selector or a headers field is **unknown** — worth a second look at the same screen,
since it decides everything below.

The xAI docs say only "complete any required authentication" and "if your MCP server
requires OAuth or API keys, you will still complete that flow in Grok" — no statement
about static bearer tokens or a no-auth option.

**A caution for the grilling session:** searches on this turn up GitHub issues titled
"Cannot configure Authorization: Bearer for custom remote MCP" and "no 'no auth' option
in admin UI". Those are filed against **`anthropics/claude-ai-mcp` — Claude's connector
UI, not Grok's.** They are *not* evidence about Grok and must not be cited as such. I
nearly propagated that error. Grok's actual behaviour on both questions is unverified.

Two unknowns follow, and they pull in opposite directions:

- If Grok **cannot** declare a server unauthenticated, an anonymous server may fail to
  connect at all — auth becomes mandatory to work, not just to be safe.
- If Grok **cannot** send a static bearer token, then server-side token auth is
  unreachable from the web UI, and edge auth is the only option.

### Options

1. **ngrok edge auth (basic-auth traffic policy).** Enforces credentials at the tunnel
   before traffic reaches the laptop; server untouched, so it respects `docs/prd.md:35`
   ("No hosting, TLS, OAuth, or multi-tenancy in scope") and ADR-7. Free tier includes
   **the first 2,000 requests with actions enabled** — beyond that it needs a paid plan,
   which may or may not cover a beta. Unknown whether Grok's UI can supply basic-auth
   credentials.
2. **Bearer token in `src/index.ts`.** Small, self-contained, works regardless of tunnel
   vendor. Blocked if the connector UI cannot send a custom header.
3. **Supervised sessions only.** Tunnel runs during a scheduled hour with the operator
   watching, then stops. Sidesteps both unknowns entirely and needs no code. Good for a
   first session; not a multi-week posture.

**Recommendation: start with (3) for the first session**, which needs no decision and no
code, and use it to *observe* what the connector actually sends — the ngrok request
inspector will show the headers verbatim. That converts both unknowns into facts, and
then (1) or (2) is an informed choice rather than a guess.

Do not hand over a persistent URL on an unauthenticated endpoint. A token is the
difference between handing over a URL and handing over the laptop.

## Operational reality to weigh before committing

- **The operator becomes the tester's uptime.** Testing only happens while the laptop is
  awake, Docker up, tunnel running. Sleep, reboot, or network change ends the session.
  Stable URL means no re-pasting, but availability is still a person.
- **What is the beta testing?** This path tests engine correctness and response quality
  well, and *installation* not at all — the tester installs nothing. Given who he is
  (an existing Grok-plus-Stockfish user, not a developer), that is the **right** split:
  the questions worth answering are whether the numbers are trustworthy and whether the
  operator discipline survives contact with a real user. Installability is a separate
  question for a later, different tester.
- **Cost comparison is closer than it looks.** Tunnel is free in dollars but costs
  operator availability for the beta's duration. Hosting would solve auth and uptime
  together; the tunnel solves neither, it just defers them. That trade is now a genuine
  choice rather than a forced move — the paywall no longer decides it.

## Open questions — RESOLVED BY THE GRILLING SESSION

The grilling happened on 2026-08-03. Status of each question below, then the list as
originally written.

| # | Status after grilling |
|---|---|
| 0 | **Open — and now the single gating action.** Nothing else is learned until it runs. |
| 1 | **Answered.** Two fields: Name, Server URL. Placeholder `https://mcp.example.com/sse`. Nothing else. |
| 2 | **Answered: no.** No headers field exists, so no static bearer token. Kills option (2). |
| 3 | **Unknown, and now less important.** A two-field form is consistent with both "anonymous only" and "discovers OAuth after save". Observable on first connect. |
| 4 | **Moot.** ngrok is not the chosen vendor. |
| 5 | **Open.** Observable in Cloudflare's logs during Q0. |
| 6 | **Answered: analysis quality, deliberately.** The tester installs nothing. Right split for who he is. |
| 7 | **Moot as a ceiling** — Cloudflare has no comparable quota — but still worth watching as a signal of abuse. |
| 8 | **Answered.** ADR-0005 records the exception explicitly rather than drifting past `docs/prd.md:35` and decision 7. |

A question the original list did not contain, surfaced by the `/sse` placeholder:
**which transport does Grok speak?** Streamable HTTP works today. True HTTP+SSE stalls
waiting for an `endpoint` event that `sseKeepAliveStream` does not emit. Contingent fix,
small, only build it if the logs show it is needed.

Also outstanding: **existing GitHub issue #7, "Bearer token auth on the MCP handler", is
now unbuildable as written** and needs closing or rewriting against the ADR-0005 controls.

The list as originally written, for reference:

Q1 is answered: **custom connectors work on the free tier**, observed directly. The
remaining questions are all downstream of auth.

0. **Does it work end-to-end on the operator's own account, then on a phone?** The
   operator is testing first regardless, so this costs one prompt and answers the phone
   question, the SSE question, and the request-count question at once. Do this before
   anything else here.
1. **What else is in the Custom connector dialog besides the URL field?** An auth-type
   selector? A headers field? Nothing? Decides Q2 and Q3. Cheapest open question here.
2. Can Grok's web UI send a **static bearer token** or custom header? If not, option (2)
   is off the table and edge auth is the only path.
3. Will Grok connect to a server that declares **no authentication at all**, or does it
   assume an OAuth flow? If it assumes OAuth, an anonymous server may not connect —
   making auth mandatory for function, not just safety.
4. Does ngrok's basic-auth traffic policy stay free past **2,000 action-enabled
   requests**, and does that cover the beta's span?
5. Does Grok's connector open the **SSE GET**, or only POST? (Observe in ngrok inspector;
   answers itself during the first supervised session.)
6. Is the beta testing **analysis quality or the install path**? This design tests the
   former well and the latter not at all — the tester installs nothing.
7. Does **20k requests/month** survive the tester's actual usage pattern?
8. Does exposing this conflict with `docs/prd.md:35` and ADR-7 ("Localhost first. No TLS,
   OAuth, or hosting on the critical path")? A tunnel is arguably not "hosting", but a
   bearer token in `src/index.ts` is auth on the critical path. **Worth an explicit
   decision — possibly a new ADR — rather than drifting past a recorded one.**

## Sources

- ngrok free plan limits — https://ngrok.com/docs/pricing-limits/free-plan-limits
- ngrok static dev domains — https://ngrok.com/blog/free-static-domains-ngrok-users
- ngrok pricing — https://ngrok.com/pricing
- xAI custom MCP tunneling — https://docs.x.ai/grok/connectors/custom-mcp-tunneling
- xAI connectors — https://docs.x.ai/grok/connectors
- xAI Skills/plugins — https://docs.x.ai/build/features/skills-plugins-marketplaces
- MCP Streamable HTTP spec — https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http
