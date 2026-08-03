# Tunnel handoff: exposing the beta to a free-tier Grok user

Research only. No tickets written, no code changed. For grilling in a fresh session.

Date: 2026-08-03. Everything below dated because tunnel free tiers move.

## The shape of the plan being tested

Operator runs the engine and the MCP handler on their own laptop, exposes `:8091/mcp`
through a tunnel with a stable public URL, and hands the beta tester a URL to paste into
grok.com → Connectors → New Connector → Custom. The tester installs nothing.

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

- A *named* tunnel mapped to a hostname never changes, free plan, no request cap of
  note. Requires **a domain already on Cloudflare DNS** — that's the cost, not money.
- The `trycloudflare.com` **quick** tunnel is the ephemeral one: random URL, changes on
  restart, 200 concurrent request cap, and **no SSE support**. This is what the xAI docs
  warn about, and it is a different product from a named tunnel. Do not conflate them.

### Recommendation

**ngrok**, unless a Cloudflare-managed domain is already on hand — in which case a named
tunnel is strictly better (no request cap, no interstitial, no vendor quota). ngrok wins
on setup cost from zero: no domain required, three commands.

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

**20k requests/month is the only real ceiling**, and it is almost certainly fine: one
tester doing chess analysis makes tens of calls per session, not thousands. Worth a
sanity count during the beta rather than a design constraint. Note MCP handshakes and
any polling count toward it too.

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

Grok Skills, separately: a real upload surface accepting `.md` / `.skill` / `.zip` in the
Anthropic SKILL.md format, loaded into the system prompt — not chat-pasting. Also
reported paid-only. **Largely moot**: operator discipline ships in the tool description
(`src/mcp-handler.ts:237-241` and the `movetime_ms` text at :60-76), so a tester without
Skills still gets the constraints that matter. The skill is reinforcement, not the
carrier. This weakens the case for caring about the Skills paywall at all.

## Security: the part that needs a decision, not a ticket

**The server has no authentication.** No bearer token, no origin check, nothing in
`src/index.ts`. Correct for a localhost bind; **not** correct behind a public URL.

A tunnel makes it internet-reachable. Tunnel URLs are not secrets — the `.ngrok-free.app`
space is scanned. Consequences of an open endpoint:

- Anyone reaching it drives Stockfish on the operator's laptop — CPU burn, and a trivially
  effective way to exhaust the 20k/month request quota.
- It is an unauthenticated compute endpoint on a personal machine.

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
  well. It tests *installation* not at all — the tester installs nothing. If
  "can someone stand this up?" is a beta goal, this design cannot answer it.
- **Cost comparison is closer than it looks.** Tunnel is free in dollars but costs
  operator availability for the beta's duration. Hosting would solve auth and uptime
  together; the tunnel solves neither, it just defers them. That trade is now a genuine
  choice rather than a forced move — the paywall no longer decides it.

## Open questions for the grilling session

Q1 is answered: **custom connectors work on the free tier**, observed directly. The
remaining questions are all downstream of auth.

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
