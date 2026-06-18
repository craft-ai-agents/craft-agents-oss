# CLAUDE.md — `@craft-agent/core`

## Purpose
`@craft-agent/core` is the shared **type layer** used across the monorepo.

## Current scope
- Type exports for workspaces, sessions, messages, and agent events.
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
