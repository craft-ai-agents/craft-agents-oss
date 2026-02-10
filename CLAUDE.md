# CLAUDE.md

Craft Agent is a Claude Code-like interface for managing Craft documents using the Claude Agent SDK and Craft MCP servers. The primary interface is the **Electron desktop app** with multi-session inbox management.

**Public OSS repo:** [github.com/lukilabs/craft-agents-oss](https://github.com/lukilabs/craft-agents-oss)

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

**Imports:**
```typescript
import { createAgent, ClaudeAgent, CodexAgent } from '@craft-agent/shared/agent'
import type { AgentBackend, BackendConfig } from '@craft-agent/shared/agent'
```

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

### Quick Release (Recommended)

```bash
# Bump version, commit, and push (triggers CI build)
bun run release patch                  # 0.2.24 → 0.2.25
bun run release minor                  # 0.2.24 → 0.3.0
bun run release major                  # 0.2.24 → 1.0.0

# With options
bun run release patch --tag --push     # Also create and push git tag
bun run release patch --oss            # Also sync to OSS repo
bun run release --oss-only             # Just sync existing version to OSS
```

### Tag-Based Release (Zero Commands)

Push a version tag to trigger the full release pipeline:

```bash
git tag v0.2.25 && git push --tags
# → Builds all platforms (macOS, Windows, Linux)
# → Uploads to S3
# → Syncs to OSS repository
# → Creates GitHub releases on both repos
```

### Manual Build

```bash
# Unified build script - Codex version is REQUIRED
bun run build --codex-version=craft-v0.1.0 --platform=darwin --arch=arm64
bun run build --codex-version=craft-v0.1.0 --platform=darwin --arch=x64
bun run build --codex-version=craft-v0.1.0 --platform=win32 --arch=x64
bun run build --codex-version=craft-v0.1.0 --platform=linux --arch=x64

# With upload
bun run build --codex-version=craft-v0.1.0 --platform=darwin --arch=arm64 --upload --latest
```

**Note:** `--codex-version` is mandatory. The build script downloads the Codex fork binary from GitHub releases, verifies the version, and bundles it with the app. See [Codex releases](https://github.com/lukilabs/craft-agents-codex/releases) for available versions.

### Via GitHub Actions

1. Go to Actions → "Release" → Run workflow
2. Configure platforms and options
3. Builds run in parallel, then upload and sync

**Supported platforms:**

| Platform | Architecture | Output | Runner |
|----------|--------------|--------|--------|
| macOS | arm64 | `.dmg` | `macos-14` |
| macOS | x64 | `.dmg` | `macos-15-intel` |
| Windows | x64 | `.exe` | `windows-2019` |
| Linux | x64 | `.AppImage` | `ubuntu-latest` |

### OSS Sync

Sync allowed files to the public OSS repo:

```bash
bun run oss:sync                       # Sync to OSS
bun run oss:sync --dry-run             # Preview changes
bun run oss:sync --force               # Skip contribution check
```

The OSS sync uses `scripts/oss-allow-list.txt` to control which files are public.

### Environment Variables

**Code Signing (macOS):**
- `APPLE_SIGNING_IDENTITY` - Code signing identity
- `APPLE_ID` - Apple ID for notarization
- `APPLE_TEAM_ID` - Apple Team ID
- `APPLE_APP_SPECIFIC_PASSWORD` - App-specific password

**OAuth Credentials (baked into build):**
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- `SLACK_OAUTH_CLIENT_ID` / `SLACK_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID`

**S3 Upload:**
- `S3_VERSIONS_BUCKET_ENDPOINT`
- `S3_VERSIONS_BUCKET_ACCESS_KEY_ID`
- `S3_VERSIONS_BUCKET_SECRET_ACCESS_KEY`

### S3 Structure

```
agents-craft-do/
├── electron/
│   ├── {version}/                    # Versioned releases
│   │   ├── Craft-Agent-arm64.dmg
│   │   ├── Craft-Agent-x64.dmg
│   │   ├── Craft-Agent-x64.exe
│   │   ├── Craft-Agent-x64.AppImage
│   │   └── manifest.json
│   ├── latest/                       # Always points to current version
│   │   ├── Craft-Agent-arm64.dmg     # ← Use for marketing site
│   │   ├── Craft-Agent-x64.dmg
│   │   ├── Craft-Agent-x64.exe
│   │   ├── Craft-Agent-x64.AppImage
│   │   └── manifest.json
│   └── latest                        # JSON: { "version": "X.Y.Z" }
├── install-app.sh
└── install-app.ps1
```

### Download URLs (for Marketing Site)

Use `/latest/` URLs for stable links that auto-update with each release:

| Platform | Stable URL |
|----------|------------|
| macOS (Apple Silicon) | `https://agents.craft.do/electron/latest/Craft-Agent-arm64.dmg` |
| macOS (Intel) | `https://agents.craft.do/electron/latest/Craft-Agent-x64.dmg` |
| Windows | `https://agents.craft.do/electron/latest/Craft-Agent-x64.exe` |
| Linux | `https://agents.craft.do/electron/latest/Craft-Agent-x64.AppImage` |

### Install Commands

```bash
# macOS / Linux
curl -fsSL https://agents.craft.do/install-app.sh | bash

# Windows (PowerShell)
irm https://agents.craft.do/install-app.ps1 | iex
```

### Version Management

**Source of truth:** `packages/shared/package.json` (all package.json files must have the same version)

```bash
bun run release patch         # Bump all package.json files + commit
bun run check-version         # Verify all package.json versions match
```

## Architecture

### Multi-Backend Agent System (`packages/shared/src/agent/`)

The agent layer supports **multiple AI backends** through an abstract base class pattern:

```
BaseAgent (abstract)           # Shared logic: permissions, sources, planning, config watching
    ├── ClaudeAgent            # Anthropic Claude via @anthropic-ai/claude-agent-sdk
    └── CodexAgent             # OpenAI Codex via app-server JSON-RPC over stdio
```

**Factory:** `createAgent(config)` returns the appropriate backend based on `config.provider`:
- `'anthropic'` → ClaudeAgent (default)
- `'openai'` → CodexAgent

### BaseAgent (`packages/shared/src/agent/base-agent.ts`)

Abstract base class providing shared functionality for all backends:

| Module | Location | Purpose |
|--------|----------|---------|
| `PermissionManager` | `agent/core/` | Permission evaluation, mode management, command whitelisting |
| `SourceManager` | `agent/core/` | Active/inactive source state tracking, context formatting |
| `PromptBuilder` | `agent/core/` | Context blocks for user messages (session state, sources) |
| `PathProcessor` | `agent/core/` | Path expansion (~) and normalization |
| `ConfigWatcherManager` | `agent/core/` | Hot-reload source/config changes |
| `UsageTracker` | `agent/core/` | Token usage and context window tracking |

### ClaudeAgent (`packages/shared/src/agent/claude-agent.ts`)

Anthropic Claude implementation wrapping `@anthropic-ai/claude-agent-sdk`:
- SDK's agentic loop handles tool calls, MCP communication
- `PreToolUse` hook for bash permission approval
- `PostToolUse` hook summarizes large results (>15k tokens) using `_intent` for context
- `formatSourceState()` injects `<sources>` context into user messages
- Session continuity via `resume` option

**Auth types:** `api_key` (Anthropic API key), `oauth_token` (Claude Max OAuth)

### CodexAgent (`packages/shared/src/agent/codex-agent.ts`)

OpenAI Codex implementation using the **app-server protocol**:
- Spawns `codex app-server` and communicates via JSON-RPC over stdio
- Pre-tool approval via `item/toolCall/preExecute` hook (requires Craft Agents fork)
- Thread persistence for session resume across restarts
- ChatGPT Plus OAuth authentication via `chatgptAuthTokens` mode

**Key methods:**
- `handleToolCallPreExecute()` - unified permission checking (same logic as ClaudeAgent)
- `injectChatGptTokens()` - inject OAuth tokens from UI flow
- `tryInjectStoredChatGptTokens()` - auto-inject stored credentials on startup
- Token refresh via `account/chatgptAuthTokens/refresh` server request

**Auth:** ChatGPT Plus OAuth. Tokens stored at `llm_oauth::codex` credential key.

**Craft Agents Codex Fork:**

We maintain a fork of OpenAI Codex with additional hooks for Craft Agent integration:
- **Repo:** [github.com/lukilabs/craft-agents-codex](https://github.com/lukilabs/craft-agents-codex)
- **Releases:** [github.com/lukilabs/craft-agents-codex/releases](https://github.com/lukilabs/craft-agents-codex/releases)

**Fork additions:**
- `item/toolCall/preExecute` - Pre-tool approval hook (intercept ALL tools before execution)
- Unified permission checking matching ClaudeAgent behavior
- Source blocking for inactive MCP sources with auto-activation support

**Binary bundling:** The Codex fork binary is bundled with the app during build. The build script:
1. Downloads the specified version from GitHub releases (`--codex-version=craft-vX.Y.Z`)
2. Verifies the downloaded binary reports the expected version
3. Bundles it at `vendor/codex/{platform}-{arch}/codex`

**Runtime resolution:** The binary resolver (`packages/shared/src/codex/binary-resolver.ts`) finds the Codex binary at runtime in this priority order:
1. `CODEX_PATH` environment variable (explicit override)
2. Bundled binary in app resources (`vendor/codex/{platform}-{arch}/codex`)
3. Local dev fork at `~/Documents/GitHub/craft-agents-codex/codex-rs/target/release/codex`
4. System `codex` command in PATH (fallback)

**Updating Codex version:**
1. Publish a new release on the fork: `git tag craft-vX.Y.Z && git push origin craft-vX.Y.Z`
2. Update the `--codex-version` in CI workflow (`.github/workflows/build-and-upload.yml`)
3. Run a new build

**Dev mode:** In development, the binary resolver automatically finds the local fork if you've built it at the expected path. No configuration needed.

**AgentEvent types:** `status`, `text_delta`, `text_complete`, `tool_start`, `tool_result`, `permission_request`, `error`, `complete`, `task_backgrounded`, `shell_backgrounded`, `task_progress`, `typed_error`, `source_activated`

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

### LLM Connections (`packages/shared/src/config/llm-connections.ts`)

Named provider configurations for AI backends. Sessions lock to a connection after first message.

**Connection types:**
| Type | Backend | Auth Types |
|------|---------|------------|
| `anthropic` | ClaudeAgent | `api_key`, `oauth` |
| `openai` | CodexAgent | `oauth` |
| `openai-compat` | (future) | `api_key`, `none` |

**Built-in connections:**
- `anthropic-api` - Anthropic API Key
- `claude-max` - Claude Max OAuth
- `codex` - Codex (ChatGPT Plus)

### Credential Storage (`packages/shared/src/credentials/`)

AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. Cross-platform, no OS prompts.

**Key format:** `{type}::{scope}`
```
anthropic_api_key::global             # Anthropic API key
claude_oauth::global                  # Claude Max OAuth
llm_oauth::codex                      # Codex (ChatGPT Plus) OAuth
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

**Env Var Isolation:** Stdio MCP subprocesses do NOT receive sensitive env vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, AWS/GitHub/OpenAI keys). To explicitly pass a var, use `config.env`.

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
| `'allow-all'` | Execute | Auto-approves all commands |

**In Explore mode blocked:** `api_*`, Bash, Write, Edit, MCP write tools

### Theme System (`packages/shared/src/config/theme.ts`)

App-level only. **6-color system:** background, foreground, accent, info, success, destructive. Preset themes at `~/.craft-agent/themes/`

## Key Patterns

**Streaming:** `agent.chat()` → `AsyncGenerator<AgentEvent>` → 50ms throttled updates

**Tool Permissions:** `PreToolUse` blocks dangerous bash by default. Dangerous commands (rm, sudo, git push) never auto-allow.

**Large Response Summarization:** >15k tokens auto-summarized via Haiku using `_intent` for context.

## Project Structure

### `packages/shared/src/`

| Directory | Purpose |
|-----------|---------|
| `agent/` | Multi-backend agent system (BaseAgent, ClaudeAgent, CodexAgent) |
| `agent/core/` | Shared modules: PermissionManager, SourceManager, PromptBuilder, etc. |
| `agent/backend/` | Backend-specific adapters (event adapters, factory) |
| `auth/` | oauth, craft-token, claude-token, google-oauth, chatgpt-oauth, state |
| `codex/` | Codex app-server client, binary resolver, config generator |
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
| AI (Anthropic) | @anthropic-ai/claude-agent-sdk |
| AI (OpenAI) | Codex app-server (JSON-RPC over stdio) |
| Credentials | AES-256-GCM encrypted file |
| Electron | Electron + React, shadcn/ui + Tailwind v4, esbuild + Vite |
