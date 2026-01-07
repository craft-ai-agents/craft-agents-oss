# CLAUDE.md

Craft Agent is a Claude Code-like interface for managing Craft documents using the Claude Agent SDK and Craft MCP servers. Supports multiple workspaces with OAuth authentication.

**Keep docs up-to-date:** `packages/shared/` → this file | `apps/electron/` → `apps/electron/CLAUDE.md` | `apps/tui/` → `apps/tui/CLAUDE.md`

## Monorepo Structure

```
craft-tui-agent/
├── apps/
│   ├── electron/    # Desktop GUI (multi-session inbox)
│   └── tui/         # Terminal CLI (Claude Code-like)
└── packages/
    ├── core/        # @craft-agent/core - Shared types
    └── shared/      # @craft-agent/shared - Business logic
```

**Imports:** `import { CraftAgent } from '@craft-agent/shared/agent'`

**Sub-docs:** [`apps/electron/CLAUDE.md`](apps/electron/CLAUDE.md) | [`apps/tui/CLAUDE.md`](apps/tui/CLAUDE.md) | [`packages/shared/CLAUDE.md`](packages/shared/CLAUDE.md)

## Commands

```bash
bun install                  # Install deps
bun start                    # Run TUI
bun dev                      # TUI with auto-reload
bun run electron:start       # Build & run Electron
bun run typecheck:all        # Type check all packages
bun link                     # Create global 'craft' command
```

**CLI Flags:**
- `--workspace/-w <name>` - Select workspace by name, ID, or URL
- `--agent/-a <name>` - Activate agent (with or without @ prefix)
- `--model/-m <model>` - Claude model to use
- `--debug` - Log to `/tmp/craft-debug.log`
- `--new` - Start fresh session
- `--session <id>` - Resume specific session
- `--print/-p <query>` - Headless mode (non-interactive)
- `--output-format <fmt>` - text, json, stream-json
- `--permission-policy <policy>` - deny-all, allow-safe, allow-all

## Releasing

