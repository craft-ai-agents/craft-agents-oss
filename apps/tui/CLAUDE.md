# CLAUDE.md - TUI Application

This file provides guidance to Claude Code when working with the TUI (Terminal User Interface) application.

**Important:** Keep this file and `README.md` up-to-date whenever functionality changes. After making changes to this package, update the documentation to reflect the current state.

## Overview

The TUI app is the primary terminal interface for Craft Agent. It provides an interactive CLI experience similar to Claude Code, with streaming responses, tool visualization, and multi-workspace support.

**Important:** This app imports business logic from the `@craft-agent/shared` package. Only UI components, hooks, and utilities specific to the terminal interface live here.

## Directory Structure

```
apps/tui/
├── src/
│   ├── index.tsx          # CLI entry point, argument parsing, routing
│   ├── App.tsx             # Root component, global state provider
│   ├── components/         # React (Ink) UI components
│   │   ├── Setup.tsx       # First-run configuration wizard
│   │   ├── Header.tsx      # Status bar (model, workspace, tokens)
│   │   ├── Input.tsx       # Main chat input with history
│   │   ├── Messages.tsx    # Message display with streaming
│   │   ├── ToolCall.tsx    # Tool execution visualization
│   │   ├── TextInput.tsx   # Shared text input (cursor, selection)
│   │   ├── ModelSelector.tsx
│   │   ├── WorkspaceSelector.tsx
│   │   ├── WorkspaceAdd.tsx
│   │   └── ...
│   ├── context/
│   │   └── GlobalContext.tsx  # Model, workspace, session state
│   ├── hooks/
│   │   ├── core/
│   │   │   ├── useAgent.ts      # Agent state, streaming, tokens
│   │   │   ├── useElapsedTime.ts
│   │   │   └── useResize.ts     # Terminal resize handling
│   │   ├── input/
│   │   │   ├── useHistory.ts    # Command history
│   │   │   ├── useCommands.ts   # Slash command handling
│   │   │   └── useMentionHandler.ts  # @agent mentions
│   │   └── modals/
│   │       ├── useModalState.ts
│   │       ├── useWorkspaceHandlers.ts
│   │       └── useSettingsHandlers.ts
│   ├── keyboard/
│   │   └── mappings.ts    # Keyboard shortcut detection
│   ├── types/
│   │   └── marked-terminal.d.ts  # TypeScript declarations
│   └── utils/
│       ├── filtering.ts   # Command hints, tab completion
│       ├── markdown.ts    # Markdown rendering with Shiki
│       ├── terminalProgress.ts
│       └── toolStatus.ts
├── package.json
└── tsconfig.json
```

## Key Patterns

### Permission Modes

Three-level permission system integrated from `@craft-agent/shared`:
- `'safe'` (Explore) - Read-only, blocks write operations
- `'ask'` (Ask to Edit) - Prompts for bash commands (default)
- `'allow-all'` (Auto) - Auto-approves all commands

Header colors use centralized `PERMISSION_MODE_CONFIG` for consistency.

### Background Task Events

The `useAgent` hook handles background task events:
- `task_backgrounded` - Agent task started in background
- `shell_backgrounded` - Bash shell backgrounded
- `task_progress` - Live elapsed time updates

`ToolCall.tsx` shows backgrounded status with `⟳` icon and elapsed time.

### Import Strategy

The TUI app uses workspace package imports for shared logic:

```typescript
// Imports from @craft-agent/shared
import { loadStoredConfig } from '@craft-agent/shared/config';
import { CraftAgent } from '@craft-agent/shared/agent';
import { debug } from '@craft-agent/shared/utils';

// Local imports (TUI-specific)
import { useAgent } from './hooks/core/useAgent.ts';
import { renderMarkdown } from './utils/markdown.ts';
```

### Session-Based Architecture

The app uses session-based isolation where each session maps 1:1 with a CraftAgent instance:

```
App (Global: model, workspace)
└── SessionContainer key={session.id}
    └── All session-scoped state
        • messages, tokenUsage, streamingText
        • pendingPermission, pendingQuestion
        • CraftAgent instance
```

When `session.id` changes, React unmounts/remounts SessionContainer, ensuring complete state isolation.

### Streaming Updates

The `useAgent` hook throttles streaming updates to 50ms to prevent flickering:

```typescript
// In useAgent.ts
const throttledSetStreamingText = useMemo(
  () => throttle((text: string) => setStreamingText(text), 50),
  []
);
```

### useAgent Hook Features

The `useAgent` hook provides:
- `permissionMode` - Current session permission mode
- `cycleMode` - Cycle through permission modes
- `setSessionPermissionMode` - Set specific mode
- Background task event handling
- Debounced session persistence (500ms)
- Agent extraction progress UI
- Todo management from `TodoWrite` tool calls

## Commands

```bash
# From monorepo root
bun run start                    # Run TUI
bun run dev                      # Run with auto-reload
bun run apps/tui/src/index.tsx   # Run directly

# CLI flags
--debug          # Enable debug logging to /tmp/craft-debug.log
--workspace, -w  # Select workspace by name/ID/URL
--model, -m      # Override model selection
--new            # Start new session
--session <id>   # Resume specific session
--print, -p      # Non-interactive print mode
```

## Logging & Debugging

### Overview

The TUI uses the `debug()` utility from `@craft-agent/shared`. The utility auto-detects the TUI environment (via `CRAFT_TUI=1` env var set at startup) and routes logs to **file only** to avoid interfering with Ink's terminal rendering.

### Running with Logs

