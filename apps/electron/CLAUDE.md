# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Important:** Keep this file and `README.md` up-to-date whenever functionality changes. After making changes to this package, update the documentation to reflect the current state.

## Overview

This is the Electron desktop app for Craft Agent - a GUI alternative to the TUI. It provides a multi-threaded chat interface for interacting with Claude via Craft workspaces.

**Note:** This app reuses the parent `craft-tui-agent` codebase. The main process imports directly from `../../../src/` (the TUI's source). Dependencies are managed in the root `package.json`.

## UI Components

**Always use shadcn/ui components** for building the UI. Never create custom button, input, or other primitive components - use the existing shadcn components from `@/components/ui/`.

Available components in `src/renderer/components/ui/`:
- `avatar`, `badge`, `button`, `collapsible`, `dialog`, `dropdown-menu`
- `input`, `kbd`, `label`, `loading-indicator`, `popover`, `resizable`, `scroll-area`
- `select`, `separator`, `sonner`, `switch`, `tabs`, `textarea`, `tooltip`

To add new shadcn components:
```bash
# From project root - ALWAYS use @latest for Tailwind CSS v4 compatibility
cd apps/electron && npx shadcn@latest add <component-name>
```

Icons: Use [Lucide React](https://lucide.dev/icons/) (`lucide-react` package).

### Loading Indicators

**Always use `Spinner` or `LoadingIndicator`** for loading states. Never use `Loader2` from lucide-react or `animate-spin` classes.

```tsx
import { Spinner, LoadingIndicator } from "@/components/ui/loading-indicator"

// Simple spinner - inherits size and color from parent
<Spinner />

// Control size via text-* classes (uses 1em sizing)
<Spinner className="text-sm" />   // Small
<Spinner className="text-lg" />   // Large
<Spinner className="text-2xl" />  // Extra large

// Control color via text-* classes (uses currentColor)
<Spinner className="text-muted-foreground" />
<Spinner className="text-amber-500" />

// Or inherit from parent element
<div className="text-muted-foreground text-sm">
  <Spinner />  {/* Inherits size and color */}
</div>

// Full loading indicator with label
<LoadingIndicator label="Loading..." />
<LoadingIndicator label="Thinking..." showElapsed />  // With elapsed time
<LoadingIndicator ultrathink />                       // Gradient animation
```

The spinner is based on [SpinKit Grid](https://github.com/tobiasahlin/SpinKit):
- 3x3 grid of cubes with staggered scale animation
- Scales with font-size (uses `em` units)
- Uses `currentColor` (inherits text color)
- Pure CSS animation (no JS state needed)
- CSS defined in `index.css` (`.spinner` class)

### Keyboard Shortcuts

**Always use `Kbd` and `KbdGroup`** for displaying keyboard shortcuts. Never use plain text or custom styled spans.

```tsx
import { Kbd, KbdGroup } from "@/components/ui/kbd"

// Single key
<Kbd>⌘</Kbd>
<Kbd>Enter</Kbd>
<Kbd>Esc</Kbd>

// Key combination (use KbdGroup)
<KbdGroup>
  <Kbd>⌘</Kbd>
  <Kbd>K</Kbd>
</KbdGroup>

// In dropdown menus (common pattern)
<DropdownMenuItem>
  <span>New Chat</span>
  <KbdGroup className="ml-auto">
    <Kbd>⌘</Kbd>
    <Kbd>N</Kbd>
  </KbdGroup>
</DropdownMenuItem>

// In tooltips (automatically adapts styling)
<Tooltip>
  <TooltipTrigger>...</TooltipTrigger>
  <TooltipContent>
    Press <Kbd>⌘</Kbd><Kbd>K</Kbd> to open
  </TooltipContent>
</Tooltip>
```

**Common modifier symbols:**
- `⌘` - Command (Mac)
- `⌃` - Control
- `⌥` - Option/Alt
- `⇧` - Shift
- `↵` or `Enter` - Return/Enter
- `⎋` or `Esc` - Escape

### Hover States with Alpha Colors

**Always use alpha-based colors for hover states** instead of solid colors. This ensures hover effects work consistently across light/dark themes and on translucent backgrounds.

```tsx
// Good - alpha-based hover
className="hover:bg-foreground/5"      // Subtle (buttons, triggers)
className="hover:bg-foreground/10"     // Stronger (menu items, list items)

// Bad - solid color hover
className="hover:bg-accent"            // May not work on translucent backgrounds
className="hover:bg-gray-100"          // Doesn't adapt to dark mode
```

**Common alpha values:**
- `/5` (5%) - Subtle hover for buttons, icon buttons, triggers
- `/10` (10%) - Standard hover for menu items, list items
- `/50` (50%) - Borders, separators, muted elements

### Dropdown/Popover Styling

When creating dropdowns or popovers that need consistent styling regardless of theme:

```tsx
// Trigger button - keep active state when menu is open
<DropdownMenuTrigger asChild>
  <button className="hover:bg-foreground/5 data-[state=open]:bg-foreground/5">
    ...
  </button>
</DropdownMenuTrigger>

// Content - use inline styles for values that themes might override
<DropdownMenuContent
  className="font-sans text-xs dark bg-background/80 backdrop-blur-xl backdrop-saturate-150 border-border/50"
  style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
>
```

**Trigger button active state:**
- Use `data-[state=open]:bg-foreground/5` to keep hover appearance when menu is open
- Radix UI automatically sets `data-state="open"` on triggers when their menu is visible

**Why inline styles for borderRadius/boxShadow:**
- Tailwind classes like `rounded-lg` and `shadow-lg` can be overridden by theme CSS variables
- Inline styles ensure exact values (`8px` radius, specific shadow) are applied

**Vibrancy effect:**
- `bg-background/80` - semi-transparent background
- `backdrop-blur-xl` - strong blur of content behind
- `backdrop-saturate-150` - boosts color saturation for macOS-like vibrancy
- `dark` class - force dark mode on dropdown

**Menu item spacing:**
- Use `gap-3` for icon-to-text spacing
- Use `pl-6` on shortcuts for spacing from label (keeps `ml-auto` right alignment)
- Use `pr-4` on items for right padding

### Toast Notifications

**Always use Sonner** for toast notifications (success, error, info, warning). The `<Toaster />` component is already mounted in `main.tsx`.

```tsx
import { toast } from "sonner"

// Basic toasts
toast.success("Settings saved")
toast.error("Failed to connect")
toast.info("New version available")
toast.warning("This action cannot be undone")

// With description
toast.success("File uploaded", {
  description: "document.pdf has been uploaded successfully",
})

// With action button
toast.error("Connection lost", {
  action: {
    label: "Retry",
    onClick: () => reconnect(),
  },
})

// Loading state with promise
toast.promise(saveData(), {
  loading: "Saving...",
  success: "Saved!",
  error: "Failed to save",
})

// Dismiss programmatically
const toastId = toast.loading("Processing...")
// Later...
toast.dismiss(toastId)
```

**When to use toasts:**
- Success confirmations (save, delete, copy)
- Error notifications (API failures, validation errors)
- Async operation feedback (loading → success/error)
- Non-blocking alerts that auto-dismiss

**When NOT to use toasts:**
- Critical errors requiring user action (use dialogs)
- Form validation errors (show inline)
- Blocking confirmations (use dialogs with actions)

## Model Configuration

**Always use the centralized model config** from `src/config/models.ts`. Never hardcode model IDs.

```typescript
// Renderer (via Vite @config alias)
import { MODELS, DEFAULT_MODEL, getModelDisplayName } from '@config/models'

// Main process (relative path)
import { DEFAULT_MODEL } from '../../../../src/config/models'
```

Available exports:
- `MODELS` - Array of user-selectable models for UI dropdowns
- `DEFAULT_MODEL` - Default model ID for new sessions
- `getModelDisplayName(id)` - Get display name for a model ID

## Commands

All commands run from the **project root** (not this directory):

```bash
bun run electron:dev          # Hot reload dev mode (recommended for development)
bun run electron:build        # Build all (main, preload, renderer, resources)
bun run electron:start        # Build and run the app

# Individual build steps
bun run electron:build:main      # Bundle main process (esbuild)
bun run electron:build:preload   # Bundle preload script (esbuild)
bun run electron:build:renderer  # Bundle React UI (Vite)
bun run electron:build:resources # Copy icons
```

### Hot Reload Development

`bun run electron:dev` provides hot reload for faster development:

- **Renderer (React)**: Vite HMR - instant updates without restart
- **Main/Preload**: esbuild watch - rebuilds on save (requires Electron restart to take effect)

The renderer loads from `http://localhost:5173` in dev mode instead of file://, enabling Vite's Hot Module Replacement.

## Architecture

```
apps/electron/
├── src/
│   ├── main/              # Electron main process (Node.js)
│   │   ├── index.ts       # Window creation, app lifecycle, nativeTheme listener
│   │   ├── ipc.ts         # IPC handler registration
│   │   ├── menu.ts        # Application menu (File, Edit, View, Help menus)
│   │   ├── sessions.ts    # SessionManager - CraftAgent integration
│   │   ├── deep-link.ts   # Deep link URL parsing and handling
│   │   └── agent-service.ts # Agent listing, caching, auth checking
│   ├── preload/           # Context bridge (main ↔ renderer)
│   │   └── index.ts       # Exposes electronAPI to renderer (incl. theme APIs)
│   ├── renderer/          # React UI (browser context)
│   │   ├── App.tsx        # Main app, session event handling
│   │   ├── main.tsx       # React entry point, ThemeProvider
│   │   ├── index.css      # CSS variables (:root, .dark, data-theme)
│   │   ├── components/
│   │   │   ├── chat/      # Chat UI (Chat, ChatInput, ChatDisplay, SessionList, PermissionBanner)
│   │   │   ├── icons/     # Custom SVG icons (PanelLeftRounded, SquarePenRounded)
│   │   │   ├── markdown/  # Markdown renderer with syntax highlighting
│   │   │   └── ui/        # shadcn/ui components
│   │   ├── context/
│   │   │   ├── NavigationContext.tsx  # Agent selection
│   │   │   └── ThemeContext.tsx       # Theme state management
│   │   ├── hooks/
│   │   │   ├── useAgentState.ts  # Agent activation state machine (IPC-based)
│   │   │   └── useDeepLinkNavigation.ts  # Deep link tab navigation
│   │   └── playground/    # Component development playground
│   │       ├── PlaygroundApp.tsx     # Main playground component
│   │       ├── ComponentPreview.tsx  # Component preview display
│   │       ├── PropsPanel.tsx        # Dynamic props editor
│   │       └── registry/             # Component registry (chat, icons, markdown)
│   └── shared/
│       └── types.ts       # IPC channels, Message/Session/FileAttachment types
├── dist/                  # Build output
└── resources/             # App icons
```

### IPC Communication

The app uses Electron's IPC for main ↔ renderer communication:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `sessions:*` | renderer → main | Session CRUD (create, delete, rename, archive) |
| `sessions:sendMessage` | renderer → main | Send message with optional file attachments |
| `workspaces:get` | renderer → main | Get configured workspaces |
| `agents:*` | renderer → main | Get agents, refresh, check auth status |
| `session:event` | main → renderer | Stream events (text_delta, tool_start, title_generated, etc.) |
| `file:read` | renderer → main | Read files (path-validated) |
| `file:openDialog` | renderer → main | Open native file picker |
| `file:readAttachment` | renderer → main | Read file as FileAttachment |
| `shell:openUrl` | renderer → main | Open URL in external browser |
| `shell:openFile` | renderer → main | Open file in default application |
| `theme:*` | both | Theme preference sync |
| `deeplink:navigate` | main → renderer | Deep link tab navigation |

**Event streaming pattern:** `sendMessage` returns immediately. Results stream via `SESSION_EVENT` channel.

### Deep Links

The app registers the `craftagents://` URL scheme for deep linking to specific tabs.

**URL Format:**
```
craftagents://workspace/{workspaceId}/tab/{tabType}[/{id}][?params]
craftagents://workspace/{workspaceId}/action/{actionName}[?params]
```

**Examples:**
| Use Case | URL |
|----------|-----|
| Chat session | `craftagents://workspace/ws123/tab/chat/session456` |
| Agent setup | `craftagents://workspace/ws123/tab/agent-setup/my-agent` |
| Agent info | `craftagents://workspace/ws123/tab/agent-info/my-agent` |
| Settings | `craftagents://workspace/ws123/tab/settings` |
| Shortcuts | `craftagents://workspace/ws123/tab/shortcuts` |
| Preferences | `craftagents://workspace/ws123/tab/preferences` |
| File | `craftagents://workspace/ws123/tab/file?path=/path/to/file.txt` |
| New chat | `craftagents://workspace/ws123/action/new-chat?agentId=my-agent` |

**Key Files:**
- `main/deep-link.ts` - URL parsing and handling
- `main/index.ts` - Protocol registration, `app.on('open-url')` handler
- `renderer/hooks/useDeepLinkNavigation.ts` - React hook for navigation
- `preload/index.ts` - `onDeepLinkNavigate` listener

**Flow:**
1. User clicks `craftagents://` URL or app launched with URL
2. Main process parses URL via `parseDeepLink()`
3. `handleDeepLink()` focuses/creates workspace window
4. Sends `DEEP_LINK_NAVIGATE` IPC to renderer
5. `useDeepLinkNavigation` hook receives event
6. Calls appropriate `useTabs()` method (e.g., `openAgentSetupTab`)
7. Tab system deduplicates (activates existing tab if ID matches)

**Cold Start:** If app isn't running, URL is stored in `pendingDeepLink` and processed after `app.whenReady()`.

### Key Integration Points

**SessionManager** (`main/sessions.ts`):
- Wraps `CraftAgent` from the parent TUI codebase
- Sets up SDK path and authentication on initialization
- Processes `AgentEvent` stream and forwards to renderer
- Tracks `toolUseId → toolName` mapping (since `tool_result` events only have `toolUseId`)
- AI-generated session titles on first exchange (via `generateSessionTitle`)
- Subagent integration: loads agent definitions and applies MCP/API configs
- Caches `SubAgentManager` per workspace for reuse across sessions

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

### Gmail OAuth Environment Variables

To enable the "Add Gmail" connection feature, set these environment variables before building:

```bash
export GMAIL_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
export GMAIL_OAUTH_CLIENT_SECRET=your-client-secret
bun run electron:build
```

Get credentials from [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth Client ID (Desktop app).

**Required scopes:** `gmail.readonly`, `userinfo.email`

These are baked into `dist/main.cjs` at build time via esbuild `--define` flags in `package.json`.

## Theming

The app supports a **two-layer theming system** using CSS custom properties:

### Layers

| Layer | HTML Attribute | CSS Selector | Purpose |
|-------|----------------|--------------|---------|
| **Mode** | `class="dark"` | `.dark { }` | Light/Dark mode |
| **Color Theme** | `data-theme="ocean"` | `[data-theme="ocean"]` | Custom color palettes |

Combined: `<html class="dark" data-theme="ocean">`

### Files

- **`index.css`** - CSS variables for `:root` (light) and `.dark` (dark) modes
- **`context/ThemeContext.tsx`** - React context managing theme state
- **`main/index.ts`** - Electron `nativeTheme` listener for system sync
- **`preload/index.ts`** - Exposes theme APIs to renderer

### ThemeContext API

```typescript
const { mode, resolvedMode, colorTheme, setMode, setColorTheme } = useTheme()

// mode: 'light' | 'dark' | 'system' (user preference)
// resolvedMode: 'light' | 'dark' (actual applied mode)
// colorTheme: string (e.g., 'default', 'ocean')
```

### Adding Custom Color Themes

Add to `index.css`:

```css
/* Custom theme - Light mode */
[data-theme="ocean"] {
  --primary: hsl(200 80% 50%);
  --ring: hsl(200 80% 50%);
}

/* Custom theme - Dark mode */
.dark[data-theme="ocean"] {
  --primary: hsl(200 80% 65%);
  --ring: hsl(200 80% 65%);
}
```

### Electron Integration

- **`nativeTheme.shouldUseDarkColors`** - Get current system preference
- **`nativeTheme.on('updated')`** - Listen for macOS appearance changes
- Renderer receives updates via `theme:systemChanged` IPC channel

## Animations

**Use Motion (formerly Framer Motion)** for all animations. The library provides smooth 60-120fps animations with spring physics.

```bash
# Already installed in apps/electron/package.json
import { motion } from "motion/react"
```

### Spring Physics Presets

```typescript
// Snappy with minimal bounce (default for UI)
const snappySpring = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.8,
}

// More pronounced bounce (playful)
const bouncySpring = {
  type: "spring",
  stiffness: 300,
  damping: 20,
  mass: 1,
}

// Exponential feel (no bounce, smooth settle)
const exponentialSpring = {
  type: "spring",
  stiffness: 600,
  damping: 40,  // Critical damping = no oscillation
}
```

### Performance Best Practices

1. **Animate GPU-accelerated properties only**: `transform`, `opacity`
2. **Avoid animating**: `width`, `height`, `top`, `left` (trigger layout recalculation)
3. **Use `overflow-hidden`** on parent to clip content during width/transform animations
4. **Use `initial={false}`** to skip animation on mount

### Example: Animated Sidebar

```tsx
<motion.div
  initial={false}
  animate={{ width: isVisible ? 260 : 0 }}
  transition={{
    type: "spring",
    stiffness: 400,
    damping: 30,
    mass: 0.8,
  }}
  className="h-full overflow-hidden shrink-0"
>
  <div className="w-[260px] h-full">
    {/* Fixed-width content */}
  </div>
</motion.div>
```

**Note:** The sidebar uses `width` animation (not `transform`) for proper layout flow, but the content inside is fixed-width so it doesn't reflow during animation.

## Debugging

- Console logs print to the terminal running `electron:start`
- DevTools opens automatically in development mode (`!app.isPackaged`)
- Key log prefixes: `[Main]`, `[SessionManager]`, `[IPC]`

## Markdown Rendering

Messages are rendered with full markdown support using custom components in `components/markdown/`:

**Components:**
- `Markdown.tsx` - Main renderer using `marked` with custom tokenizers
- `CodeBlock.tsx` - Syntax-highlighted code blocks with Shiki
- `linkify.ts` - Auto-links URLs and file paths

**Features:**
- GitHub-flavored markdown (tables, task lists, strikethrough)
- Syntax highlighting for 100+ languages via Shiki
- Clickable file paths (opens in default app via `shell.openPath`)
- Clickable URLs (opens in browser via `shell.openExternal`)
- Copy button on code blocks

**Usage:**
```tsx
import { Markdown } from '@/components/markdown'

<Markdown content={message.content} onOpenFile={handleOpenFile} onOpenUrl={handleOpenUrl} />
```

## Subagent Integration

Sessions can be associated with subagents defined in Craft documents:

**How it works:**
1. User creates session with agent: `createSession(workspaceId, agentId)`
2. `SessionManager` loads agent definition via `SubAgentManager.getDefinition()`
3. When agent is created, definition is applied with MCP servers and API configs
4. `CraftAgent.setActiveAgentDefinition()` configures custom instructions and tools

**Auth checking:**
```typescript
// Check if agent needs authentication before activation
const { needsAuth, reason } = await window.electronAPI.checkAgentAuth(workspaceId, agentId)
if (needsAuth) {
  // Show auth dialog to user
  console.log(reason) // "Requires authentication: MCP Server, API"
}
```

**Caching:** `SubAgentManager` is cached per workspace to avoid re-connecting to MCP servers for each session.

## Session Management

Sessions support naming, archiving, and persistence:

**Session Naming:**
- AI-generated titles after first assistant response (uses `generateSessionTitle`)
- Manual renaming via `renameSession(sessionId, name)`
- Displayed in session list instead of truncated message preview

**Persistence:**
- Sessions stored in `~/.craft-agent/workspaces/{id}/sessions/`
- Messages, SDK session ID, agent ID, name, and archive state are persisted
- Sessions automatically restore on app restart

**Archive:**
- Sessions can be archived/unarchived (moved between Inbox and Archive views)
- Archived sessions are hidden from main inbox but preserved

## Shell Operations

The app can open URLs and files in external applications:

```typescript
// Open URL in default browser
await window.electronAPI.openUrl('https://example.com')

// Open file in default application (e.g., VS Code for .ts files)
await window.electronAPI.openFile('/path/to/file.ts')
```

**Security:** URLs are validated to only allow `http:`, `https:`, and `mailto:` protocols. File paths are validated against allowed directories.

## File Attachments

The app supports attaching files to messages (images, PDFs, code files):

**Components:**
- `AttachmentPreview.tsx` - Shows attached files as bubbles above the textarea (ChatGPT-style)
- `ChatInput.tsx` - Handles file picker, drag-drop, paste

**Flow:**
1. User clicks paperclip or drags files → `openFileDialog()` returns paths
2. Paths are read via `readFileAttachment()` → returns `FileAttachment` objects
3. Attachments passed to `sendMessage(sessionId, message, attachments)`
4. Main process forwards attachments to `CraftAgent.chat()`

**Supported types:**
- Images: PNG, JPG, JPEG, GIF, WebP (displayed as thumbnails)
- Documents: PDF, TXT, MD
- Code: JS, TS, TSX, JSX, PY, JSON, CSS, HTML, XML, YAML

## Agent State Management

The `useAgentState` hook manages agent activation flow via IPC with the main process:

**State Machine:**
```
idle → extracting → [needs_mcp_auth] → [needs_api_auth] → ready → active
                          ↓                  ↓
                        error              error
```

**Hook API:**
```typescript
const agentState = useAgentState(workspaceId, agentId)

// Status checks
agentState.isIdle           // No agent selected
agentState.isExtracting     // Loading agent definition
agentState.isNeedsMcpAuth   // Waiting for MCP server OAuth
agentState.isNeedsApiAuth   // Waiting for API key entry
agentState.isReady          // Auth complete, ready to activate
agentState.isActive         // Agent fully activated

// Actions
await agentState.activate(agentId)           // Start activation
await agentState.continueAfterMcpAuth()      // After MCP OAuth complete
await agentState.continueAfterApiAuth()      // After API key entered
agentState.deactivate()                      // Return to idle

// Derived state
agentState.activeDefinition   // SubAgentDefinition when active
agentState.agentName          // Display name
agentState.pendingMcpServers  // MCP servers needing auth
agentState.pendingApis        // APIs needing credentials
```

**IPC Communication:** The hook communicates with `AgentStateManager` in the main process via `window.electronAPI` calls, keeping the renderer stateless.

## Application Menu

The app menu (`main/menu.ts`) provides standard macOS/Windows menu items:

**Menu Structure:**
- **File**: New Chat (⌘N)
- **Edit**: Cut, Copy, Paste, Select All
- **View**: Reload, Toggle DevTools, Zoom controls
- **Help**: Open Help, Keyboard Shortcuts

**IPC Channels:**
```typescript
MENU_NEW_CHAT           // Create new session
MENU_OPEN_SETTINGS      // Open settings dialog
MENU_KEYBOARD_SHORTCUTS // Show keyboard shortcuts
MENU_OPEN_HELP          // Open help URL
```

## Component Playground

A development tool for testing UI components in isolation:

**Access:** Run `bun run electron:dev` and navigate to `/playground.html`

**Features:**
- Browse all registered components in sidebar
- Live prop editing with type-aware inputs
- Theme toggle (light/dark)
- Component preview with state management

**Adding Components:**
```typescript
// In playground/registry/index.ts
import { myComponentDefinitions } from './my-components'

export const componentRegistry = [
  ...chatComponents,
  ...myComponentDefinitions,
]
```

## Permission Banner

The `PermissionBanner` component shows bash command approval requests:

```tsx
<PermissionBanner
  command="rm -rf /tmp/cache"
  onAllow={() => respond('allow')}
  onAlwaysAllow={() => respond('always_allow')}
  onDeny={() => respond('deny')}
/>
```

**Styling:** Amber border/background with shield icon, three action buttons.

## Current Limitations

1. Development only - no electron-builder config for distribution
