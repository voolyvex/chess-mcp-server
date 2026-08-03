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