```bash
# Run with debug logging enabled
bun start --debug

# Logs appear in:
# File: /tmp/craft-debug.log (file only - no console output in TUI)

# Watch logs in a separate terminal
tail -f /tmp/craft-debug.log
```

### Using the Debug Utility

```typescript
import { debug, createLogger, isDebugEnabled } from '@craft-agent/shared/utils'

// Simple debug
debug('Processing request', { id: 123 })

// Scoped logger with levels
const log = createLogger('session')
log.debug('Starting session')
log.info('Connected to MCP')
log.warn('Retrying connection')
log.error('Failed to connect', error)

// Check if debug mode is active
if (isDebugEnabled()) {
  // Additional debug logic
}
```

### Log Format

```
2026-01-05T06:30:00.000Z [session] INFO  Connected to MCP {"serverId":"abc"}
```

### Watching Logs

```bash
# Watch log file in separate terminal
tail -f /tmp/craft-debug.log

# Search for specific entries
grep '\[session\]' /tmp/craft-debug.log

# Search by level
grep 'ERROR' /tmp/craft-debug.log
```

### Environment Detection

The TUI sets `CRAFT_TUI=1` at startup (before imports) so the debug utility knows to route to file only. This avoids stdout/stderr interference with Ink's terminal rendering.

### Production

When `--debug` is not passed:
- `debug()` calls are no-ops (immediate return)
- No performance impact from logging code
- No files written

## Dependencies

- **Workspace packages:** `@craft-agent/core`, `@craft-agent/shared`
- **UI:** Ink 5.x (React for CLIs)
- **Styling:** chalk for colors
- **Markdown:** marked + marked-terminal + Shiki

## Relationship to Shared Package

| This App (`apps/tui/src/`) | `@craft-agent/shared` |
|---------------------------|------------------------|
| UI components (Ink/React) | Agent logic (`agent/`) |
| Terminal-specific hooks   | Storage (`config/`) |
| Keyboard handling         | Auth (`auth/`) |
| Markdown rendering        | MCP client (`mcp/`) |
|                           | Credentials (`credentials/`) |
|                           | Sub-agents (`agents/`) |
|                           | Debug utilities (`utils/`) |
|                           | Headless mode (`headless/`) |

## Keyboard Input Layer (`keyboard/mappings.ts`)

Centralized detection helpers for keyboard shortcuts. Works WITH Ink's `useInput` (not as a wrapper).

**Important**: Ink transforms escape sequences before we see them (strips `\x1b` prefix, sets `key.return`, `key.escape`, etc.).

| Key Combo | Ink Delivers | Action |
|-----------|--------------|--------|
| Shift+Enter | `input='[27;2;13~'` | Insert newline |
| Alt+Enter | `input='\r'` + `key.meta=true` | Insert newline |
| Cmd+Left | `input='\x01'` | Line start |
| Cmd+Right | `input='\x05'` | Line end |
| Option+Left | `input='b'` + `key.meta=true` | Word left |
| Option+Right | `input='f'` + `key.meta=true` | Word right |
| Ctrl+U | `input='\x15'` | Clear line |
| Ctrl+W | `input='\x17'` | Delete word backward |
| Ctrl+K | `input='\x0b'` | Kill to end of line |
| Option+Delete | `key.meta=true` + `key.delete=true` | Delete word backward |

**Usage:**
```typescript
import { useInput } from 'ink';
import { isShiftOrAltEnter, isLineStart, isLineEnd } from '../keyboard';

useInput((input, key) => {
  if (isShiftOrAltEnter(input, key)) { /* newline */ }
  if (isLineStart(input, key)) { /* jump to start */ }
});
```

**Ctrl+Key Raw Character Pattern:** Always check both forms:
```typescript
const isCtrlC = input === '\x03' || (key.ctrl && input === 'c');
// Ctrl+C → '\x03' | Ctrl+U → '\x15' | Ctrl+W → '\x17' | Ctrl+K → '\x0b'
```

## Terminal Resize Handling (`hooks/core/useResize.ts`)

**Problem:** Ink's `log-update` caches `previousLineCount`. When terminal width changes, text wrapping changes, causing visual artifacts.

**Solution:**
1. Debounce resize events (50ms)
2. Clear screen synchronously (`\x1b[2J\x1b[3J\x1b[H`)
3. Increment `staticResetKey` via callback in same setTimeout
4. Static items re-render on clean screen

```typescript
const handleTerminalResize = useCallback(() => {
  setStaticResetKey(k => k + 1);
}, []);
useResize(handleTerminalResize);
```

## TextInput Component (`components/TextInput.tsx`)

Shared text input for all dialogs (API keys, bearer tokens, workspace names).

**Features:**
- Arrow navigation with Cmd+arrows for line start/end
- Option+arrows for word boundary navigation
- Shift+arrows for text selection (anchor/active positions)
- Ctrl+A select all, Ctrl+U clear line
- Password masking: `mask="•" maskReveal={{ last: 4 }}`

**Key props:** `mask`, `maskReveal`, `detectFilePaths` (for drag-drop), `onCancel` (Escape/Ctrl+C)

## Ultrathink Mode

Keyword "ultrathink" in messages triggers extended thinking (64k tokens Opus/Sonnet, 8k Haiku).

**Files:** `utils/gradient.ts` (detection, gradient rendering), `components/Spinner.tsx` (indicator), `hooks/core/useAgent.ts` (state)

**Gradient (cyan→magenta→cyan):**
```
ANSI 256: [51, 45, 39, 129, 201, 201, 129, 39, 45, 51]
```