Via [GitHub Actions](https://github.com/lukilabs/craft-terminal-agent/actions/workflows/build-and-upload.yml):
1. Go to Actions → "Build and Upload" → Run workflow
2. Enter version, check "upload to /latest" for default
3. Builds: darwin-arm64, darwin-x64, linux-x64, linux-arm64

**Install:** `curl -fsSL https://agents.craft.do/install.sh | bash`

## Architecture

### Agent Layer (`packages/shared/src/agent/craft-agent.ts`)

Core `CraftAgent` wrapping `@anthropic-ai/claude-agent-sdk`:
- SDK's agentic loop handles tool calls, MCP communication
- `PreToolUse` hook for bash permission approval
- `PostToolUse` hook summarizes large results (>15k tokens) using `_intent` for context
- `formatSourceState()` injects `<sources>` context into user messages
- Session continuity via `resume` option

**AgentEvent types:** `status`, `text_delta`, `text_complete`, `tool_start`, `tool_result`, `permission_request`, `ask_user`, `error`, `complete`, `task_backgrounded`, `shell_backgrounded`, `task_progress`

### Configuration (`packages/shared/src/config/storage.ts`)

```typescript
interface StoredConfig {
  authType?: 'api_key' | 'oauth_token' | 'craft_credits';
  model?: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

interface Workspace {
  id: string;
  name: string;
  mcpUrl: string;
  mcpAuthType?: 'workspace_oauth' | 'workspace_bearer' | 'public';
  sessionId?: string;
}
```

**Paths:**
- Config: `~/.craft-agent/config.json`
- Credentials: `~/.craft-agent/credentials.enc` (AES-256-GCM)
- Workspaces: `~/.craft-agent/workspaces/{id}/`
- Preferences: `~/.craft-agent/preferences.json`

**⚠️ Auth Separation:**
- `craft_oauth::global` - Craft API only (managing spaces, MCP links). NEVER for MCP auth.
- `workspace_oauth::{workspaceId}` - MCP server auth. Each server has its own OAuth.
- `getWorkspaceAccessTokenAsync()` does NOT fall back to Craft OAuth.

### Setup Flow

1. Welcome → 2. Craft OAuth → 3. Select space (auto-creates MCP link) → 4. Billing method → 5. Credentials (if needed) → 6. Validate MCP → 7. Complete

### Credential Storage (`packages/shared/src/credentials/`)

AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. Cross-platform, no OS prompts.

**Key format:** `{type}::{scope}`
```
anthropic_api_key::global             # Anthropic API key
claude_oauth::global                  # Claude Max OAuth
craft_oauth::global                   # Craft API OAuth
workspace_oauth::{workspaceId}        # Workspace MCP OAuth
workspace_bearer::{workspaceId}       # Workspace bearer token

# Source credentials
source_oauth::{sourceSlug}            # OAuth for MCP/API sources
source_bearer::{sourceSlug}           # Bearer tokens
source_apikey::{sourceSlug}           # API keys
source_basic::{sourceSlug}            # Basic auth

# Agent-scoped source credentials
agent_source_oauth::{agentSlug}::{sourceSlug}
agent_source_bearer::{agentSlug}::{sourceSlug}
agent_source_apikey::{agentSlug}::{sourceSlug}
agent_source_basic::{agentSlug}::{sourceSlug}
```

**Backend priority:** 1. Env vars (`ANTHROPIC_API_KEY`, `CRAFT_CLAUDE_OAUTH_TOKEN`) 2. Encrypted file

### Agent System (`packages/shared/src/agents/`)

Folder-based agents at `~/.craft-agent/workspaces/{ws}/agents/{agent}/`:
```
├── config.json      # { name, slug, enabled, useSources }
├── instructions.md  # Agent instructions (markdown)
└── sources/         # Optional agent-scoped sources
```

**Sources** at `~/.craft-agent/workspaces/{ws}/sources/{source}/`:
```
├── config.json      # { type, url, auth, iconUrl, tagline }
└── guide.md         # Usage documentation
```

**Source types:** `mcp` (HTTP/SSE/stdio), `api` (REST with flexible tool), `local`

**MCP Source Config (`config.json`):**
```typescript
// HTTP/SSE transport (remote servers)
{
  "type": "mcp",
  "mcp": {
    "transport": "http",  // or "sse", default: "http"
    "url": "https://example.com/mcp",
    "authType": "oauth"   // "oauth" | "bearer" | "none"
  }
}

// Stdio transport (local subprocess servers)
{
  "type": "mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@anthropic-ai/mcp-server-filesystem", "/path/to/dir"],
    "env": { "CUSTOM_VAR": "value" }  // optional
  }
}
```

**Local MCP Server Control:**
- **Workspace config:** `localMcpServers.enabled` in workspace `config.json`
- **Environment override:** `CRAFT_LOCAL_MCP_ENABLED=true|false`
- **Resolution order:** ENV > workspace config > default (true)
- **UI:** Settings → Advanced → Local MCP Servers toggle

When disabled, stdio sources show "Disabled" status in UI and are excluded from agent sessions.

**API Tools (`api-tools.ts`):** `createApiServer()` creates single `api_{name}` tool accepting `{ path, method, params }`. Auth types: `none`, `header`, `bearer`, `query`, `basic`.

### MCP Tool Metadata

Fetch interceptor injects `_displayName` and `_intent` into MCP tool schemas:
- Model must include both (required in schema)
- `PreToolUse` strips them before forwarding to MCP
- Used for UI display and summarization context

### Permission Modes

Three-level permission system (SHIFT+TAB cycles through modes):

| Mode | Display Name | Behavior |
|------|--------------|----------|
| `'safe'` | Explore | Read-only, blocks all write operations |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all commands |

**In Explore mode:**
- **Blocked:** `api_*`, Bash, Write, Edit, MCP write tools
- **Allowed:** Read, Glob, Grep, Task, WebFetch, WebSearch, MCP read tools, TodoWrite, AskUserQuestion, SubmitPlan, LSP

**Customizable permissions:** Each workspace, source, and agent can have a `permissions.json` file with custom rules:
- `blockedTools` - Additional tools to block
- `allowedBashPatterns` - Regex patterns for safe bash commands
- `allowedMcpPatterns` - Regex patterns for allowed MCP tools
- `allowedApiEndpoints` - Fine-grained API rules (method + path)
- `allowedWritePaths` - Glob patterns for writable directories

### Headless Mode (`packages/shared/src/headless/`)

```bash
craft --print "query" --output-format json --permission-policy allow-safe
```

When `isHeadless: true`: prompts wrapped in `<headless_mode>` tags, safe mode disabled. Questions return empty.

### Extended Cache TTL (`packages/shared/src/cache-ttl-interceptor.ts`)

Extends Anthropic cache from 5min to 1hr via fetch interceptor (loaded via `bunfig.toml` preload).
- **Default:** Auto - 1h for Opus, 5m for others
- **Config:** `extendedCacheTtl: true/false` to force

### Dynamic Status System (`packages/shared/src/statuses/`)

Workspace-level customizable status configuration for session workflow states.

**Storage:** `~/.craft-agent/workspaces/{id}/statuses/config.json`

**Status properties:**
- `id` - Slug identifier (e.g., `todo`, `in-progress`)
- `label` - Display name
- `color` - Hex color code
- `icon` - Emoji or file reference (`statuses/icons/`)
- `shortcut` - Single-char keyboard shortcut
- `category` - `'open'` (inbox) or `'closed'` (archive)
- `isFixed` - Built-in status (cannot delete)
- `order` - Display order

**Default statuses:** Todo, In Progress, Needs Review, Done, Cancelled

**CRUD:** `createStatus()`, `updateStatus()`, `deleteStatus()`, `reorderStatuses()` via session-scoped tools.

### Theme System (`packages/shared/src/config/theme.ts`)

Cascading theme configuration: app → workspace → agent (last wins).

**Storage:**
- App: `~/.craft-agent/theme.json`
- Workspace: `~/.craft-agent/workspaces/{id}/theme.json`
- Agent: `~/.craft-agent/workspaces/{id}/agents/{slug}/theme.json`

**6-color system:**
```typescript
{ background, foreground, accent, info, success, destructive }
```

**Dark mode:** Optional `dark: { ... }` overrides. Uses oklch color space for modern CSS.

### Session-Scoped Tools (`packages/shared/src/agent/session-scoped-tools.ts`)

Tools available within agent sessions with per-session callbacks:

**Source management:** `source_test`, `source_oauth_trigger`, `source_gmail_oauth_trigger`, `source_credential_prompt`

**Agent management:** `agent_list`, `agent_create`, `agent_delete`

**Utilities:** `SubmitPlan`, `change_working_directory`, `config_validate`

**Callback types:** `onPlanSubmitted`, `onWorkingDirectoryChange`, `onOAuthBrowserOpen`, `onOAuthSuccess`, `onOAuthError`, `onCredentialRequest`, `onSourcesChanged`, `onSourceActivated`, `onAgentsChanged`

## Key Patterns

**Streaming:** `CraftAgent.chat()` → `AsyncGenerator<SDKMessage>` → `AgentEvent` → 50ms throttled updates

**Tool Permissions:** `PreToolUse` blocks dangerous bash by default. User approves in TUI. Dangerous commands (rm, sudo, git push) never auto-allow.

**Session Continuity:** SDK session IDs per workspace. `resume` continues conversations. Failures clear and start fresh.

**Large Response Summarization:** >15k tokens auto-summarized via Haiku using `_intent` for context. Falls back to truncation.

## Project Structure

### `packages/shared/src/`

| Directory | Purpose |
|-----------|---------|
| `agent/` | CraftAgent, session-scoped-tools, mode-manager, mode-types, permissions-config |
| `agents/` | folder-manager, folder-storage, api-tools, builtin-agents |
| `auth/` | oauth, craft-token, claude-token, gmail-oauth, state |
| `clients/` | Craft API client |
| `config/` | storage, preferences, models, theme, watcher |
| `credentials/` | manager, backends (secure-storage, env) |
| `headless/` | runner, types, output |
| `mcp/` | client, validation |
| `prompts/` | system prompt |
| `sessions/` | index, storage, persistence-queue |
| `sources/` | types, storage, service |
| `statuses/` | types, crud, storage, default-icons |
| `types/` | shared type definitions |
| `utils/` | debug, files, summarize, icon, title-generator |
| `workspaces/` | storage |

## Logging & Debugging

**Important:** Prefer logging over `console.log` for debugging. Craft Agent (the AI assistant) can read log files directly, making logs the preferred way to surface debug information during development.

### Overview

Craft Agent uses a unified `debug()` utility that auto-routes based on environment:

| Environment | Console | File | Detection |
|-------------|---------|------|-----------|
| Electron Main | ✓ | ✓ | `process.type === 'browser'` |
| Electron Renderer | ✓ | - | `process.type === 'renderer'` |
| TUI (Ink) | - | ✓ | `CRAFT_TUI=1` env var |
| CLI/Scripts | ✓ | - | Default |

### Enabling Debug Mode

```bash
# TUI: Pass --debug flag
bun start --debug

# Electron: Automatic in development (!app.isPackaged)
bun run electron:start
```

### Using the Debug Utility

```typescript
import { debug, createLogger, enableDebug } from '@craft-agent/shared/utils'

// Enable debug mode (TUI does this when --debug flag passed)
enableDebug()

// Simple logging
debug('Processing request')
debug('User data', { id: 123 })

// Scoped logger with levels
const log = createLogger('agent')
log.debug('Starting session')
log.info('Connected to MCP')
log.warn('Retrying connection')
log.error('Failed to connect', error)
```

### Log Locations

| Environment | Location |
|-------------|----------|
| TUI | `/tmp/craft-debug.log` |
| Electron Main | `~/Library/Logs/Craft Agents/main.log` |
| Electron Renderer | Browser DevTools console |
| CLI | Terminal (stderr) |

### Log Format

```
2026-01-05T06:30:00.000Z [agent] INFO  Connected to MCP {"serverId":"abc"}
```

### Querying Logs

```bash
# Watch TUI logs live
tail -f /tmp/craft-debug.log

# Watch Electron logs
tail -f ~/Library/Logs/Craft\ Agents/main.log

# Search by scope
grep '\[agent\]' /tmp/craft-debug.log

# Search by level
grep 'ERROR' /tmp/craft-debug.log
```

### Electron Scoped Loggers

Electron main process also has `electron-log` based loggers with JSON file output:

```typescript
import { mainLog, sessionLog, ipcLog, windowLog, agentLog } from './logger'

sessionLog.info('Session started', { sessionId: 'abc123' })
```

### Best Practices

1. **Use `debug()` in shared code** - Auto-routes based on environment
2. **Use scoped loggers** - `createLogger('module')` for organized output
3. **Include context** - Pass objects as additional arguments
4. **Never truncate** - Log full objects, files rotate automatically
5. **Prefer logging over console.log** - Craft Agent can read log files for debugging assistance

## Development Secrets (1Password)

```bash
brew install 1password-cli
# Enable CLI in 1Password: Settings → Developer → CLI → "Integrate"
bun run sync-secrets   # Syncs op:// refs from .env.1password → .env
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun |
| AI | @anthropic-ai/claude-agent-sdk |
| Credentials | AES-256-GCM encrypted file |
| TUI | Ink 5.x, marked + shiki, meow |
| Electron | Electron + React, shadcn/ui + Tailwind v4, esbuild + Vite |

## Dependency Notes

**markitdown-js** (`^0.0.14`) - Used for file attachment processing in Electron (`apps/electron/src/main/ipc.ts`). Pre-release package with native binary dependencies:
- `exiftool-vendored` (native binary execution)
- `fluent-ffmpeg` (requires FFmpeg binary)
- `node-tesseract-ocr` (requires Tesseract binary)

Consider whether full file conversion is needed or if simpler parsing suffices for your use case.

**Duplicate markdown systems** - The codebase uses three markdown libraries:
- `marked` (TUI rendering)
- `react-markdown` (Electron message display)
- `remark` + `strip-markdown` (Electron text processing)

Future consolidation opportunity: unify on a single markdown approach.
