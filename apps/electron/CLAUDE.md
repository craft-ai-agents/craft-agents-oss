# CLAUDE.md - Electron App

This file provides guidance to Claude Code when working with the `apps/electron` package.

## Overview

The Electron desktop app is the primary interface for G4 OS. It uses a three-process architecture: main (Node.js), preload (context bridge), and renderer (React).

## Directory Structure

```
apps/electron/src/
├── main/                    # Electron main process
│   ├── index.ts             # App initialization, window creation, lifecycle
│   ├── window-manager.ts    # Window lifecycle, workspace-to-window mapping
│   ├── sessions.ts          # SessionManager: agent creation, message streaming, auth
│   ├── ipc.ts               # 50+ IPC handler registrations
│   ├── menu.ts              # Native application menu
│   ├── logger.ts            # electron-log configuration
│   ├── notifications.ts     # Native notifications, dock badge
│   ├── auto-update.ts       # electron-updater integration
│   ├── deep-link.ts         # g4os:// protocol URL parsing
│   ├── window-state.ts      # Window bounds persistence
│   ├── power-manager.ts     # Prevent system sleep during sessions
│   ├── shell-env.ts         # Load user shell env (Homebrew, nvm, etc.)
│   ├── thumbnail-protocol.ts # Custom thumbnail:// protocol
│   └── lib/
│       └── config-watcher.ts # Live config file watching
├── preload/
│   └── index.ts             # contextBridge API (window.electronAPI)
├── renderer/                # React app (Vite)
│   ├── main.tsx             # Entry point (Sentry, Jotai provider, theme)
│   ├── App.tsx              # Root component (loading → onboarding → ready)
│   ├── atoms/               # Jotai state management
│   │   └── sessions.ts      # Per-session atom isolation (atomFamily)
│   ├── components/          # React UI components
│   ├── hooks/               # Custom hooks (useSession, useOnboarding, etc.)
│   ├── pages/               # Full-page views (AllSessions, Settings, Sources)
│   ├── context/             # React contexts (Theme, Modal, Focus)
│   ├── lib/                 # Utilities (navigation, perf, mentions)
│   ├── config/              # Layout, theme, model configs
│   └── utils/               # Helpers (text, file handling, auth)
└── shared/                  # Shared types between processes
    ├── types.ts             # IPC types, Session, Message, FileAttachment (58KB)
    ├── routes.ts            # Type-safe route builders
    ├── route-parser.ts      # Deep link URL parsing
    ├── menu-schema.ts       # Menu structure
    ├── settings-registry.ts # Settings subpage IDs
    └── feature-flags.ts     # Feature flags
```

## Main Process

### Initialization Flow (`index.ts`)

```
app.whenReady()
  → Sentry init → bundled assets sync → docs/permissions/themes init
  → WindowManager created → IPC handlers registered
  → Initial windows opened → SessionManager initialized
  → Auth configured → credential health check → power manager → auto-update
```

### SessionManager (`sessions.ts`)

The largest file (~4500 lines). Key responsibilities:

- **Agent lifecycle:** Creates `G4Agent` per session, destroys on close
- **Message streaming:** Non-blocking `sendMessage()` emits `SESSION_EVENT` via IPC
- **Auth management:** `reinitializeAuth()` sets `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`
- **Source/skill loading:** Builds MCP server configs from workspace sources
- **OAuth token refresh:** `TokenRefreshManager` handles auto-refresh
- **Error recovery:** Auth error detection triggers token refresh + agent restart

### IPC Architecture (`ipc.ts`)

**Pattern:** All handlers registered via `ipcMain.handle()` with channel constants.

**Categories:**
- Session CRUD: `GET_SESSIONS`, `CREATE_SESSION`, `SEND_MESSAGE`, `CANCEL_PROCESSING`
- Window management: `GET_WINDOW_WORKSPACE`, `SWITCH_WORKSPACE`, `CLOSE_WINDOW`
- File I/O: `READ_FILE`, `OPEN_FILE_DIALOG`, `STORE_ATTACHMENT`
- Settings: model selection, LLM connections, API key management
- Auth: OAuth flows, credential input

**Security:**
- Path validation via `validateFilePath()` — blocks `.ssh`, `.gnupg`, `.env`, etc.
- Filename sanitization removes path separators and control characters

### WindowManager (`window-manager.ts`)

- Maps `webContentsId` → `ManagedWindow` (tracks workspace association)
- Platform-specific window styling (macOS: hiddenInset titlebar, Windows: Mica/Acrylic)
- Persists/restores window bounds on quit/launch

## Preload Bridge (`preload/index.ts`)

Exposes `window.electronAPI` with 50+ safe methods via `contextBridge.exposeInMainWorld()`.

**Security model:**
- `contextIsolation: true` — preload runs in isolated context
- `nodeIntegration: false` — no Node.js in renderer
- `sandbox: false` — required for `process.versions`

## Renderer (React)

### State Management

Uses **Jotai** with `atomFamily` for per-session isolation:

```typescript
// Each session gets its own atom — updates to Session A don't re-render Session B
const sessionAtomFamily = atomFamily((sessionId) => atom<Session | null>(null))
```

Key atoms in `atoms/sessions.ts`:
- `sessionMetaMapAtom` — lightweight session list (no messages, for sidebar)
- `sessionAtomFamily(id)` — full session with messages (loaded on demand)
- `sourcesAtom`, `skillsAtom` — shared app-level state

### App State Machine (`App.tsx`)

```
loading → onboarding (if no auth) → ready
                                   → reauth (if OAuth expired)
```

### Navigation (`shared/routes.ts`)

Type-safe route builders for deep linking:
```typescript
routes.action.newSession({ input: "test", send: true })
// → "action/new-session?input=test&send=true"

routes.view.allSessions(sessionId)
// → "allSessions/session/{sessionId}"
```

### Event Streaming

```
Main Process                    Renderer
SessionManager.sendMessage()
  → G4Agent.chat() ──────→ SESSION_EVENT IPC
    → SDK subprocess           → onSessionEvent listener
      → API call                 → update Jotai atom
      → stream response           → React re-render
```

## Build Configuration

### vite.config.ts
- React plugin with Jotai babel HMR support
- Tailwind CSS v4 plugin
- Path aliases: `@/` → `src/renderer/`, `@config/` → `packages/shared/src/config/`
- Deduplicates React via explicit resolve

### esbuild (main + preload)
- Bundles to CJS format (required by Electron)
- OAuth secrets injected via `--define` at build time
- All node_modules marked external

## Key Patterns

- **IPC is the only bridge** — renderer never accesses Node.js directly
- **Session events are fire-and-forget** — `sendMessage()` returns immediately, streams via events
- **Metadata vs full session** — sidebar uses lightweight `SessionMeta`, detail view loads full `Session`
- **Theme cascading** — app-level → workspace-level (last wins), with dark mode overrides
- **Sentry integration** — both main and renderer, with sensitive data scrubbing
