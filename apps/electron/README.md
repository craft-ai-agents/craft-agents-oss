# Craft Agents Electron App

The primary desktop interface for Craft Agents, built with Electron + React. Provides a multi-session inbox with chat interface for interacting with Claude via Craft workspaces.

## Quick Start

```bash
# From the project root
bun run electron:build   # Build the app
bun run electron:start   # Build and run
```

## Architecture

```
apps/electron/
├── src/
│   ├── main/              # Electron main process
│   │   ├── index.ts       # Window creation, app lifecycle
│   │   ├── ipc.ts         # IPC handler registration
│   │   ├── menu.ts        # Application menu (File, Edit, View, Help)
│   │   ├── sessions.ts    # Session management, CraftAgent integration
│   │   ├── deep-link.ts   # Deep link URL parsing and handling
│   │   ├── agent-service.ts # Agent listing, caching, auth checking
│   │   └── sources-service.ts # Source and authentication service
│   ├── preload/           # Context bridge (main ↔ renderer)
│   │   └── index.ts       # Exposes electronAPI to renderer
│   ├── renderer/          # React UI
│   │   ├── App.tsx        # Main app, event handling
│   │   ├── components/
│   │   │   ├── chat/      # Chat UI (ChatInput, ChatDisplay)
│   │   │   ├── markdown/  # Markdown renderer with Shiki
│   │   │   └── ui/        # shadcn/ui components (incl. source-avatar.tsx)
│   │   ├── contexts/
│   │   │   └── NavigationContext.tsx  # Type-safe routing and navigation
│   │   ├── lib/
│   │   │   └── navigate.ts  # Global navigate() function
│   │   ├── hooks/
│   │   │   └── useAgentState.ts  # Agent activation state machine
│   │   └── playground/    # Component development playground
│   └── shared/
│       ├── types.ts       # Shared TypeScript interfaces
│       ├── routes.ts      # Type-safe route definitions
│       └── route-parser.ts # Route string parsing
├── dist/                  # Build output
└── resources/             # App icons
```

## Key Learnings & Gotchas

### 1. SDK Path Resolution (CRITICAL)

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) works by spawning a subprocess that runs `cli.js`. When esbuild bundles the SDK into `main.js`, the SDK's auto-detection of `cli.js` breaks.

**Problem:**
```
Error: The "path" argument must be of type string or an instance of URL. Received undefined
```

**Root cause:** The SDK uses `import.meta.url` to find `cli.js`. After bundling, this path is invalid.

**Solution:** Explicitly set the path before creating any agents:
```typescript
import { setPathToClaudeCodeExecutable } from '../../../src/agent/options'

// In initialize():
const cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
setPathToClaudeCodeExecutable(cliPath)
```

### 2. Authentication Environment Setup (CRITICAL)

The SDK requires authentication environment variables to be set BEFORE creating agents. The Electron app must do this explicitly during initialization.

```typescript
import { getAuthState } from '../../../src/auth/state'

// In initialize():
const authState = await getAuthState()
const { billing } = authState

if (billing.type === 'oauth_token' && billing.claudeOAuthToken) {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = billing.claudeOAuthToken
} else if (billing.apiKey) {
  process.env.ANTHROPIC_API_KEY = billing.apiKey
}
```

### 3. AgentEvent Type Mismatches

The `AgentEvent` types from `CraftAgent` use different property names than you might expect:

| Event Type | Wrong | Correct |
|------------|-------|---------|
| `text_delta` | `event.delta` | `event.text` |
| `error` | `event.error` | `event.message` |
| `tool_result` | `event.toolName` | Only has `event.toolUseId` |

**Solution for tool_result:** Track `toolUseId → toolName` mapping from `tool_start` events:
```typescript
interface ManagedSession {
  // ...
  pendingTools: Map<string, string>  // toolUseId -> toolName
}

// In tool_start handler:
managed.pendingTools.set(event.toolUseId, event.toolName)

// In tool_result handler:
const toolName = managed.pendingTools.get(event.toolUseId) || 'unknown'
managed.pendingTools.delete(event.toolUseId)
```

### 4. CraftAgent Constructor

`CraftAgent` expects the full `Workspace` object, not just the ID:

```typescript
// Wrong:
new CraftAgent({ workspaceId: workspace.id, model })

// Correct:
new CraftAgent({ workspace, model })
```

### 5. esbuild Configuration

Only `electron` is externalized. The SDK is bundled into `main.js`:

```json
"electron:build:main": "esbuild ... --external:electron"
```

This means:
- SDK code is inlined (~950KB)
- SDK's runtime path resolution breaks (see #1)
- Native modules would need explicit externalization

## Environment Variables

### Gmail OAuth (via 1Password CLI)

Gmail OAuth credentials are synced from 1Password to a local `.env` file.

**One-time setup:**
```bash
# 1. Install 1Password CLI
brew install 1password-cli

# 2. Enable CLI integration: 1Password app → Settings → Developer → CLI Integration

# 3. Sync secrets (requires Touch ID once)
bun run sync-secrets
```

**That's it!** Now `bun run electron:dev` and `bun run electron:start` work without prompts.

**How it works:**
- `.env.1password` contains `op://` references to the `Dev_Craft_Agents` vault
- `bun run sync-secrets` resolves references → writes `.env` (gitignored)
- Secrets are baked into the build at compile time via esbuild `--define` flags

