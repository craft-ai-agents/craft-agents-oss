# Global Update Agent Backlog

## Idea

Create a globally installed `Update Agent` plus `update-audit` skill.

Its job is to scan local tools, agents, skills, MCP servers, Pi packages, bundled CLIs, and app dependencies, then report what is stale, broken, missing, or unsafe to upgrade automatically.

## Why

RunnerOS is becoming a local tool control plane. Built-in tools like Hypermotion, Social Publisher, 3DCellForge, Pi, MCP servers, and Codex skills need health checks and update checks without relying on memory.

## Scope

- Scan `/Users/michaelb.williams/.codex/skills`
- Scan `/Users/michaelb.williams/.agents/skills`
- Scan `/Users/michaelb.williams/.agents/agents`
- Scan RunnerOS `tools/*`
- Scan key package versions in RunnerOS package workspaces
- Check Pi package versions
- Check MCP server package specs in `.codex/config.toml`
- Run each tool's `doctor` command when available

## Output

- Current version
- Latest available version
- Health status
- Upgrade risk
- Exact command to update
- Whether the update should be auto-applied, proposed, or avoided

## Safety Rules

- Never auto-upgrade app runtime deps without a branch and tests.
- Tool-local deps may be updated with focused doctor checks.
- Global agent/skill edits must rebuild Codex catalog.
- Secrets and auth files are read for presence only, never printed.

## First Implementation Slice

Build `tools/update-audit` with:

- `doctor`
- `scan --json`
- checks for `tools/hypermotion`, `tools/printing-press-social`, Pi packages, and Codex/agents catalog freshness.

Then create `Update Agent` that uses it.
