# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Craft TUI Agent is a Claude Code-like terminal interface for managing Craft documents. It uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to interact with Claude models and connects to Craft MCP servers for document operations. Supports multiple workspaces with separate conversations and OAuth authentication.

## Commands

```bash
# Install dependencies
bun install

# Run the application
bun start                # or: bun run src/index.tsx

# Development with auto-reload
bun dev

# Type checking
bun run typecheck

# Install globally (creates 'craft' command)
bun link
```

**CLI Flags:**
- `--setup` - Force setup wizard
- `--url, -u` - Override MCP server URL
- `--token, -t` - Override bearer token (testing)
- `--model, -m` - Override model selection

## Project Structure

```
src/
├── index.tsx                 # CLI entry point, setup routing
├── agent/
│   └── craft-agent.ts        # Claude Agent SDK wrapper
├── auth/
│   └── oauth.ts              # OAuth 2.0 with PKCE
├── config/
│   ├── env.ts                # Environment validation (legacy)
│   ├── storage.ts            # Config persistence, multi-workspace
│   └── preferences.ts        # User preferences (name, timezone, etc.)
├── mcp/
│   ├── client.ts             # MCP client & proxy for persistent connections
│   └── tools.ts              # Tool registry and help formatting
├── prompts/
│   └── system.ts             # System prompt with date/time and preferences
└── tui/
    ├── App.tsx               # Main app, command routing
    ├── components/
    │   ├── AskUserQuestion.tsx   # Interactive question UI for SDK hooks
    │   ├── Header.tsx            # Status bar (model, workspace, tokens, cost)
    │   ├── Input.tsx             # Text input with history & file handling
    │   ├── Messages.tsx          # Message display with streaming
    │   ├── ModelSelector.tsx     # Model selection UI
    │   ├── Setup.tsx             # First-run configuration wizard
    │   ├── Spinner.tsx           # Thinking indicator
    │   ├── ToolCall.tsx          # Tool execution visualization
    │   ├── WorkspaceAdd.tsx      # Add new workspace wizard
    │   ├── WorkspaceRename.tsx   # Rename workspace dialog
    │   └── WorkspaceSelector.tsx # Workspace switcher
    ├── hooks/
    │   ├── useAgent.ts           # Agent state, streaming, token tracking
    │   ├── useElapsedTime.ts     # Track elapsed time during processing
    │   ├── useHistory.ts         # Command history (arrow keys)
    │   └── useResize.ts          # Terminal resize handling
    └── utils/
        ├── files.ts              # File attachment processing
        ├── markdown.ts           # Markdown rendering with Shiki
        ├── terminalProgress.ts   # Progress bar display
        └── toolStatus.ts         # Tool status tracking
```

## Architecture

### Entry Point (`src/index.tsx`)
- Uses `meow` for CLI argument parsing
- Enables bracketed paste mode for file drag-drop
- Routes to Setup wizard or main App based on config
- Config stored in `~/.craft-agent/config.json`

### Agent Layer (`src/agent/craft-agent.ts`)
Core `CraftAgent` class that:
- Uses `@anthropic-ai/claude-agent-sdk` via the `query()` function
- Leverages SDK's built-in agentic loop (no manual tool call handling)
- Converts SDK's `SDKMessage` events to `AgentEvent` for TUI compatibility
- **Session management**: `resume` option for conversation continuity
- **Auto compaction**: SDK compresses long conversations automatically
- **MCP HTTP mode**: SDK handles MCP connections efficiently (no custom proxy needed)
- **Tool permissions**: `PreToolUse` hook for bash command approval
- **AskUserQuestion**: `canUseTool` callback for interactive questions
- **Preferences tool**: Built-in `update_user_preferences` via in-process MCP server

**AgentEvent types:** `status`, `text_delta`, `text_complete`, `tool_start`, `tool_result`, `permission_request`, `ask_user`, `error`, `complete`

### Configuration (`src/config/storage.ts`)
Multi-workspace support with:
```typescript
interface StoredConfig {
  anthropicApiKey: string;
  model?: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

interface Workspace {
  id: string;
  name: string;
  mcpUrl: string;
  oauth?: OAuthCredentials;  // For private servers
  isPublic?: boolean;        // For public servers
  sessionId?: string;        // SDK session for continuity
}
```
- Workspace conversations stored in `~/.craft-agent/workspaces/{id}/conversation.json`
- Auto-migration from legacy single-workspace format

### User Preferences (`src/config/preferences.ts`)
Stored in `~/.craft-agent/preferences.json`:
- name, timezone, location, language, notes
- Embedded in system prompt
- Updated via `update_user_preferences` tool

### MCP Integration (`src/mcp/`)
- `CraftMcpClient`: Basic MCP client for direct tool calls (used by sub-agent manager)
- SDK handles MCP connections via HTTP mode configuration
- `tools.ts`: Registry of 32+ Craft tools for `/tools` command

