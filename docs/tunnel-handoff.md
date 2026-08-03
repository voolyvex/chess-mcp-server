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

## The blocker that outranks all of this

**Custom (BYO) MCP connectors are probably SuperGrok-gated.** Multiple secondary sources
state the BYO-MCP path requires SuperGrok or higher, while first-party catalog connectors
reach the free tier. xAI's own connectors doc says only "Connectors are available to all
Grok users" and does not address the custom path either way — so this is **strongly
indicated but not confirmed from the primary source.**

If true, the entire tunnel plan fails for a free-tier tester, and no amount of tunnel
engineering fixes it. Same paywall that ruled out Grok Build CLI (SuperGrok $30/mo, no
free tier).

**Verify before writing any tickets:** have the tester open grok.com/connectors and
report whether *New Connector → Custom* is present and clickable on their account. Five
minutes, and it gates everything downstream. Everything in this document is contingent
on that answer.

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

Options, in order of preference:

1. **Bearer token in the server**, passed as a connector auth header. Small change; Grok
   supports auth on custom connectors. Makes the URL safe to hand over.
2. **ngrok-side auth** — ngrok can enforce a header/basic-auth at the edge without
   touching the server. Fastest, and free-tier availability of the specific traffic-policy
   feature needs checking.
3. **Run only during supervised sessions.** Acceptable for a one-hour scheduled test;
   not for a multi-week beta.

Do not skip this. A token is the difference between handing over a URL and handing over
the laptop.

## Operational reality to weigh before committing

- **The operator becomes the tester's uptime.** Testing only happens while the laptop is
  awake, Docker up, tunnel running. Sleep, reboot, or network change ends the session.
  Stable URL means no re-pasting, but availability is still a person.
- **What is the beta testing?** This path tests engine correctness and response quality
  well. It tests *installation* not at all — the tester installs nothing. If
  "can someone stand this up?" is a beta goal, this design cannot answer it.
- **Cost comparison is closer than it looks.** Tunnel is free in dollars but costs
  operator availability for the beta's duration. If the custom-connector paywall holds,
  the choice collapses to hosting (which also solves auth and uptime) or running the beta
  on Claude, where `.claude/skills/` and `CLAUDE.md` load natively.

## Open questions for the grilling session

1. Is *New Connector → Custom* available on the tester's free account? **Gates everything.**
2. Bearer token in `src/index.ts`, or ngrok edge auth? Is edge auth on the free tier?
3. Does Grok's connector open the SSE GET, or only POST? (Observe in ngrok inspector.)
4. Is the beta testing the analysis quality, or the install path? Changes the whole design.
5. If the paywall holds — host it, or move the beta to Claude?
6. Does 20k requests/month survive the tester's actual usage pattern?

## Sources

- ngrok free plan limits — https://ngrok.com/docs/pricing-limits/free-plan-limits
- ngrok static dev domains — https://ngrok.com/blog/free-static-domains-ngrok-users
- ngrok pricing — https://ngrok.com/pricing
- xAI custom MCP tunneling — https://docs.x.ai/grok/connectors/custom-mcp-tunneling
- xAI connectors — https://docs.x.ai/grok/connectors
- xAI Skills/plugins — https://docs.x.ai/build/features/skills-plugins-marketplaces
- MCP Streamable HTTP spec — https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http
