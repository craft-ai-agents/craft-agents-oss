# CLAUDE.md — `@craft-agent/core`

## Purpose
`@craft-agent/core` is the shared **type layer** used across the monorepo.

## Current scope
- Type exports for workspaces, sessions, messages, and agent events. `AgentEvent.text_discard` targets one unfinished assistant by `turnId`; `messages_retracted` removes a reply the backend took back (its turns' text, finished or not, its tool calls and their subagents' output: `withoutRetractedMessages`); `model_refusal` is a safeguards notice, with `fallbackModel` when the session goes on with another model; `retry` reports backoff/active/end explicitly; `context_usage` reports current occupancy separately from cumulative/billable `TokenUsage`; `complete.usage.runningTotals` are backend running totals, so consumers add the change since the last totals and never sum them. Stream consumers must discard failed partials without touching completed history and must not treat stale terminal usage as a fresh context snapshot.
- Lightweight shared utility exports (for cross-package consistency).

## Commands
From repo root:
```bash
cd packages/core && bun run tsc --noEmit
```

## Hard rules
- Keep this package stable and dependency-light.
- Prefer type-only changes unless there is a clear cross-package runtime need.
- When changing exported types, validate downstream usage in `packages/shared` and `apps/*`.

## Source of truth
- Public exports: `packages/core/src/index.ts`
- Type definitions: `packages/core/src/types/`
- Utility exports: `packages/core/src/utils/`
