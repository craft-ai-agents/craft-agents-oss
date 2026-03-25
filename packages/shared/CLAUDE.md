# CLAUDE.md — `@craft-agent/shared`

## Purpose
Core business logic package for Craft Agent:
- Agent backends and session-scoped tools
- Sources, credentials, sessions, and config
- Permission modes and validation

## Key folders
- `src/agent/` — `claude-agent.ts`, `pi-agent.ts`, `base-agent.ts`, tools, permissions
- `src/sources/` — source storage/types/services
- `src/sessions/` — session persistence/index
- `src/config/` — config/preferences/theme/watcher
- `src/credentials/` — encrypted credential management

## Commands
From repo root:
```bash
cd packages/shared && bun run tsc --noEmit
```

## Hard rules
- Permission modes are fixed: `safe`, `ask`, `allow-all`.
- Source types are fixed: `mcp`, `api`, `local`.
- Keep credential handling in `src/credentials/` pathways (no ad-hoc secret storage).
- Keep user-facing tool contracts backward-compatible where possible.

## Notes
- `ClaudeAgent` is the primary class in `src/agent/claude-agent.ts`.
- Claude SDK subprocess env is sanitized to strip Claude-specific Bedrock routing vars (`CLAUDE_CODE_USE_BEDROCK`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`). Pi Bedrock uses its own AWS env path instead.
- Backward alias export (`CraftAgent`) exists for compatibility.
- Session lifecycle distinguishes **hard aborts** from **UI handoff interrupts**:
  - use hard aborts for true cancellation/teardown (`UserStop`, redirect fallback)
  - use handoff interrupts for pause points where control moves to the UI (`AuthRequest`, `PlanSubmitted`)
- Remote workspace handoff summaries are injected as one-shot hidden context on the destination session's first turn.
- Automations matching is unified through canonical matcher adapters in `src/automations/utils.ts` (`matcherMatches*`). Avoid direct primitive-only matcher checks in feature code so condition gating stays consistent across app and agent events.

## Source of truth
- Package exports: `packages/shared/src/index.ts` and subpath export entries.
- Agent exports: `packages/shared/src/agent/index.ts`