**Creating your own OAuth credentials:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create OAuth Client ID (Desktop app type)
3. Enable required scopes in OAuth consent screen:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`

## Build Process

```bash
bun run electron:build:main      # Bundle main process (esbuild)
bun run electron:build:preload   # Bundle preload script (esbuild)
bun run electron:build:renderer  # Bundle React app (Vite)
bun run electron:build:resources # Copy icons
bun run electron:build           # All of the above
```

## macOS Liquid Glass Icon

The app includes a pre-compiled `Assets.car` for macOS 26+ Liquid Glass icons. This enables the layered glass effect on macOS Tahoe. On older macOS versions, the app falls back to `icon.icns`.

**Regenerating after icon changes:**

If you modify `resources/icon.icon`, regenerate the Assets.car:

```bash
cd apps/electron
xcrun actool "resources/icon.icon" --compile "resources" \
  --app-icon AppIcon --minimum-deployment-target 26.0 \
  --platform macosx --output-partial-info-plist /dev/null
```

> **Note:** This requires macOS 26 with Xcode 26 (macOS 26 SDK). The pre-compiled Assets.car is committed to the repo so CI builds work without the SDK.

## Debugging

Enable console logging by checking the terminal where you ran `electron:start`. Key log prefixes:
- `[SessionManager]` - Session lifecycle, auth setup
- `[IPC]` - Inter-process communication

DevTools opens automatically (configured in `index.ts`). Remove `mainWindow.webContents.openDevTools()` for production.

## Current Limitations

1. **In development only** - No electron-builder config for distribution

## Implemented Features

- **Session persistence** - Sessions, messages, and names are saved to disk
- **File attachments** - Attach images, PDFs, and code files to messages
- **AI-generated titles** - Sessions get automatic titles after first exchange
- **Subagent support** - Load and apply agent definitions from Craft documents
- **Shell integration** - Open URLs in browser, open files in default apps
- **Permission modes** - Three-level permission system (Explore, Ask to Edit, Auto)
- **Background tasks** - Run long-running tasks in background with progress tracking
- **Multi-file diff** - VS Code-style window for viewing all file changes in a turn
- **Dynamic statuses** - Workspace-customizable session workflow states
- **Theme system** - Cascading themes (app → workspace → agent)
- **Agent state machine** - useAgentState hook manages activation flow
- **Application menu** - Standard macOS/Windows menus with keyboard shortcuts
- **Component playground** - Development tool for testing UI components in isolation
- **Type-safe navigation** - Unified routing system for tabs, actions, and deep links

## Navigation System

The app uses a type-safe routing system for all internal navigation and deep links.

### Quick Start

```typescript
import { navigate, routes } from '@/lib/navigate'

// Tab routes
navigate(routes.tab.settings())           // Open settings
navigate(routes.tab.chat('session123'))   // Open chat
navigate(routes.tab.agentInfo('claude'))  // Open agent info

// Action routes
navigate(routes.action.newChat({ agentId: 'claude' }))  // New chat with agent
navigate(routes.action.deleteSession('id'))             // Delete session

// Sidebar routes
navigate(routes.sidebar.inbox())          // Show inbox
navigate(routes.sidebar.flagged())        // Show flagged
```

### Deep Links

External apps can navigate using `craftagents://` URLs:

```
craftagents://settings
craftagents://allChats/chat/session123
craftagents://sources/source/github
craftagents://action/new-chat
craftagents://workspace/{id}/allChats/chat/abc123
```

See `CLAUDE.md` for complete route reference.

## File Overview

| File | Purpose |
|------|---------|
| `main/index.ts` | App entry, window creation |
| `main/sessions.ts` | CraftAgent wrapper, event processing, source integration |
| `main/ipc.ts` | IPC channel handlers (sessions, files, shell) |
| `main/menu.ts` | Application menu (File, Edit, View, Help) |
| `main/deep-link.ts` | Deep link URL parsing and handling |
| `main/sources-service.ts` | Source loading and authentication service |
| `preload/index.ts` | Context bridge API |
| `renderer/App.tsx` | React root, state management |
| `renderer/contexts/NavigationContext.tsx` | Type-safe routing and navigation handler |
| `renderer/lib/navigate.ts` | Global navigate() function |
| `renderer/hooks/useAgentState.ts` | Agent activation state machine (IPC-based) |
| `renderer/hooks/useBackgroundTasks.ts` | Background task tracking |
| `renderer/hooks/useStatuses.ts` | Workspace status configuration |
| `renderer/hooks/useTheme.ts` | Cascading theme resolution |
| `renderer/components/chat/Chat.tsx` | Main chat layout with resizable panels |
| `renderer/components/chat/ChatInput.tsx` | Message input with file attachments |
| `renderer/components/chat/ChatDisplay.tsx` | Message list with markdown rendering |
| `renderer/components/app-shell/input/structured/PermissionRequest.tsx` | Bash command approval UI |
| `renderer/components/chat/SessionList.tsx` | Session sidebar with rename support |
| `renderer/components/chat/AttachmentPreview.tsx` | File attachment bubbles |
| `renderer/components/ui/source-avatar.tsx` | Unified source icon component |
| `renderer/playground/` | Component development playground |
| `shared/types.ts` | IPC channels, Message/Session/FileAttachment types |
| `shared/routes.ts` | Type-safe route definitions and builders |
| `shared/route-parser.ts` | Route string parsing utilities |
