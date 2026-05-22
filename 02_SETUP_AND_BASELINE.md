# Phase 3 — Setup & Baseline

## Repository Overview

- **Repo**: `craft-ai-agents/craft-agents-oss`
- **Local path**: `/root/oss-pr-campaign/repos/craft-agents-oss`
- **Upstream**: `https://github.com/craft-ai-agents/craft-agents-oss.git`
- **Origin (fork)**: `https://github.com/okwn/craft-agents-oss.git`
- **Latest tag**: `v0.9.5` (upstream/main)
- **Package manager**: bun (required)
- **Language**: TypeScript (ESM)

## Workspace Structure

```
apps/
  cli/          # Terminal client
  electron/     # Desktop GUI (primary)
  viewer/       # Document viewer
  webui/        # Web UI
packages/
  core/               # Shared types
  messaging-gateway/ # Messaging abstraction
  messaging-whatsapp-worker/
  pi-agent-server/   # Pi SDK server wrapper
  server/            # Headless server
  server-core/       # Server core logic
  session-mcp-server/
  session-tools-core/
  shared/            # Business logic (agent, config, sources, sessions)
  ui/                # React UI components
```

## Installation

```bash
# bun required (npm workspaces not compatible with npm)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
export PATH="$HOME/.bun/bin:$PATH"
cd /root/oss-pr-campaign/repos/craft-agents-oss
bun install  # 1727 packages installed [13.63s]
```

## CI Validation: `bun run validate:ci`

**Result: FAILS** ❌

`validate:ci` chains: `validate:dev` → `lint:i18n:parity` → `lint:i18n:sorted` → `lint:i18n:coverage`

`validate:dev` runs: `typecheck:all` → `test:shared:all` → `test:doc-tools`

### `typecheck:all` — FAILS ❌

```
error TS5083: Cannot read file '/root/oss-pr-campaign/repos/craft-agents-oss/tsconfig.base.json'.
../../node_modules/@types/cacheable-request/index.d.ts(13,10): error TS2614: Module '"keyv"' has no exported member 'Store'.
src/handlers/source-test.ts(311,37): error TS1501: This regular expression flag is only available when targeting 'es6' or later.
src/tool-defs-filtering.test.ts(34,24): error TS2802: Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag.
src/validation.ts(128,43): error TS2339: Property 'error' does not exist on type '{ success: true; data: unknown; } | { success: false; error: string; }'.
```

Root cause: missing `tsconfig.base.json` (likely removed in cleanup but still referenced).

### `bun test` — 22 failures, 4466 passes ✅ (acceptable baseline)

```
22 tests failed:
  refreshConnectionRuntime > records customModels with per-model supportsImages flag
  BrowserPaneManager > destroys child popups when parent instance is destroyed
  BrowserPaneManager > focus brings the instance window to front
  BrowserPaneManager > dedupes repeated focus calls before ready-to-show
  BrowserPaneManager > still destroys instance when cleanup throws
  BrowserPaneManager > retries toolbar load and recovers
  BrowserPaneManager > loads toolbar fallback page after retry exhaustion
  BrowserPaneManager > replays toolbar state with theme color when window is shown
  BrowserPaneManager > replays full toolbar state when toolbar renderer finishes loading
  resource-bundle > exportResources > exports sources with sanitized config
  resource-bundle > exportResources > strips known secret fields from source configs
  resource-bundle > exportResources > strips mcp.env and mcp.headers from source configs
  resource-bundle > exportResources > exports all non-hidden files from source folder
  resource-bundle > round-trip export → import > preserves source and skill content
  startWebuiHttpServer > allows plain-http login even when RPC transport is wss
  startWebuiHttpServer > rejects invalid credentials
  startWebuiHttpServer > honors explicit secure-cookie override
  startWebuiHttpServer > infers secure cookies from proxy https headers
  startWebuiHttpServer > derives a browser-facing websocket URL from forwarded headers
  startWebuiHttpServer > returns explicit public websocket URL override
  RPC handler profile registration > registerCoreRpcHandlers registers only core channels
  RPC handler registration > registers all declared handled channels exactly once
```

All 22 failures are in `packages/shared` (electron/renderer isolation issues and webui server tests).

```
9960 expect() calls
Ran 4500 tests across 327 files [101.75s]
```

## Key Scripts

| Script | Purpose |
|--------|---------|
| `bun run typecheck:all` | Full TypeScript check across all packages |
| `bun run validate:ci` | Full CI pipeline (typecheck + tests + i18n lint) |
| `bun test` | All unit tests (includes isolated.ts files) |
| `bun run electron:dev` | Hot-reload dev mode |
| `bun run electron:start` | Build + start Electron app |
| `bun run server:dev` | Headless server dev mode |

## CI Failures Summary

| Check | Status | Notes |
|-------|--------|-------|
| `typecheck:all` | ❌ FAILS | Missing tsconfig.base.json + type def conflicts |
| `bun test` | ⚠️ 22 failures | 4466 pass — failures are pre-existing electron/webui isolation issues |
| `lint:i18n:parity` | ⏸️ Not run | Blocked by typecheck failure |
| `lint:i18n:sorted` | ⏸️ Not run | Blocked by typecheck failure |
| `lint:i18n:coverage` | ⏸️ Not run | Blocked by typecheck failure |

## Recommendation

Fix `tsconfig.base.json` missing reference first — it's the blocker for the entire CI pipeline.