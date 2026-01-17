# CLAUDE.md

Craft Agent is a Claude Code-like interface for managing Craft documents using the Claude Agent SDK and Craft MCP servers. The primary interface is the **Electron desktop app** with multi-session inbox management.

**Keep docs up-to-date:** `packages/shared/` → this file | `apps/electron/` → `apps/electron/CLAUDE.md`

## Monorepo Structure

```
craft-agent/
├── apps/
│   ├── electron/    # Desktop GUI (primary interface)
│   └── viewer/      # Web viewer for session transcripts
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
bun run viewer:dev           # Web viewer at http://localhost:5174
bun run typecheck:all        # Type check all packages
```

## Multi-Instance Development

Run multiple instances simultaneously by cloning to numbered folders:

```bash
# Clone to numbered folders
git clone ... craft-tui-agent-1
git clone ... craft-tui-agent-2

# Each instance auto-detects from folder name
cd craft-tui-agent-1 && bun run electron:dev  # Port 1173, config ~/.craft-agent-1/
cd craft-tui-agent-2 && bun run electron:dev  # Port 2173, config ~/.craft-agent-2/
```

**Auto-detected settings per instance:**

| Folder Suffix | Vite Port | Config Dir | App Name | Dock Badge |
|---------------|-----------|------------|----------|------------|
| (none) | 5173 | `~/.craft-agent/` | Craft Agents | - |
| `-1` | 1173 | `~/.craft-agent-1/` | Craft Agents [1] | "1" |
| `-2` | 2173 | `~/.craft-agent-2/` | Craft Agents [2] | "2" |

**Environment variables** (set by `scripts/detect-instance.sh`):
- `CRAFT_VITE_PORT` - Vite dev server port
- `CRAFT_CONFIG_DIR` - Config directory path
- `CRAFT_APP_NAME` - App display name
- `CRAFT_INSTANCE_NUMBER` - Instance number for dock badge
- `CRAFT_DEEPLINK_SCHEME` - Deep link URL scheme (craftagents, craftagents1, etc.)

## Releasing

### Electron Desktop App (Multi-Platform)

**Via GitHub Actions (recommended):**
1. Go to Actions → "Build and Upload" → Run workflow
2. Check/uncheck platforms to build (macOS, Windows, Linux - all enabled by default)
3. Optionally check "upload to /latest" and "upload install.sh"
4. Builds run in parallel across selected platforms/architectures

**Supported platforms:**

| Platform | Architecture | Output | Runner |
|----------|--------------|--------|--------|
| macOS | arm64 | `.dmg` | `macos-14` |
| macOS | x64 | `.dmg` | `macos-13` |
| Windows | x64 | `.exe` | `windows-latest` |
| Linux | x64 | `.AppImage` | `ubuntu-latest` |
| Linux | arm64 | `.AppImage` | `ubuntu-24.04-arm64` |

**Local build:**
```bash
# macOS
bash apps/electron/scripts/build-dmg.sh arm64
bash apps/electron/scripts/build-dmg.sh x64

# Windows (from PowerShell)
powershell -ExecutionPolicy Bypass -File apps/electron/scripts/build-win.ps1

# Linux
bash apps/electron/scripts/build-linux.sh x64
bash apps/electron/scripts/build-linux.sh arm64

# Build and upload to S3 (any platform)
bash apps/electron/scripts/build-dmg.sh arm64 --upload --latest --script
```

**Build script options:**
- `arm64` or `x64` - Target architecture (default varies by platform)
- `--upload` - Upload installer to S3 after building
- `--latest` - Also update `electron/latest` (requires --upload)
- `--script` - Also upload install scripts (requires --upload)

**Environment variables for build:**
- `APPLE_SIGNING_IDENTITY` - Code signing identity (macOS, optional)
- `APPLE_ID` - Apple ID for notarization (macOS, optional)
- `APPLE_TEAM_ID` - Apple Team ID (macOS, optional)
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password (macOS, optional)
- `S3_VERSIONS_BUCKET_ENDPOINT` - S3 endpoint (for --upload)
- `S3_VERSIONS_BUCKET_ACCESS_KEY_ID` - S3 access key (for --upload)
- `S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY` - S3 secret key (for --upload)

**S3 structure after build:**
```
agents-craft-do/
├── electron/
│   ├── {version}/
│   │   ├── Craft-Agent-arm64.dmg      # macOS Apple Silicon
│   │   ├── Craft-Agent-x64.dmg        # macOS Intel
│   │   ├── Craft-Agent-x64.exe        # Windows
│   │   ├── Craft-Agent-x64.AppImage   # Linux x64
│   │   ├── Craft-Agent-arm64.AppImage # Linux ARM64
│   │   └── manifest.json
│   ├── latest
│   ├── install-app.sh
│   └── install-app.ps1
```

**Install:**
- **macOS:** `curl -fsSL https://agents.craft.do/install-app.sh | bash`
- **Windows:** `irm https://agents.craft.do/install-app.ps1 | iex`

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
  authType?: 'api_key' | 'oauth_token';
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

App-level only. **6-color system:** background, foreground, accent, info, success, destructive. Preset themes at `~/.craft-agent/themes/`

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
| Fetch Interceptor | No | Yes | `~/.craft-agent/logs/interceptor.log` |

```typescript
import { debug, createLogger } from '@craft-agent/shared/utils'
const log = createLogger('agent')
log.info('Connected to MCP')
```

**Interceptor logs:** Enable with `--debug` flag or `CRAFT_DEBUG=1`. Logs all Anthropic API requests/responses to file (not console).

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
