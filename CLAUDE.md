# CLAUDE.md

This file provides guidance to Claude Code when working with the G4 OS codebase.

## Overview

G4 OS is an open-source desktop application for multi-session AI agent management. It provides a Claude Code-like experience with a document-centric workflow, enabling intuitive multitasking with multiple concurrent agent sessions.

**Stack:** Electron + React 18 + TypeScript + Bun + Claude Agent SDK
**License:** Apache 2.0

## Quick Start

```bash
bun install              # Install dependencies
bun run electron:dev     # Dev mode with hot reload (Vite + esbuild watch)
bun run electron:start   # Full build + run
bun run typecheck:all    # Type check packages/core + packages/shared
```

**Requirements:**
- Bun 1.3.9+ (older versions cause silent hangs with SDK streaming)
- `.env` file with `ANTHROPIC_API_KEY` or use Claude OAuth onboarding
- Config stored at `~/.g4os/`

## Monorepo Structure

```
g4os/
├── apps/
│   ├── electron/          # Main desktop app (Electron + React)
│   └── viewer/            # Web-based read-only session viewer
├── packages/
│   ├── core/              # Shared TypeScript types (@g4os/core)
│   ├── shared/            # Core business logic (@g4os/shared)
│   ├── ui/                # React component library (@g4os/ui)
│   ├── session-tools-core/# Session tool handlers (@g4os/session-tools-core)
│   ├── codex-types/       # OpenAI/Codex protocol types (generated)
│   └── mermaid/           # Pure TS diagram rendering (@g4os/mermaid)
├── scripts/               # Build & dev scripts (TypeScript)
├── bunfig.toml            # Bun config (preloads network-interceptor.ts)
└── .env                   # API keys (not committed)
```

**Dependency flow:**
```
apps/electron ─┐
apps/viewer ───┼─> @g4os/ui ──> @g4os/core
               │                   └─> @g4os/mermaid
               └─> @g4os/shared ──> @g4os/core
                                       └─> @g4os/session-tools-core
```

## Architecture

### How It Works

1. **Electron main process** manages windows, sessions, auth, and file I/O
2. **SessionManager** creates a `G4Agent` per session, wrapping the Claude Agent SDK
3. The SDK spawns a **Bun subprocess** (`bun --preload network-interceptor.ts cli.js`) for each agent
4. Agent events stream back via IPC to the **React renderer** which uses Jotai atoms for state
5. Sessions are persisted as JSONL files under `~/.g4os/workspaces/{id}/sessions/`

### Key Subsystems

| Subsystem | Location | Purpose |
|-----------|----------|---------|
| Agent | `packages/shared/src/agent/` | G4Agent wraps SDK, manages permissions, tool hooks |
| Auth | `packages/shared/src/auth/` | OAuth flows for Claude, Google, Slack, Microsoft |
| Config | `packages/shared/src/config/` | `~/.g4os/config.json`, models, preferences, themes |
| Credentials | `packages/shared/src/credentials/` | AES-256-GCM encrypted `~/.g4os/credentials.enc` |
| Sessions | `packages/shared/src/sessions/` | JSONL persistence with debounced writes |
| Sources | `packages/shared/src/sources/` | MCP servers, REST APIs, local filesystems |
| Permissions | `packages/shared/src/agent/mode-manager.ts` | Three modes: safe (read-only), ask, allow-all |
| IPC | `apps/electron/src/main/ipc.ts` | 50+ handlers for main↔renderer communication |
| UI State | `apps/electron/src/renderer/atoms/` | Jotai atoms with per-session isolation |
| Network | `packages/shared/src/network-interceptor.ts` | Fetch interceptor for API error capture |

### Permission Modes (Per-Session)

| Mode | Display | Behavior |
|------|---------|----------|
| `safe` | Explore | Read-only, blocks all write tools |
| `ask` | Ask to Edit | Prompts before edits (default) |
| `allow-all` | Execute | Auto-approves all commands |

Toggle with **SHIFT+TAB** in the chat UI.

### Auth Flow

- **Claude OAuth:** `process.env.CLAUDE_CODE_OAUTH_TOKEN` (set by `reinitializeAuth()`)
- **API Key:** `process.env.ANTHROPIC_API_KEY` (from `.env` or LLM connection config)
- LLM connections configured per-workspace in `~/.g4os/config.json`

## Development

### Build System

- **Main process:** esbuild bundles `src/main/index.ts` → `dist/main.cjs`
- **Preload:** esbuild bundles `src/preload/index.ts` → `dist/preload.cjs`
- **Renderer:** Vite builds React app with Tailwind CSS v4
- **Dev mode:** esbuild watch + Vite dev server on `localhost:5173`

### Key Commands

```bash
bun run electron:dev           # Dev with hot reload
bun run electron:start         # Build + run
bun run typecheck:all          # Type check core + shared
bun run lint                   # Lint electron + shared
bun run electron:dist:mac      # macOS distribution build
bun run electron:dist:win      # Windows distribution build
bun run electron:dist:linux    # Linux distribution build
bun run viewer:dev             # Web viewer dev server
```

### Logs

- Electron main: `~/Library/Logs/@g4os/electron/main.log`
- Network interceptor: `~/.g4os/logs/interceptor.log`
- API errors: `~/.g4os/api-error.json`

### OSS-Specific Notes

- `packages/session-mcp-server` and `packages/bridge-mcp-server` have no source code (only empty `dist/` dirs) — the dev script skips them automatically
- The `!apps/online-docs` workspace exclusion was removed (Bun doesn't support it, and the dir doesn't exist)
- Bun 1.0.35 causes silent hangs with the SDK's streaming HTTP connections — use 1.3.9+

## Conventions

- **TypeScript only** — no JavaScript files
- **ESM modules** — `"type": "module"` in package.json
- **Subpath exports** — packages use clean import paths (e.g., `@g4os/shared/agent`)
- **Per-session isolation** — Jotai atoms, permission modes, and agent instances are all per-session
- **JSONL format** — sessions stored as line 1 = header, lines 2+ = messages
- **Workspace-scoped storage** — sources, skills, sessions all under `~/.g4os/workspaces/{id}/`

## File Storage Layout

```
~/.g4os/
├── config.json              # Main config (workspaces, LLM connections)
├── credentials.enc          # Encrypted credentials (AES-256-GCM)
├── preferences.json         # User preferences
├── theme.json               # App-level theme
├── permissions/             # Default permission rules
├── themes/                  # Bundled themes (catppuccin, dracula, nord, etc.)
└── workspaces/{id}/
    ├── config.json          # Workspace config
    ├── theme.json           # Workspace theme override
    ├── permissions.json     # Workspace permission rules
    ├── sessions/{id}/       # Session data (JSONL + attachments)
    ├── sources/{slug}/      # Connected sources (config.json + guide.md)
    ├── skills/              # Custom skills
    └── statuses/            # Workflow status config
```
