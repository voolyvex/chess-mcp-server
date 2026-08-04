# A tunnel is not hosting, and the beta endpoint is not authenticated

**Status:** accepted

**Date:** 2026-08-03

## Context

A beta tester — a friend who already analyses his games with Grok and Stockfish side by
side, copying numbers between two windows — needs to reach this server. Grok's connectors
execute on xAI's infrastructure, not in the user's browser, so `localhost` is rejected:
*xAI's* servers must resolve the URL. Something has to make the handler publicly
reachable.

That collides with two recorded decisions. `docs/prd.md:35` scopes this project to
"Single-machine, localhost. No hosting, TLS, OAuth, or multi-tenancy," and decision 7 in
`docs/decisions.md` says "Localhost first [...] No TLS, OAuth, or hosting on the critical
path." Crossing those silently is the failure mode this ADR exists to prevent.

The research behind this decision is `docs/tunnel-handoff.md`, which marks its claims by
strength. Three of its open questions were closed by direct observation and one by
Cloudflare's own documentation; the answers are what forced the shape below.

### What was observed

**Grok's Custom connector dialog has two fields: Name and Server URL.** No auth-type
selector, no headers field. The placeholder reads `https://mcp.example.com/sse`.

That single observation eliminates every header-based authentication design:

- A **bearer token** checked in `src/index.ts` needs an `Authorization` header. There is
  nowhere to enter one.
- **Cloudflare Access service tokens** — the clean, edge-enforced option that would have
  left `src/index.ts` untouched — need *two* headers, `CF-Access-Client-Id` and
  `CF-Access-Client-Secret`. Strictly worse off than bearer, not better.

The handoff's Q2 and Q3 are therefore answered together: Grok's web UI can send neither a
static bearer token nor Cloudflare's service-token pair.

**Cloudflare's free tier is sufficient**, which the handoff had flagged as unverified.
Zero Trust free covers 50 users and 50 protected applications, and a named tunnel carries
no request quota comparable to ngrok's 20,000/month. That quota was ngrok's only real
ceiling, and the objection to Cloudflare — "requires a domain already on Cloudflare DNS" —
dissolved on learning the operator owns two domains outright.

**The `/sse` placeholder is a hint about transport, not a blocker.** This server is
Streamable HTTP. The older HTTP+SSE transport requires the server to emit an `endpoint`
event on stream open, naming where the client should POST; `sseKeepAliveStream` in
`src/mcp-handler.ts` deliberately emits nothing but keep-alive comments. A true HTTP+SSE
client would stall waiting for that event.

This is cheap to survive rather than expensive, because **the handler does not route on
path** — no `pathname` check exists in `src/index.ts` or `src/mcp-handler.ts`. `/mcp`,
`/sse`, and any other path reach the same code. A GET to `/sse` asking for
`text/event-stream` already receives an open stream today. If Grok turns out to speak the
older transport, the gap is one `endpoint` event, not a transport rewrite.

## Decision

**A named tunnel is not hosting, and it is recorded here rather than assumed.**

`cloudflared` runs on the operator's machine and dials *out* to Cloudflare. No port is
opened, no inbound firewall rule exists, no server is provisioned or paid for, and TLS
terminates at Cloudflare's edge rather than in this codebase. `src/index.ts` is not
modified: it still binds a plain HTTP port and still contains no authentication. Nothing
enters the critical path.

What changes is one fact, and it is not a small one: **the handler becomes reachable from
the internet.** `docs/prd.md:35` remains the design constraint for the server. This ADR
records a deliberate, time-boxed exception for a beta, not a repeal.

**The beta endpoint is unauthenticated, knowingly.** With header auth unreachable from
Grok's UI, the remaining controls are not authentication and are not described as such:

1. **An obscure hostname.** A random subdomain on `thymosengine.com` rather than a
   guessable `mcp.`. This resists casual enumeration of the domain and nothing else. The
   handoff searched for evidence that tunnel-provider domains are actively scanned and
   found none it could source; the argument for caution rests on the endpoint being
   unauthenticated and reachable, which is certain, not on a scanning claim.
2. **Rate limiting at the edge.** Does not prevent access. Bounds the cost of abuse to
   something below the point where a stranger can pin the operator's CPU with Stockfish
   searches.
3. **An IP allowlist, if it proves possible.** The only genuine access control available,
   and it needs no client cooperation — which is exactly why it survives a UI that can
   send no headers. Whether xAI's connector egresses from a stable range is unknown and
   observable in Cloudflare's logs on first connect.

**The first connection is an instrument.** The operator connects from their own Grok
account before the tester receives any URL. That one exchange resolves, from Cloudflare's
logs: which path Grok requests, whether it opens a GET stream, which transport it speaks,
what headers it actually sends, and what source addresses it arrives from. Every remaining
open question in the handoff is answered by reading that log rather than by more research.

## Consequences

**The operator is the tester's uptime.** Testing happens only while the laptop is awake,
Docker is up, and `cloudflared` is running. A stable hostname removes URL re-pasting; it
does not remove the person. Availability is now a commitment for the beta's duration, and
that is the real price of choosing a tunnel over hosting — paid in attention rather than
dollars.

**This beta tests analysis quality and not installability.** The tester installs nothing,
so nothing is learned about the install path. Given who he is — an existing
Grok-plus-Stockfish user with a baseline to compare against, not a developer evaluating a
README — that is the right split. Installability is a separate question for a later and
different tester.

**Hosting was not chosen, only deferred.** Hosting would resolve authentication and uptime
together, and it remains the honest answer for anything past a single-tester beta. It
would also require OAuth on the critical path, a new scope, and real work before anything
had been learned about whether Grok's connector talks to this server correctly at all.
The tunnel defers both problems rather than solving either. When the beta ends, this
exception ends with it: the tunnel comes down, or hosting gets its own ADR.

**The IP allowlist decides how long this posture is tenable.** If xAI's egress addresses
are stable, the endpoint gains real access control and a multi-week beta is defensible.
If they are not, the beta runs on obscurity and rate limiting alone, and its length
should be reconsidered rather than extended by default.

**What this does not license.** No TLS code, no OAuth flow, no per-tenant anything in this
repo. The seam is the tunnel, and it lives in `deploy/`, not `src/`. If authentication
ever becomes reachable — a Grok UI that grows a headers field, or a different client —
Cloudflare Access service tokens are the design to reach for, because they keep auth at
the edge and this codebase ignorant of it.
