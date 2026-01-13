# CLAUDE.md

Craft Agent is a Claude Code-like interface for managing Craft documents using the Claude Agent SDK and Craft MCP servers. The primary interface is the **Electron desktop app** with multi-session inbox management.

**Keep docs up-to-date:** `packages/shared/` → this file | `apps/electron/` → `apps/electron/CLAUDE.md`

## Monorepo Structure

```
craft-tui-agent/
├── apps/
│   ├── electron/    # Desktop GUI (primary interface)
│   └── tui/         # Terminal CLI (deprecated)
└── packages/
    ├── core/        # @craft-agent/core - Shared types
    └── shared/      # @craft-agent/shared - Business logic
```

**Imports:** `import { CraftAgent } from '@craft-agent/shared/agent'`

**Sub-docs:** [`apps/electron/CLAUDE.md`](apps/electron/CLAUDE.md) | [`packages/shared/CLAUDE.md`](packages/shared/CLAUDE.md)

## Commands

```bash
bun install                  # Install deps
bun run electron:dev         # Hot reload dev mode
bun run electron:start       # Build & run Electron
bun run typecheck:all        # Type check all packages
```

## Releasing

### TUI CLI

Via [GitHub Actions](https://github.com/lukilabs/craft-terminal-agent/actions/workflows/build-and-upload.yml):
1. Go to Actions → "Build and Upload" → Run workflow
2. Enter version, check "upload to /latest" for default
3. Builds: darwin-arm64, darwin-x64, linux-x64, linux-arm64

**Install:** `curl -fsSL https://agents.craft.do/install.sh | bash`

### Electron Desktop App (macOS)

**Via GitHub Actions:**
1. Go to Actions → "Build and Upload" → Run workflow
2. Check "Build and upload Electron desktop app (macOS DMG)"
3. Optionally check "upload to /latest" and "upload install.sh"
4. Builds both arm64 and x64 DMG files

**Local build:**
```bash
# Build DMG only
bash apps/electron/scripts/build-dmg.sh arm64

# Build and upload to S3
bash apps/electron/scripts/build-dmg.sh arm64 --upload --latest --script

# Show all options
bash apps/electron/scripts/build-dmg.sh --help
```

**Build script options:**
- `arm64` or `x64` - Target architecture (default: arm64)
- `--upload` - Upload DMG to S3 after building
- `--latest` - Also update `electron/latest` (requires --upload)
- `--script` - Also upload `install-app.sh` (requires --upload)

**Environment variables for build:**
- `APPLE_SIGNING_IDENTITY` - Code signing identity (optional)
- `APPLE_ID` - Apple ID for notarization (optional)
- `APPLE_TEAM_ID` - Apple Team ID (optional)
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password (optional)
- `S3_VERSIONS_BUCKET_ENDPOINT` - S3 endpoint (for --upload)
- `S3_VERSIONS_BUCKET_ACCESS_KEY_ID` - S3 access key (for --upload)
- `S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY` - S3 secret key (for --upload)

**Install:** `curl -fsSL https://agents.craft.do/install-app.sh | bash`

### Version Sync

When bumping the version:

1. Update `packages/shared/src/version/app-version.ts` → `APP_VERSION = 'X.Y.Z'`
2. Run `bun run scripts/sync-version.ts` to sync all package.json files

The sync script reads APP_VERSION and updates all package.json files in the monorepo.

## Architecture

### Agent Layer (`packages/shared/src/agent/craft-agent.ts`)

Core `CraftAgent` wrapping `@anthropic-ai/claude-agent-sdk`:
- SDK's agentic loop handles tool calls, MCP communication
- `PreToolUse` hook for bash permission approval
- `PostToolUse` hook summarizes large results (>15k tokens) using `_intent` for context
- `formatSourceState()` injects `<sources>` context into user messages
- Session continuity via `resume` option

**AgentEvent types:** `status`, `text_delta`, `text_complete`, `tool_start`, `tool_result`, `permission_request`, `error`, `complete`, `task_backgrounded`, `shell_backgrounded`, `task_progress`

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

**Auth Separation:**
- `craft_oauth::global` - Craft API only (managing spaces, MCP links). NEVER for MCP auth.
- `workspace_oauth::{workspaceId}` - MCP server auth. Each server has its own OAuth.
- `getWorkspaceOAuth()` does NOT fall back to Craft OAuth.

### Credential Storage (`packages/shared/src/credentials/`)

AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. Cross-platform, no OS prompts.

**Key format:** `{type}::{scope}`
```
anthropic_api_key::global             # Anthropic API key
claude_oauth::global                  # Claude Max OAuth
craft_oauth::global                   # Craft API OAuth
workspace_oauth::{workspaceId}        # Workspace MCP OAuth
source_oauth::{workspaceId}::{sourceSlug}    # OAuth for MCP/API sources
source_bearer::{workspaceId}::{sourceSlug}   # Bearer tokens
source_apikey::{workspaceId}::{sourceSlug}   # API keys
```

### Sources (`packages/shared/src/sources/`)

**Sources** at `~/.craft-agent/workspaces/{ws}/sources/{source}/`:
```
├── config.json      # { type, url, auth, iconUrl, tagline }
└── guide.md         # Usage documentation
```

**Source types:** `mcp` (HTTP/SSE/stdio), `api` (REST with flexible tool), `local`

**MCP Source Config:**
```typescript
// HTTP/SSE transport (remote servers)
{ "type": "mcp", "mcp": { "transport": "http", "url": "https://...", "authType": "oauth" } }

// Stdio transport (local subprocess servers)
{ "type": "mcp", "mcp": { "transport": "stdio", "command": "npx", "args": ["@anthropic-ai/mcp-server-filesystem", "/path"] } }
```

**Local MCP Control:** `localMcpServers.enabled` in workspace config or `CRAFT_LOCAL_MCP_ENABLED` env var.

### Skills (`packages/shared/src/skills/`)

**Skills** are specialized instructions at `~/.craft-agent/workspaces/{ws}/skills/{slug}/`:
```
├── SKILL.md         # YAML frontmatter + instructions
└── icon.svg         # Optional icon
```

### Session System (`packages/shared/src/sessions/`)

**JSONL Format:** Line 1 = header (metadata), Lines 2+ = messages
- Fast session list loading (only read first line)
- Append-only message storage
- Cross-machine portability via path normalization

**Session ID:** `YYMMDD-adjective-noun` (e.g., `260111-swift-river`)

### Dynamic Status System (`packages/shared/src/statuses/`)

Workspace-level customizable workflow states at `~/.craft-agent/workspaces/{id}/statuses/config.json`

**Default statuses:** Todo, In Progress, Needs Review, Done, Cancelled

**Category:** `'open'` (inbox) or `'closed'` (archive)

### Permission Modes

Three-level permission system (SHIFT+TAB cycles):

| Mode | Display | Behavior |
|------|---------|----------|
| `'safe'` | Explore | Read-only, blocks all write operations |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all commands |

**In Explore mode blocked:** `api_*`, Bash, Write, Edit, MCP write tools

### Theme System (`packages/shared/src/config/theme.ts`)

Cascading: app → workspace. **6-color system:** background, foreground, accent, info, success, destructive

## Key Patterns

**Streaming:** `CraftAgent.chat()` → `AsyncGenerator<SDKMessage>` → `AgentEvent` → 50ms throttled updates

**Tool Permissions:** `PreToolUse` blocks dangerous bash by default. Dangerous commands (rm, sudo, git push) never auto-allow.

**Large Response Summarization:** >15k tokens auto-summarized via Haiku using `_intent` for context.

## Project Structure

### `packages/shared/src/`

| Directory | Purpose |
|-----------|---------|
| `agent/` | CraftAgent, session-scoped-tools, mode-manager, permissions-config |
| `auth/` | oauth, craft-token, claude-token, google-oauth, state |
| `config/` | storage, preferences, models, theme, watcher |
| `credentials/` | manager, backends (secure-storage, env) |
| `mcp/` | client, validation |
| `sessions/` | index, storage, persistence-queue |
| `skills/` | types, storage (SKILL.md parsing) |
| `sources/` | types, storage, service, credential-manager, api-tools |
| `statuses/` | types, crud, storage, default-icons |
| `utils/` | debug, files, summarize |

## Logging & Debugging

**Prefer logging over `console.log`** - Craft Agent can read log files directly.

| Environment | Console | File | Location |
|-------------|---------|------|----------|
| Electron Main | Yes | Yes | `~/Library/Logs/Craft Agents/main.log` |
| Electron Renderer | Yes | No | DevTools console |

```typescript
import { debug, createLogger } from '@craft-agent/shared/utils'
const log = createLogger('agent')
log.info('Connected to MCP')
```

## Development Secrets (1Password)

```bash
brew install 1password-cli
bun run sync-secrets   # Syncs op:// refs from .env.1password → .env
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Bun |
| AI | @anthropic-ai/claude-agent-sdk |
| Credentials | AES-256-GCM encrypted file |
| Electron | Electron + React, shadcn/ui + Tailwind v4, esbuild + Vite |
