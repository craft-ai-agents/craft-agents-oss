# CLAUDE.md — Web UI (`apps/webui`)

## Purpose
Browser-accessible interface for Craft Agent, reusing the Electron renderer's components.
Served alongside the headless server for remote deployment.

## Architecture
- Vite + React app that aliases `@` → `apps/electron/src/renderer/`
- Web API adapter (`src/adapter/web-api.ts`) wraps `WsRpcClient` + `buildClientApi` + web stubs
- Cookie-based JWT session auth (HttpOnly, Secure, SameSite=Strict)
- Static login page (`src/login.html`) — no JS bundle needed for unauthenticated users

## Commands
From repo root:
```bash
bun run webui:dev          # Vite dev server on :5175
bun run webui:build        # Production build → apps/webui/dist/
bun run webui:typecheck    # TypeScript check
bun run server:dev:webui   # Build webui + start headless server with web UI on :3100
```

## Environment variables (on the headless server)
- `CRAFT_WEBUI_DIR` — path to built web UI dist/ (enables web UI)
- `CRAFT_WEBUI_PORT` — HTTP port for web UI (default: 3100)
- `CRAFT_WEBUI_PASSWORD` — optional shorter password for web login (falls back to `CRAFT_SERVER_TOKEN`)

## Key files
- `src/adapter/web-api.ts` — Web implementation of ElectronAPI (overrides LOCAL_ONLY methods)
- `src/App.tsx` — Fetches config, creates adapter, lazy-loads Electron App
- `src/login.html` — Static login page (no React)
- `src/shims/` — Empty module replacements for Electron-specific imports

## Hard rules
- Never store the server token in localStorage or URL params
- Auth is cookie-based only (HttpOnly, no JS access)
- Web-specific overrides must satisfy the ElectronAPI interface
- Keep shims minimal — prefer no-ops over complex emulations
