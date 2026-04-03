---
name: opencode-plugin-dev
description: Build and refine OpenCode harness, MCP, plugin, prompt, and agent-tooling code while preserving the repo's existing architecture and conventions.
---

## Purpose

Use this skill for work in `opencode-pair-autonomy`, related OpenCode plugins, and MCP or agent-tooling repositories in this workspace.

## Use When

- The task touches prompts, tool wiring, plugin install flows, MCP servers, vendor wrappers, or agent coordination.
- The repo uses TypeScript with `@modelcontextprotocol/sdk`, Zod, CLI wiring, plugin manifests, or prompt assembly.
- You need to preserve harness behavior while extending skill usage, tool exposure, or automation flows.

## Working Method

1. Inspect existing prompt layers, install flow, and tool contracts before changing behavior.
2. Reuse current naming, file placement, and config conventions for plugins, MCP wrappers, and prompts.
3. Keep changes additive and architecture-preserving unless the user explicitly requests a structural shift.
4. Verify downstream behavior with targeted checks when touching prompt policy, installer logic, or plugin discovery.
5. Surface user-visible behavior changes clearly, especially when they affect session restart, tool availability, or external installs.

## Repo Conventions To Prefer

- Keep prompt policy explicit, concrete, and action-oriented.
- Prefer dedicated tools over shell when the harness already exposes a safer interface.
- Preserve non-interactive shell assumptions for installs, git, and automation.
- Keep MCP schemas and validation tight, with descriptive errors and stable tool names.
- Avoid hidden magic; make automation behavior legible in code and config.

## Guardrails

- Do not silently broaden permissions, change security posture, or alter external side effects.
- Do not add new dependencies when current tooling or plugins already solve the problem.
- Do not make prompt changes that encourage architecture drift or speculative behavior.
