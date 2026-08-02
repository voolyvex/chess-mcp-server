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
| Personal | `~/.claude/skills/<name>/SKILL.md` | `~/.codex/skills/<name>/SKILL.md` |

`.agents/skills/` is the portable project-local convention; some Codex repos use
`.codex/skills/` instead. Codex may need a restart or a new task before it discovers a
newly added skill.

**Keep the two SKILL.md files in sync.** They are versioned with the schema they describe —
a response-shape change invalidates both.
