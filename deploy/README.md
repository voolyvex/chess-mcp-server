# Deployment

## systemd user units

`chess-engine.service` brings up the Stockfish container; `chess-mcp.service` runs the
handler on :8091 and is ordered after it. Both are **user** units — no root daemon, no
system-wide install.

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now chess-engine.service chess-mcp.service
```

### Lingering is required for boot survival

User units stop at logout and do not start at boot unless the user lingers:

```bash
sudo loginctl enable-linger $USER
```

Without this the services come back when you log in, not when the machine boots. On WSL2
this is the difference between the server being up because you opened a terminal and it
being up because the machine is on.

### Assumptions baked into the units

- Node lives at `~/.nvm/versions/node/v20.20.2/bin/node`. nvm's node is not on the default
  systemd PATH, so the unit sets it explicitly — **a node upgrade means editing
  `chess-mcp.service`.**
- The checkout is at `~/projects/chess-mcp-server`. The units use `%h`, so the home
  directory is not hardcoded, but the path under it is.
- `ExecStart` invokes `tsx` directly rather than `npm start`, to keep an npm process from
  sitting between systemd and the server and muddying signals and exit codes.
- `chess-mcp` uses `Wants=`/`After=`, not `Requires=`. The handler reports an unreachable
  engine as an error rather than crashing, and that error path is worth keeping — `Requires=`
  would tear the handler down with the engine and lose it.

### Checking on it

```bash
systemctl --user status chess-mcp.service
journalctl --user -u chess-mcp.service -f
```

## The tunnel (beta only)

Exposes the handler to Grok's connectors, which run on xAI's infrastructure and therefore
cannot reach `localhost`. **Read `docs/adr/0005-a-tunnel-is-not-hosting-and-the-endpoint-is-not-authenticated.md`
before running any of this** — it records why the endpoint is unauthenticated, what that
costs, and that the exception ends when the beta does.

`chess-tunnel.service` runs `cloudflared` and is ordered after `chess-mcp.service`, on the
same soft `Wants=`/`After=` pattern and for the same reason: the tunnel being up is what
makes an unreachable handler visible from outside.

### Three interactive steps, which no script can do for you

Each needs a browser login. They are in order; DNS propagation sits between the first and
the second.

**1. Move the domain to Cloudflare's nameservers.** Add `thymosengine.com` as a zone in the
Cloudflare dashboard (Add a site → Free plan). Cloudflare assigns a nameserver pair. At
Namecheap, replace the existing `dns1.registrar-servers.com` / `dns2.registrar-servers.com`
with that pair. Cloudflare emails when the zone goes active — usually minutes, allow hours.

`thymosengine.com` is the right domain to move: it currently serves nothing, so nothing
breaks. `claricengine.com` is live on GitHub Pages and moving it would mean re-creating
those records on Cloudflare for no gain.

**2. Authenticate `cloudflared` and create the tunnel.**

```bash
cloudflared tunnel login                    # blocks on a browser login — see below
cloudflared tunnel create chess-mcp         # prints a UUID, writes ~/.cloudflared/<UUID>.json
cloudflared tunnel route dns chess-mcp <random-label>.thymosengine.com
```

`login` is not a command that returns; it prints a `dash.cloudflare.com/argotunnel?...`
URL, waits for you to complete it in a browser, and only then writes `~/.cloudflared/cert.pem`.
**On WSL2 it cannot open the browser** — copy the URL into Windows by hand. The browser
shows a zone picker; **choose the zone from step 1**, because that choice is what the
certificate authorises. Wait for `You have successfully logged in` before running anything
else.

If `login` is skipped, interrupted, or its URL never opened, no `cert.pem` is written and
the next command fails with `Cannot determine default origin certificate path`. That error
means step 2 has not happened yet — not that anything is misconfigured. `ls ~/.cloudflared/cert.pem`
distinguishes the two.

Two ways to complete a login and still hit that error: being signed into a **different
Cloudflare account** than the one holding the zone, which shows an empty picker; and
running `create` under `sudo`, which looks for the cert in root's home rather than the
home that `login` wrote to. Run every command in this section as the same unprivileged
user.

Step 1 must be **finished**, not merely started — a zone whose nameserver change has not
propagated does not appear in the picker at all. `dig +short NS thymosengine.com` returning
Cloudflare nameservers is the check.

**The subdomain label is a random string, not `mcp`.** `k7m2q9x4.thymosengine.com`, not
`mcp.thymosengine.com`. This is obscurity, which is not authentication — it resists casual
enumeration of the domain and nothing else (ADR-0005). Generate one with
`openssl rand -hex 4` rather than choosing something memorable.

**3. Fill in the config and start the unit.**

```bash
mkdir -p ~/.cloudflared
cp deploy/cloudflared/config.yml.example ~/.cloudflared/config.yml
# edit: tunnel UUID, credentials-file path, hostname
cp deploy/systemd/chess-tunnel.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now chess-tunnel.service
```

The real `config.yml` and the credentials JSON stay out of the repo. The credentials file
is a bearer secret for the tunnel — anyone holding it can serve traffic on that hostname.

### The first connection is an instrument, not a demo

Connect from **the operator's own Grok account first**, before the tester receives any URL.
Grok's Custom connector dialog takes a Name and a Server URL and nothing else; give it the
hostname from step 2. Ask one chess question, then read Cloudflare's logs.

That single exchange answers, from the wire rather than from research: which path Grok
requests, whether it opens a `text/event-stream` GET, which MCP transport it speaks, what
headers it actually sends, and what source addresses it arrives from. The last one decides
whether an IP allowlist — the only real access control available here — is possible at all.

Do not skip this. Every remaining open question in `docs/tunnel-handoff.md` is answered by
reading that log.

### Taking it down

```bash
systemctl --user disable --now chess-tunnel.service
```

The beta's end is the tunnel's end. Leaving an unauthenticated endpoint up past the point
where someone is watching it is the failure mode ADR-0005 exists to name.

## Skills

The operator discipline ships in two places, same content, different conventions:

| Scope | Claude Code | Codex |
|---|---|---|
| Project | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| Personal | `~/.claude/skills/<name>/SKILL.md` | `~/.agents/skills/<name>/SKILL.md` |

Codex resolves skills in this order: `$CWD/.agents/skills`, then every parent directory up
to `$REPO_ROOT/.agents/skills`, then `$HOME/.agents/skills`, then `/etc/codex/skills`, then
its own bundled skills. `~/.codex/skills` appears in some third-party write-ups and is
supported as a legacy path, but it is not in the official documentation — prefer
`~/.agents/skills`.

Both agents discover skills the same way, and it matters for how these files are written.
Each reads *only* the `name`, `description`, and path up front, then loads the full
SKILL.md if it decides the skill applies. Codex calls this implicit invocation and its
documentation is explicit that matching depends on the `description` field. **So the
description carries the routing burden in both files** — a vague one means the skill is
never loaded, and nothing in the body can compensate.

Codex has no hot reload for skills: an edit is not picked up by the session that is already
running. Start a new session after changing either file (openai/codex#12227, #16653).

**Keep the two SKILL.md files in sync.** They are versioned with the schema they describe —
a response-shape change invalidates both.