### OAuth (`src/auth/oauth.ts`)
- Dynamic client registration (no pre-registration)
- PKCE for security, state for CSRF protection
- Local callback server on port 8914
- Automatic token refresh

### TUI Layer (`src/tui/`)
**App.tsx** - Main component handling:
- Slash commands: `/help`, `/clear`, `/paste`, `/tools`, `/config`, `/prefs`, `/setup`, `/compact`, `/cost`, `/model`, `/workspace`, `/web`, `/fetch`, `/bash`, `/exit`
- Modal state (model selector, workspace selector, etc.)
- Message persistence

**useAgent hook** - State management:
- 50ms throttled streaming updates
- Token usage tracking (input, output, cache, cost)
- Permission and question queue handling

**Message types:** `user`, `assistant`, `tool`, `error`, `status`, `system`

### System Prompt (`src/prompts/system.ts`)
Includes:
- Current date/time context
- User preferences
- Craft environment description (spaces, blocks, smart folders)
- Available tools and capabilities

## Key Patterns

### Streaming Architecture
1. `CraftAgent.chat()` calls `query()` → returns `AsyncGenerator<SDKMessage>`
2. Events converted to `AgentEvent` objects
3. `useAgent` hook throttles updates (50ms) to reduce flickering
4. SDK handles agentic loop (tool calls, MCP communication)

### Tool Permissions
- `PreToolUse` hook blocks dangerous bash commands by default
- User approves commands in TUI
- Session-wide whitelist for approved base commands
- Dangerous commands (rm, sudo, git push) never auto-allow

### SDK MCP Integration
- SDK's HTTP mode handles MCP connections efficiently
- No custom proxy needed - SDK manages connection pooling
- Schema conversion handled internally by SDK

### Session Continuity
- SDK session IDs stored per workspace
- `resume` option continues previous conversations
- Session failures clear and start fresh
- Replayed messages skipped via `isReplay` flag

### Token Counting
- Tracks: input tokens, output tokens, cache creation, cache read
- Context tokens = base + cache for next request
- Cost calculated by SDK (`total_cost_usd`)

### Terminal Resize Handling

**The Problem:** When terminal is resized, Ink's character-by-character text rendering (like in SimpleTextInput) can wrap differently at different widths. Ink's internal log-update mechanism caches `previousLineCount` and only erases that many lines on re-render. When wrapping changes, stale line count causes partial erasure → visual artifacts (duplicated text scattered across screen).

**What Didn't Work:**
1. **Screen clear without debounce** - Race condition with React's async state updates caused blank screens
2. **Screen clear in useEffect** - Runs AFTER render, clearing just-rendered content
3. **Box borderStyle** - Ink draws borders at fixed positions that remain on resize
4. **Text with repeat(500)** - Ink doesn't truncate; text overflows and causes artifacts
5. **justifyContent="space-between"** - Fills width but doesn't fix log-update's stale line count

**Why Header Works But Input Didn't:** Header always renders in exactly 1 line (never wraps). `previousLineCount` always matches actual output. Input with character-by-character cursor rendering can wrap to multiple lines depending on terminal width.

**The Solution (`src/tui/hooks/useResize.ts`):**
1. **Debounce resize events (50ms)** - Prevents multiple clears during drag resize
2. **Clear screen synchronously** before any state updates (`\x1b[2J\x1b[3J\x1b[H`)
3. **Increment staticResetKey** via callback in same setTimeout - React 18 batches both state updates
4. **Static items re-render** on clean screen - log-update starts fresh with `previousLineCount = 0`

```typescript
// useResize accepts callback to increment staticResetKey in same batch
export function useResize(onResize?: () => void): { columns: number; rows: number }

// App.tsx passes callback that increments staticResetKey
const handleTerminalResize = useCallback(() => {
  setStaticResetKey(k => k + 1);
}, []);
useResize(handleTerminalResize);
```

**Key insight:** The `/clear` command worked perfectly because it clears screen THEN updates state. We replicated this pattern for resize with debouncing to prevent flicker.

## Debugging

Debug logs are written to `/tmp/craft-debug.log`. Use the `debug()` function from `src/tui/utils/debug.ts` to add log entries.

**Important:** Never trim or truncate log output (e.g., using `.substring()`). Full log content is essential for debugging.

**Two-terminal debugging setup:**
```bash
# Terminal 1: Run the app with stderr redirected to debug log
bun start 2>> /tmp/craft-debug.log

# Terminal 2: Watch the debug log in real-time
tail -f /tmp/craft-debug.log
```

## Tech Stack

- **Runtime**: Bun
- **TUI**: Ink 4.x (React for CLIs)
- **AI**: @anthropic-ai/claude-agent-sdk
- **MCP**: @modelcontextprotocol/sdk (via Agent SDK)
- **Markdown**: marked + marked-terminal + Shiki syntax highlighting
- **CLI**: meow for argument parsing
