# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the Electron desktop app for Craft Agent - a GUI alternative to the TUI. It provides a multi-threaded chat interface for interacting with Claude via Craft workspaces.

**Important:** This app reuses the parent `craft-tui-agent` codebase. The main process imports directly from `../../../src/` (the TUI's source). Dependencies are managed in the root `package.json`.

## Commands

All commands run from the **project root** (not this directory):

```bash
bun run electron:build        # Build all (main, preload, renderer, resources)
bun run electron:start        # Build and run the app

# Individual build steps
bun run electron:build:main      # Bundle main process (esbuild)
bun run electron:build:preload   # Bundle preload script (esbuild)
bun run electron:build:renderer  # Bundle React UI (Vite)
bun run electron:build:resources # Copy icons
```

## Architecture

```
electron-app/
├── src/
│   ├── main/           # Electron main process (Node.js)
│   │   ├── index.ts    # Window creation, app lifecycle
│   │   ├── ipc.ts      # IPC handler registration
│   │   └── sessions.ts # SessionManager - CraftAgent integration
│   ├── preload/        # Context bridge (main ↔ renderer)
│   │   └── index.ts    # Exposes electronAPI to renderer
│   ├── renderer/       # React UI (browser context)
│   │   ├── App.tsx     # Main app, session event handling
│   │   ├── main.tsx    # React entry point
│   │   ├── components/ # UI components
│   │   ├── context/    # React context (ThemeContext)
│   │   └── utils/      # Color utilities for theming
│   └── shared/
│       └── types.ts    # IPC channels, Message/Session types
├── dist/               # Build output
└── resources/          # App icons
```

### IPC Communication

The app uses Electron's IPC for main ↔ renderer communication:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `sessions:*` | renderer → main | Session CRUD operations |
| `workspaces:get` | renderer → main | Get configured workspaces |
| `session:event` | main → renderer | Stream events (text_delta, tool_start, etc.) |
| `file:read` | renderer → main | Read files (path-validated) |

**Event streaming pattern:** `sendMessage` returns immediately. Results stream via `SESSION_EVENT` channel.

### Key Integration Points

**SessionManager** (`main/sessions.ts`):
- Wraps `CraftAgent` from the parent TUI codebase
- Sets up SDK path and authentication on initialization
- Processes `AgentEvent` stream and forwards to renderer
- Tracks `toolUseId → toolName` mapping (since `tool_result` events only have `toolUseId`)

**Event type mappings:**
| AgentEvent field | Renderer expects |
|------------------|------------------|
| `event.text` | `event.delta` (text_delta) |
| `event.message` | `event.error` (error) |

## Critical SDK Setup

The Claude Agent SDK requires explicit setup in Electron (unlike TUI where it's implicit):

### 1. SDK Path (in `sessions.ts`)
```typescript
// Must set before creating any CraftAgent instances
const cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
setPathToClaudeCodeExecutable(cliPath)
```
Without this, you'll get: `Error: The "path" argument must be of type string...`

### 2. Authentication Environment
Authentication env vars must be set BEFORE creating agents:
```typescript
// Craft Credits
setAnthropicOptionsEnv({ USE_CRAFT_AI_GATEWAY: 'true', CRAFT_API_GATEWAY_TOKEN: token })
process.env.ANTHROPIC_API_KEY = 'craft-credits-placeholder'

// Claude Max OAuth
process.env.CLAUDE_CODE_OAUTH_TOKEN = token

// API Key
process.env.ANTHROPIC_API_KEY = apiKey
```

## Build Configuration

**esbuild** (main/preload): Only `electron` is externalized. SDK is bundled into main.js.

**Vite** (renderer): Standard React build with Tailwind CSS v4.

## Theming

The app uses CSS custom properties for theming. `ThemeContext` manages colors stored in localStorage (`craft-agent-theme`). CSS classes use semantic names like `bg-bg-primary`, `text-text-primary`, `border-border-primary`.

## Debugging

- Console logs print to the terminal running `electron:start`
- DevTools opens automatically in development mode (`!app.isPackaged`)
- Key log prefixes: `[Main]`, `[SessionManager]`, `[IPC]`

## Current Limitations

1. No permission handling - bash commands execute without approval
2. No AskUserQuestion UI - agent can't ask clarifying questions
3. No session persistence - sessions lost on restart
4. No file attachments
5. Development only - no electron-builder config
