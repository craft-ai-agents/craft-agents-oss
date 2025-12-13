# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Important:** Keep this file up-to-date whenever functionality changes. This should always reflect the current state of the codebase, including architecture, interfaces, and key patterns.

## Project Overview

Craft Agent is a Claude Code-like terminal interface for managing Craft documents. It uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to interact with Claude models and connects to Craft MCP servers for document operations. Supports multiple workspaces with separate conversations and OAuth authentication.

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
- `--url, -u` - Override MCP server URL
- `--token, -t` - Override bearer token (testing)
- `--model, -m` - Override model selection
- `--debug` - Enable debug logging to `/tmp/craft-debug.log`

## Releasing

Releases are built and deployed via [GitHub Actions](https://github.com/lukilabs/craft-terminal-agent/actions/workflows/build-and-upload.yml).

**To create a release:**
1. Check current latest version at https://agents.craft.do/latest
2. Go to Actions → "Build and Upload" workflow
3. Click "Run workflow"
4. Enter version (e.g., `1.0.1`)
5. Check "Also upload to /latest folder" to make it the default
6. Check "Also upload install.sh to bucket root" if install script was updated

**What it does:**
- Builds native binaries for darwin-arm64, darwin-x64, linux-x64, linux-arm64
- Uploads to `agents.craft.do/<version>/`
- Updates `/latest` pointer (if checked)

**Install command for users:**
```bash
curl -fsSL https://agents.craft.do/install.sh | bash
```

**Testing fresh install (complete uninstall):**
```bash
bash scripts/uninstall.sh
# Then open a new terminal and run the install script
```

## Project Structure

```
src/
├── index.tsx                 # CLI entry point, setup routing
├── agent/
│   └── craft-agent.ts        # Claude Agent SDK wrapper
├── agents/
│   ├── types.ts              # SubAgentDefinition, ApiConfig interfaces
│   ├── manager.ts            # SubAgentManager - list, activate, deactivate
│   ├── extractor.ts          # Agentic extraction from Craft documents
│   ├── api-tools.ts          # Dynamic MCP server factory for REST APIs
│   └── cache.ts              # Agent definition cache
├── auth/
│   └── oauth.ts              # OAuth 2.0 with PKCE
├── config/
│   ├── env.ts                # Environment validation (legacy)
│   ├── storage.ts            # Config persistence, multi-workspace
│   └── preferences.ts        # User preferences (name, timezone, etc.)
├── credentials/
│   ├── index.ts              # Public exports
│   ├── types.ts              # CredentialId, StoredCredential interfaces
│   ├── manager.ts            # CredentialManager - main API
│   └── backends/
│       ├── types.ts          # CredentialBackend interface
│       ├── secure-storage.ts # Primary: AES-256-GCM encrypted file storage
│       └── env.ts            # Environment variables (server deployment)
├── mcp/
│   ├── client.ts             # MCP client for persistent connections
│   └── validation.ts         # SDK-based MCP connection validation
├── prompts/
│   └── system.ts             # System prompt with date/time and preferences
└── tui/
    ├── App.tsx               # Main app, command routing
    ├── components/
    │   ├── ApiAuth.tsx           # API key entry for REST APIs
    │   ├── ApiKeyChange.tsx      # Change API key dialog
    │   ├── AskUserQuestion.tsx   # Interactive question UI for SDK hooks
    │   ├── Header.tsx            # Status bar (model, workspace, tokens, cost)
    │   ├── Input.tsx             # Main chat input with history & file handling
    │   ├── McpAuth.tsx           # OAuth flow for MCP servers
    │   ├── Messages.tsx          # Message display with streaming
    │   ├── ModelSelector.tsx     # Model selection UI
    │   ├── Setup.tsx             # First-run configuration wizard
    │   ├── Spinner.tsx           # Thinking indicator
    │   ├── TextInput.tsx         # Shared text input (cursor nav, selection, masking)
    │   ├── ToolCall.tsx          # Tool execution visualization
    │   ├── WorkspaceAdd.tsx      # Add new workspace wizard
    │   ├── WorkspaceRename.tsx   # Rename workspace dialog
    │   └── WorkspaceSelector.tsx # Workspace switcher
    ├── hooks/
    │   ├── useAgent.ts           # Agent state, streaming, token tracking
    │   ├── useElapsedTime.ts     # Track elapsed time during processing
    │   ├── useHistory.ts         # Command history (arrow keys)
    │   └── useResize.ts          # Terminal resize handling
    ├── keyboard/
    │   ├── index.ts              # Public exports
    │   ├── sequences.ts          # Terminal escape sequence definitions
    │   ├── actions.ts            # Keyboard action types
    │   └── useKeyboard.ts        # Input normalization hook
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
  authType?: 'api_key' | 'oauth_token' | 'craft_credits';
  model?: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

// How MCP server should be authenticated
type McpAuthType = 'workspace_oauth' | 'workspace_bearer' | 'public';

interface Workspace {
  id: string;
  name: string;
  mcpUrl: string;
  mcpAuthType?: McpAuthType; // Explicit MCP auth type (defaults to workspace_oauth)
  isPublic?: boolean;        // DEPRECATED: Use mcpAuthType instead
  sessionId?: string;        // SDK session for continuity
}
```
- Workspace conversations stored in `~/.craft-agent/workspaces/{id}/conversation.json`
- **Credentials stored in encrypted file** at `~/.craft-agent/credentials.enc`

**Important Authentication Separation:**
- **Craft OAuth (`craft_oauth::global`)**: For Craft API only (managing spaces, MCP links, credits). NEVER used for MCP server authentication.
- **Workspace OAuth (`workspace_oauth::{workspaceId}`)**: For MCP server authentication. Each MCP server has its own OAuth, separate from Craft platform.
- The `getWorkspaceAccessTokenAsync()` function does NOT fall back to Craft OAuth - MCP servers require their own credentials.

### Setup Flow (`src/tui/components/Setup.tsx`)
The setup wizard uses a "Craft-first" flow:

1. **Welcome** - Introduction
2. **Craft Login** - Mandatory OAuth with Craft account (opens browser)
3. **Select Space** - Choose from user's Craft spaces (auto-creates MCP link if needed)
4. **Billing Method** - Choose how to pay for AI:
   - **Craft Credits** - Use Craft subscription (no extra auth needed)
   - **API Key** - Pay-as-you-go via Anthropic
   - **Claude Pro/Max** - Use Claude subscription
5. **Enter Credentials** - Only for API Key or Claude Pro/Max
6. **Confirm & Validate** - Review settings, validate MCP connection
7. **Complete**

**Existing MCP shortcut:** If user already has a workspace configured, setup skips steps 2-3 and goes directly to billing method selection.

**CraftSpaceSelector** (`src/tui/components/craftAuth/CraftSpaceSelector.tsx`):
- After selecting a space, checks for existing fullSpace MCP links
- If found: shows list with existing links + "Create new" option
- If none: auto-creates a new MCP link named "Craft Agent MCP"

### Credential Storage (`src/credentials/`)
All sensitive credentials are stored in an AES-256-GCM encrypted file:
- **Location**: `~/.craft-agent/credentials.enc`
- **Encryption**: AES-256-GCM with machine-derived key (PBKDF2)
- **Cross-platform**: Works on macOS, Linux, Windows, and server environments
- **No OS prompts**: Unlike keychain, no security dialogs are shown to users

**Credential naming convention:**
```
Key format: "{type}::{scope...}"

Examples:
- anthropic_api_key::global             # Anthropic API key
- claude_oauth::global                  # Claude Max OAuth token
- craft_oauth::global                   # Craft API OAuth token
- workspace_oauth::{workspaceId}        # Workspace MCP server OAuth
- workspace_bearer::{workspaceId}       # Workspace bearer token
- mcp_oauth::{wsId}::{agentId}::{name}  # Subagent MCP server OAuth
- api_key::{wsId}::{agentId}::{name}    # Subagent REST API key

Note: Using "::" as delimiter to avoid conflicts with "/" in URLs or paths.
```

**Backend priority:**
1. Environment variables - For server deployment (`CRAFT_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`, `CRAFT_CLAUDE_OAUTH_TOKEN`)
2. Encrypted file - AES-256-GCM with machine-derived key

**Usage:**
```typescript
import { getCredentialManager } from './credentials';

const manager = getCredentialManager();
await manager.initialize();

// Global credentials
const apiKey = await manager.getApiKey();
await manager.setApiKey('sk-ant-...');

// Workspace credentials
const oauth = await manager.getWorkspaceOAuth(workspaceId);
await manager.setWorkspaceOAuth(workspaceId, { accessToken, refreshToken, ... });

// Subagent credentials
const mcpCreds = await manager.getMcpOAuth(wsId, agentId, serverName);
const apiKey = await manager.getApiKeyForAgent(wsId, agentId, apiName);
```

### User Preferences (`src/config/preferences.ts`)
Stored in `~/.craft-agent/preferences.json`:
- name, timezone, location, language, notes
- Embedded in system prompt
- Updated via `update_user_preferences` tool

### MCP Integration (`src/mcp/`)
- `CraftMcpClient`: Basic MCP client for direct tool calls (used by sub-agent manager and `/tools` command)
- SDK handles MCP connections via HTTP mode configuration
- `/tools` command fetches actual tools from connected MCP servers via `fetchTools()` in useAgent

### MCP Validation (`src/mcp/validation.ts`)
Validates MCP connections using the Claude Agent SDK's `mcpServerStatus()` method. This ensures connections work before saving credentials.

**When validation runs:**
- **Setup.tsx**: After entering MCP URL and credentials, before saving config
- **WorkspaceAdd.tsx**: After entering workspace URL and credentials, before creating workspace
- **McpAuth.tsx**: After OAuth or bearer token entry, before marking server as authenticated

**Validation flow:**
1. Create minimal `query()` with in-memory credentials
2. Configure MCP server in `mcpServers` option
3. Call `query.mcpServerStatus()` to get connection status
4. Abort query immediately after getting status
5. Return structured result based on status (`connected`, `failed`, `needs-auth`, `pending`)

**On validation failure:**
- Shows error message with reason
- Enter to retry, Esc to go back
- Credentials are preserved for retry

### Subagent System (`src/agents/`)
Subagents are specialized agents defined in Craft documents. When activated, they extend the base agent with custom instructions, MCP servers, and REST APIs.

**Key files:**
- `types.ts` - `SubAgentDefinition`, `ApiConfig` interfaces
- `manager.ts` - `SubAgentManager` for listing, activating, deactivating agents
- `extractor.ts` - Agentic extraction of agent definitions from Craft documents
- `api-tools.ts` - Single flexible tool factory for REST APIs
- `cache.ts` - Agent definition cache

**Folder structure (up to 3 levels):**
Agents can be organized in subfolders within the "Agents" folder:
```
Agents/
├── Writer                    → @writer
├── Work/
│   ├── Coder                 → @work/coder
│   └── Reviewer              → @work/reviewer
└── Personal/
    └── Creative/
        └── Storyteller       → @personal/creative/storyteller
```
- Agent names include their folder path: `@folder/subfolder/name`
- Tab completion works with paths: `@wo` → `@work/...`
- Maximum 3 levels deep (root + 2 subfolder levels)

**Extraction flow (`extractor.ts`):**
1. Uses Claude Agent SDK to agentically read Craft document via MCP tools
2. Claude parses document structure, finding Instructions section
3. Extracts MCP server configs (HTTP/HTTPS URLs only, not npx/stdio)
4. Detects REST APIs from curl examples, fetch/axios calls, or API documentation links
5. Extracts comprehensive markdown `documentation` for each API (endpoints, params, examples)
6. Returns structured `ExtractionResult` with instructions, servers, and APIs

**Dynamic API Integration (`api-tools.ts`):**
Each API becomes a single flexible tool via `createApiServer()`:
```typescript
// Each API becomes ONE flexible tool
createApiServer(config: ApiConfig, credential: ApiCredential)
// Creates tool: api_exa (accepts { path, method, params })
```
- Tool named `api_{name}` accepts `{ path, method, params }`
- Claude uses extracted `documentation` field to determine endpoints/params
- Auth types: `none`, `header`, `bearer`, `query`, `basic`
- `ApiCredential` = string (API key) or `BasicAuthCredential` (username/password)
- Custom credential labels via `auth.credentialLabel` and `auth.secretLabel`
- Credentials injected automatically - Claude never sees keys

**Large Response Summarization:**
API responses can be huge (e.g., full web page content). To prevent context overflow:
1. Extractor prompt emphasizes pagination/limit parameters in tool descriptions
2. Responses >10k tokens (~40KB) are automatically summarized using Claude Haiku
3. Summarization uses request params as context to focus on relevant information
4. Input truncated to 20k tokens before summarization to prevent Haiku overflow
5. Falls back to simple truncation if summarization fails

**Credential storage:**
- Stored in encrypted file via `CredentialManager` (see Credential Storage section)
- MCP OAuth: `mcp_oauth::{workspaceId}::{agentId}::{serverName}`
- API keys: `api_key::{workspaceId}::{agentId}::{apiName}` (string or JSON `{username,password}` for basic auth)

### OAuth (`src/auth/oauth.ts`)
- Dynamic client registration (no pre-registration)
- PKCE for security, state for CSRF protection
- Local callback server on port 8914
- Automatic token refresh

### TUI Layer (`src/tui/`)
**App.tsx** - Main component handling:
- Slash commands: `/help`, `/clear`, `/paste`, `/tools`, `/settings`, `/prefs`, `/setup`, `/cost`, `/model`, `/workspace`, `/debug`, `/exit`
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

### Extended Prompt Cache TTL (`src/cache-ttl-interceptor.ts`)
Extends Anthropic's prompt cache from 5 minutes to 1 hour for longer conversations.

**How it works:**
1. Imported as FIRST import in `index.tsx` (patches fetch before SDK loads)
2. Also loaded via `bunfig.toml` preload for dev mode (belt-and-suspenders)
3. Patches `globalThis.fetch` before the SDK captures the reference
4. Intercepts Anthropic API requests and adds `ttl: "1h"` to `cache_control` blocks
5. Beta header in `craft-agent.ts` conditionally added based on config/model

**Why first import matters:**
- ES modules capture references at load time
- The interceptor must patch fetch before SDK imports evaluate
- Direct import works in compiled binaries (preload doesn't)
- Preload still helps in dev mode as extra safety

**Configuration (`~/.craft-agent/config.json`):**
- Not set (default): Auto mode - 1h for Opus models, 5m for others
- `extendedCacheTtl: true`: Force 1h for all models
- `extendedCacheTtl: false`: Force 5m for all models

**Why Opus only by default:**
Opus is expensive ($15/MTok input vs $3/MTok for Sonnet). The 2x cache write cost is negligible compared to Opus base cost, but significant for cheaper models.

**Pricing impact:**
| Cache Type | Write Cost | Read Cost |
|------------|------------|-----------|
| 5-minute (default) | 1.25x base | 0.1x base |
| 1-hour (extended) | 2x base | 0.1x base |

### Keyboard Input Layer (`src/tui/keyboard/`)

Centralized detection helpers for keyboard shortcuts. Works WITH Ink's `useInput` (not as a wrapper).

**Important**: Ink transforms escape sequences before we see them:
- Strips `\x1b` prefix from sequences
- Sets `key.return`, `key.escape`, etc. for recognized keys

| Key Combo | Ghostty Sends | Ink Delivers | Action |
|-----------|---------------|--------------|--------|
| Shift+Enter | `\x1b[27;2;13~` | `input='[27;2;13~'` | Insert newline |
| Alt+Enter | `\x1b\r` | `input='\r'` + `key.meta=true` | Insert newline |
| Cmd+Left | `\x01` (Ctrl+A) | `input='\x01'` | Line start |
| Cmd+Right | `\x05` (Ctrl+E) | `input='\x05'` | Line end |
| Option+Left | `\x1bb` | `input='b'` + `key.meta=true` | Word left |
| Option+Right | `\x1bf` | `input='f'` + `key.meta=true` | Word right |
| Ctrl+U | `\x15` | `input='\x15'` | Clear line |
| Ctrl+W | `\x17` | `input='\x17'` | Delete word backward |
| Ctrl+K | `\x0b` | `input='\x0b'` | Kill to end of line |
| Option+Delete | `\x1b\x7f` | `input='\x7f'` + `key.meta=true` | Delete word backward |
| Alt+D | `\x1bd` | `input='d'` + `key.meta=true` | Delete word forward |

**Note:** Mac keyboards have "Delete" (acts as backspace) but no "Backspace" key.

**Architecture:**
- `mappings.ts` - Detection functions + documentation

**Usage:**
```typescript
import { useInput } from 'ink';
import { isShiftOrAltEnter, isLineStart, isLineEnd } from '../keyboard';

useInput((input, key) => {
  if (isShiftOrAltEnter(input, key)) { /* newline */ }
  if (isLineStart(input, key)) { /* jump to start */ }
  if (key.return) { /* submit */ }
});
```

**Note:** Ctrl+A is "line start" (readline convention), not "select all".

**Ctrl+Key Raw Character Pattern:**
When handling Ctrl+key shortcuts in raw terminal mode, always check for BOTH forms:
1. The high-level interpretation: `key.ctrl && input === 'letter'`
2. The raw character: `input === '\xNN'` (where NN is the ASCII code)

```typescript
// Example: Ctrl+C detection
const isCtrlC = input === '\x03' || (key.ctrl && input === 'c');

// Common raw character codes:
// Ctrl+C → '\x03' (ETX, ASCII 3)  - C is 3rd letter
// Ctrl+G → '\x07' (BEL, ASCII 7)  - G is 7th letter
// Ctrl+K → '\x0b' (VT, ASCII 11)  - K is 11th letter
// Ctrl+R → '\x12' (DC2, ASCII 18) - R is 18th letter
// Ctrl+U → '\x15' (NAK, ASCII 21) - U is 21st letter
// Ctrl+W → '\x17' (ETB, ASCII 23) - W is 23rd letter
```

Different terminals/Ink versions may deliver only the raw character without setting `key.ctrl`. See `mappings.ts` for the canonical implementations.

### Terminal Resize Handling

**The Problem:** When terminal is resized, Ink's character-by-character text rendering (like in TextInput) can wrap differently at different widths. Ink's internal log-update mechanism caches `previousLineCount` and only erases that many lines on re-render. When wrapping changes, stale line count causes partial erasure → visual artifacts (duplicated text scattered across screen).

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

### TextInput Component (`src/tui/components/TextInput.tsx`)
Shared text input used by all input dialogs (API keys, bearer tokens, workspace names, etc.).

**Features:**
- Arrow key navigation (←→) with Cmd+arrows for line start/end
- Option+arrows for word boundary navigation
- Shift+arrows for text selection (tracks anchor/active positions)
- Ctrl+A to select all, Ctrl+U to clear line
- Password masking with optional reveal (`mask="•" maskReveal={{ last: 4 }}`)
- Block or bar cursor styles

**Key props:**
- `mask` - Character to mask input (e.g., `"•"` for passwords)
- `maskReveal` - Show first/last N characters unmasked
- `detectFilePaths` - When true, intercepts file paths for drag-drop handling (only used by main Input.tsx)
- `onCancel` - Callback for Escape or Ctrl+C (cancel actions)

**Selection tracking:** Uses `{ anchor, active }` instead of `{ start, end }` to correctly extend selections across multiple keystrokes.

**Cancel handling:** `onCancel` prop handles both Escape and Ctrl+C. Use it for simple cancel scenarios. For complex logic (clearing attachments, canceling OAuth), use parent `useInput` but skip steps that use TextInput to avoid double-execution.

## Debugging

Debug logging is disabled by default. Enable it with the `--debug` flag to write logs to `/tmp/craft-debug.log`.

Use the `debug()` function from `src/tui/utils/debug.ts` to add log entries. These calls are no-ops unless `--debug` is passed.

**Important:** Never trim or truncate log output (e.g., using `.substring()`). Full log content is essential for debugging.

**Two-terminal debugging setup:**
```bash
# Terminal 1: Run the app with debug logging enabled
bun start --debug

# Terminal 2: Watch the debug log in real-time
tail -f /tmp/craft-debug.log
```

## Tech Stack

- **Runtime**: Bun
- **TUI**: Ink 4.x (React for CLIs)
- **AI**: @anthropic-ai/claude-agent-sdk
- **MCP**: @modelcontextprotocol/sdk (via Agent SDK)
- **Credentials**: AES-256-GCM encrypted file storage (no OS keychain)
- **Markdown**: marked + marked-terminal + Shiki syntax highlighting
- **CLI**: meow for argument parsing
