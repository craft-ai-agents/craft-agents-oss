# Craft Agent Electron App

A GUI version of Craft Agent built with Electron + React. Provides a multi-threaded chat interface for interacting with Claude via Craft workspaces.

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
│   │   └── agent-service.ts # Agent listing, caching, auth checking
│   ├── preload/           # Context bridge (main ↔ renderer)
│   │   └── index.ts       # Exposes electronAPI to renderer
│   ├── renderer/          # React UI
│   │   ├── App.tsx        # Main app, event handling
│   │   ├── components/
│   │   │   ├── chat/      # Chat UI (ChatInput, ChatDisplay, PermissionBanner)
│   │   │   ├── markdown/  # Markdown renderer with Shiki
│   │   │   └── ui/        # shadcn/ui components
│   │   ├── hooks/
│   │   │   └── useAgentState.ts  # Agent activation state machine
│   │   └── playground/    # Component development playground
│   └── shared/
│       └── types.ts       # Shared TypeScript interfaces
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

The SDK requires authentication environment variables to be set BEFORE creating agents. The TUI does this in `index.tsx`, but the Electron app must do it explicitly.

```typescript
import { getAuthState } from '../../../src/auth/state'
import { setAnthropicOptionsEnv } from '../../../src/agent/options'
import { getCraftToken } from '../../../src/auth/craft-token'

// In initialize():
const authState = await getAuthState()
const { billing } = authState

if (billing.type === 'craft_credits') {
  const token = await getCraftToken()
  setAnthropicOptionsEnv({
    USE_CRAFT_AI_GATEWAY: 'true',
    CRAFT_API_GATEWAY_TOKEN: token,
  })
  process.env.ANTHROPIC_API_KEY = 'craft-credits-placeholder'
} else if (billing.type === 'oauth_token' && billing.claudeOAuthToken) {
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

### Gmail OAuth (Optional)

To enable the "Add Gmail" connection feature, set these environment variables before building:

```bash
export GMAIL_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
export GMAIL_OAUTH_CLIENT_SECRET=your-client-secret
```

Get these from [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth Client ID (Desktop app).

**Required OAuth consent screen scopes:**
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/userinfo.email`

These values are baked into the build at compile time via esbuild `--define` flags.

## Build Process

```bash
# Build with Gmail OAuth support
GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... bun run electron:build

# Or set in shell profile and just run:
bun run electron:build:main      # Bundle main process (esbuild)
bun run electron:build:preload   # Bundle preload script (esbuild)
bun run electron:build:renderer  # Bundle React app (Vite)
bun run electron:build:resources # Copy icons
bun run electron:build           # All of the above
```

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
- **Permission handling** - PermissionBanner component for bash command approval
- **Agent state machine** - useAgentState hook manages activation flow (extracting → review → auth → active)
- **Application menu** - Standard macOS/Windows menus with keyboard shortcuts
- **Component playground** - Development tool for testing UI components in isolation

## File Overview

| File | Purpose |
|------|---------|
| `main/index.ts` | App entry, window creation |
| `main/sessions.ts` | CraftAgent wrapper, event processing, subagent integration |
| `main/ipc.ts` | IPC channel handlers (sessions, files, shell) |
| `main/menu.ts` | Application menu (File, Edit, View, Help) |
| `main/agent-service.ts` | Agent listing, caching, auth checking |
| `preload/index.ts` | Context bridge API |
| `renderer/App.tsx` | React root, state management |
| `renderer/hooks/useAgentState.ts` | Agent activation state machine (IPC-based) |
| `renderer/components/chat/Chat.tsx` | Main chat layout with resizable panels |
| `renderer/components/chat/ChatInput.tsx` | Message input with file attachments |
| `renderer/components/chat/ChatDisplay.tsx` | Message list with markdown rendering |
| `renderer/components/chat/PermissionBanner.tsx` | Bash command approval UI |
| `renderer/components/chat/SessionList.tsx` | Session sidebar with rename support |
| `renderer/components/chat/AttachmentPreview.tsx` | File attachment bubbles |
| `renderer/playground/` | Component development playground |
| `shared/types.ts` | IPC channels, Message/Session/FileAttachment types |
