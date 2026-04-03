# opencode-pair-autonomy

OpenCode harness with opinionated agent orchestration. One coordinator, eight specialized workers, automatic verify+review pipeline.

## What it does

- **Yang Wenli** as coordinator — plans, delegates, synthesizes, never asks for routine permission
- Automatic workflow: implement → build/test (Ozen) → review (Kaiki + Odokawa) → repair (Skull Knight) → re-verify
- Plan/Execute mode switching via `/go` and `/plan` commands
- Session memory with cross-session continuity
- Observation logging and pattern learning
- Comment guard that catches AI-slop in generated code

## Agents

| Agent            | Role                                   | Model             |
| ---------------- | -------------------------------------- | ----------------- |
| **Yang**         | Coordinator — plans, argues, delegates | claude-opus-4-6   |
| **Thorfinn**     | General implementation                 | claude-sonnet-4-6 |
| **Ginko**        | Web and doc research                   | claude-sonnet-4-6 |
| **Kaiki**        | Senior code review (read-only)         | claude-opus-4-6   |
| **Odokawa**      | Cross-model review (read-only)         | gpt-5.4           |
| **Ozen**         | Build, test, lint verification         | claude-sonnet-4-6 |
| **Skull Knight** | Scoped failure repair                  | claude-sonnet-4-6 |
| **Paprika**      | Frontend, Figma, browser testing       | claude-sonnet-4-6 |
| **Rajdhani**     | Fast codebase exploration              | claude-sonnet-4-6 |

## MCP Servers

`context7`, `grep_app`, `websearch`, `fff`, `jina`, `web-agent-mcp`, `figma-console`, `pg-mcp`, `ssh-mcp`, `mariadb`

## Quick start

```bash
bunx opencode-pair-autonomy install
```

From source:

```bash
git clone https://github.com/cemalturkcan/opencode-pair-autonomy.git
cd opencode-pair-autonomy
bun install && bun run build && bun link
opencode-pair-autonomy install
```

## Commands

```bash
opencode-pair-autonomy install        # wire into OpenCode config
opencode-pair-autonomy fresh-install  # rebuild harness files, keep user config
opencode-pair-autonomy uninstall      # remove harness wiring
opencode-pair-autonomy init           # create project-local config
opencode-pair-autonomy print-config   # inspect generated config
```

## Config

Merges from two layers (project wins):

- `~/.config/opencode/opencode-pair-autonomy.jsonc` — user-level
- `<project>/.opencode/opencode-pair-autonomy.jsonc` — project-level

Create project config:

```bash
opencode-pair-autonomy init
```

## Hooks

| Hook                  | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `session.created`     | Prepare session context injection                                                  |
| `chat.message`        | Inject mode, project docs, session memory (coordinator) or project facts (workers) |
| `tool.execute.before` | Plan mode gate, long-running command detection                                     |
| `tool.execute.after`  | Comment guard, file tracking, compact suggestions                                  |
| `session.idle`        | Save session summary, promote learned patterns, cleanup old sessions               |
| `session.compacting`  | Pre-compact observation snapshot                                                   |

## What install changes

- Patches OpenCode config with harness agents, MCPs, and commands
- Installs `fff-mcp` binary, shell strategy instructions
- Vendors `pg-mcp`, `ssh-mcp`, bundled skills
- Preserves existing user config on normal install

## What uninstall removes

Only harness-managed pieces: plugin wrappers, harness plugin entries, shell strategy entry, vendored background-agents. Preserves user config, MCP folders, skills.
