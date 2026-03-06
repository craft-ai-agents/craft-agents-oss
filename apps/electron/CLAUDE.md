# CLAUDE.md — Electron App (`apps/electron`)

## Purpose
Primary desktop interface for Craft Agents:
- Multi-session chat UI
- Session/source/workspace management
- Main-process integration with `@craft-agent/shared`

## Commands (run from repo root)
```bash
bun run electron:dev
bun run electron:start
bun run electron:build
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
bun run electron:build:resources
```

## Critical rules
- Use shadcn/ui primitives from `src/renderer/components/ui/`.
- In renderer code, **do not import Node-dependent `@craft-agent/shared` logic directly**.
  - Use IPC (`main/ipc.ts` + `preload/index.ts`) for main-process access.
- Use `Spinner` / `LoadingIndicator` for loading states.
- Use Sonner toasts for non-blocking notifications.
- Prefer structured logging over `console.log`.

## Logging
- Main process logs in debug mode:
  - `~/Library/Logs/@craft-agent/electron/main.log`
- Scoped loggers are defined in `src/main/logger.ts`.

## Document tools rule
If you change files under:
- `apps/electron/resources/scripts/`
- `apps/electron/resources/bin/`

then also:
1. update/add smoke tests in `apps/electron/resources/scripts/tests/`
2. run `bun run test:doc-tools` from repo root

## Source of truth pointers
- Main process: `apps/electron/src/main/`
- Renderer: `apps/electron/src/renderer/`
- Preload bridge: `apps/electron/src/preload/index.ts`
- IPC contracts: `apps/electron/src/shared/types.ts`

## Doc policy
Keep this file short. Avoid exhaustive channel/component inventories that drift quickly.
