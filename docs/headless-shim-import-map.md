# Headless Shim Import Map

Generated for Phase 2 from the static import roots:
- `apps/electron/src/server/index.ts`
- `apps/electron/src/server/start.ts`

This map tracks shim drivers for the Bun headless entrypoint.

## Current shim status

| Shim module | Static chain from headless entry | Status | Mitigation/Decision |
|---|---|---|---|
| `electron-log/main` | `server/index.ts -> server/start.ts -> main/sessions.ts -> main/logger.ts -> electron-log/main` and `server/start.ts -> main/model-fetchers/index.ts -> main/logger.ts -> electron-log/main` | **Still required** | Intentionally retained for now. Decision: keep minimal shim until logger adapter/decoupling is implemented in a later follow-up. |
| `@sentry/electron/main` | Previously: `server/start.ts -> main/sessions.ts -> @sentry/electron/main` | **Removed as static requirement** | Replaced with `setSessionRuntimeHooks().captureException` injection; Electron host wires Sentry, headless host does not import Sentry. |
| `@sentry/electron/preload` | No static chain from `server/start.ts` | **Not required** | Can be removed from headless shims. |
| `electron-updater` | Previously reachable through all-system registration and update handlers (`system.ts -> dynamic import('../auto-update')`) in headless profile | **Not required in core profile** | Headless now registers core handlers only (`registerCoreRpcHandlers`), so update handlers are not registered in headless mode. |
| `electron` | No static chain from core headless startup after core/gui split and SessionManager hook decoupling | **Not required** | Keep only if a new static import chain appears; otherwise remove shim. |

## Notes

- Headless startup now uses `registerCoreRpcHandlers` only.
- `system.ts` is split into core and GUI registrars:
  - Core: shell/system/git/release-note channels
  - GUI: update/menu/notification/badge/window channels
- Deep-link handling remains in core `OPEN_URL` handler behind a **dynamic import** guarded by `windowManager` presence (`craftagents://` branch).

## Follow-up

If we want to remove the remaining `electron-log/main` shim, introduce a logger adapter in `main/logger.ts` and remove direct `electron-log/main` import from headless-reachable modules.
