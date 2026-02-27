# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this package.

**Important:** Keep this file and the root `CLAUDE.md` up-to-date whenever functionality changes.

## Overview

`@craft-agent/shared` is the core business logic package for Craft Agent. It contains:
- Agent implementation (CraftAgent, session-scoped tools, permission modes)
- Authentication (OAuth, credentials, auth state)
- Configuration (storage, preferences, themes, watcher)
- MCP client and validation
- Headless execution mode
- Dynamic status system
- Session persistence

## Package Exports

This package uses subpath exports for clean imports:

```typescript
import { CraftAgent, getPermissionMode, setPermissionMode } from '@craft-agent/shared/agent';
import { loadStoredConfig, type Workspace } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { CraftMcpClient } from '@craft-agent/shared/mcp';
import { loadWorkspaceSources, type LoadedSource } from '@craft-agent/shared/sources';
import { loadStatusConfig, createStatus } from '@craft-agent/shared/statuses';
import { resolveTheme } from '@craft-agent/shared/config/theme';
import { debug } from '@craft-agent/shared/utils';
```

## Directory Structure

```
src/
├── agent/              # CraftAgent, session-scoped-tools, mode-manager, mode-types, permissions-config
├── auth/               # OAuth, craft-token, claude-token, state
├── config/             # Storage, preferences, models, theme, watcher
├── credentials/        # Secure credential storage (AES-256-GCM)
├── headless/           # Non-interactive execution mode
├── mcp/                # MCP client, connection validation, McpClientPool
├── prompts/            # System prompt generation
├── sessions/           # Session index, storage, persistence-queue
├── sources/            # Source types, storage, service
├── statuses/           # Dynamic status types, CRUD, storage
├── subscription/       # Craft subscription checking
├── utils/              # Debug logging, file handling, summarization
├── validation/         # URL validation
├── version/            # Version management, install scripts
├── workspaces/         # Workspace storage
├── branding.ts         # Branding constants
└── network-interceptor.ts    # Fetch interceptor for API errors and MCP schema injection
```

## Key Concepts

### CraftAgent (`src/agent/craft-agent.ts`)
The main agent class that wraps the Claude Agent SDK. Handles:
- MCP server connections
- Tool permissions via PreToolUse hook
- Large result summarization via PostToolUse hook
- Permission mode integration (safe/ask/allow-all)
- Session continuity

### Permission Modes (`src/agent/mode-manager.ts`, `mode-types.ts`)
Three-level permission system per session:

| Mode | Display Name | Behavior |
|------|--------------|----------|
| `'safe'` | Explore | Read-only, blocks write operations |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all commands |

- **Per-session state:** No global contamination between sessions
- **Keyboard shortcut:** SHIFT+TAB cycles through modes
- **UI config:** `PERMISSION_MODE_CONFIG` provides display names, colors, SVG icons

### Permissions Configuration (`src/agent/permissions-config.ts`)
Customizable safety rules at two levels (additive merging):
- Workspace: `~/.craft-agent/workspaces/{id}/permissions.json`
- Source: `~/.craft-agent/workspaces/{id}/sources/{slug}/permissions.json`

**Rule types:**
- `blockedTools` - Tools to block (extends defaults)
- `allowedBashPatterns` - Regex for read-only bash commands
- `allowedMcpPatterns` - Regex for allowed MCP tools
- `allowedApiEndpoints` - Fine-grained API rules `{ method, pathPattern }`
- `allowedWritePaths` - Glob patterns for writable directories

### Session-Scoped Tools (`src/agent/session-scoped-tools.ts`)
Tools available within agent sessions with callback registry:

**Source management:** `source_test`, `source_oauth_trigger`, `source_google_oauth_trigger`, `source_credential_prompt`

**Utilities:** `SubmitPlan`, `config_validate`

**Callbacks:** `onPlanSubmitted`, `onOAuthBrowserOpen`, `onOAuthSuccess`, `onOAuthError`, `onCredentialRequest`, `onSourcesChanged`, `onSourceActivated`

### Dynamic Status System (`src/statuses/`)
Workspace-level customizable workflow states:

**Storage:** `~/.craft-agent/workspaces/{id}/statuses/config.json`

**Status properties:** `id`, `label`, `color`, `icon`, `shortcut`, `category` (open/closed), `isFixed`, `isDefault`, `order`

**Default statuses:** Todo, In Progress, Needs Review, Done, Cancelled

**CRUD:** `createStatus()`, `updateStatus()`, `deleteStatus()`, `reorderStatuses()`

### Theme System (`src/config/theme.ts`)
Cascading theme configuration: app → workspace (last wins)

**Storage:**
- App: `~/.craft-agent/theme.json`
- Workspace: `~/.craft-agent/workspaces/{id}/theme.json`

**6-color system:** `background`, `foreground`, `accent`, `info`, `success`, `destructive`

**Functions:** `resolveTheme()`, `themeToCSS()`, dark mode support via `dark: { ... }` overrides

### Session Persistence (`src/sessions/`)
- **persistence-queue.ts:** Debounced async session writes (500ms)
- **storage.ts:** Session CRUD, portable path format
- **index.ts:** Session listing and metadata

### Credentials (`src/credentials/`)
All sensitive credentials (API keys, OAuth tokens) are stored in an AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. The `CredentialManager` provides the API for reading and writing credentials.

### MCP Source Architecture

All source connections (MCP and API) are managed through a single centralized pool:

**McpClientPool (centralized, main process)**
- `McpClientPool` (`src/mcp/mcp-pool.ts`) manages all source connections in the Electron main process
- MCP sources sync via `pool.sync(mcpServers)` — connects new sources, disconnects removed ones
- API sources sync via `pool.syncApiServers(apiServers)` — connects in-process `ApiSourcePoolClient` instances
- Both sync calls happen in `BaseAgent.setSourceServers()`, so all backends share the same pool logic
- Claude: proxy tools are created via `createSourceProxyServers(pool)` and added to SDK `Options.mcpServers`
- Pi: proxy tool definitions are sent to the subprocess via `registerPoolToolsWithSubprocess()`

### Bridge MCP Server Credential Flow

For Codex and Copilot sessions, API sources use the Bridge MCP Server which runs as a subprocess. Since it can't access the encrypted credentials directly, a **passive credential refresh** model is used:

```
┌─────────────────────────────────────────────────────────────────┐
│ Main Process (Electron)                                          │
│                                                                  │
│  1. User enables API source in session                          │
│  2. decrypt credential from credentials.enc                      │
│  3. write to .credential-cache.json (permissions: 0600)         │
│     └── ~/.craft-agent/workspaces/{ws}/sources/{slug}/          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ reads on each request
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Bridge MCP Server (subprocess)                                   │
│                                                                  │
│  1. On tool call, read fresh credential from cache file         │
│  2. Check expiresAt - if expired, return auth error             │
│  3. Inject auth header and make API request                     │
└─────────────────────────────────────────────────────────────────┘
```

**Key characteristics:**
- **Passive refresh:** Bridge reads cache on each request (no active polling)
- **Token expiry:** If OAuth token expires mid-session, requests fail with auth error
- **User action required:** To refresh expired tokens, user must re-authenticate in UI
- **Security:** Cache files have 0600 permissions (owner read/write only)

**Files involved:**
- Write: `apps/electron/src/main/sessions.ts` → `setupCodexSessionConfig()`
- Read: `packages/bridge-mcp-server/src/index.ts` → `readCredential()`

### Configuration (`src/config/storage.ts`)
Multi-workspace configuration stored in `~/.craft-agent/config.json`. Supports:
- Multiple workspaces with separate MCP servers and sessions
- Default permission mode for new sessions
- Extended cache TTL preference
- Token display mode

### Config Watcher (`src/config/watcher.ts`)
File watcher for live config updates:
- Watches `config.json`, `theme.json`, `permissions.json` at all levels
- Callbacks: `onConfigChange`, `onThemeChange`, `onWorkspacePermissionsChange`, `onSourcePermissionsChange`

### Sources (`src/sources/`)
Sources are external data connections (MCP servers, APIs, local filesystems). Stored at `~/.craft-agent/workspaces/{id}/sources/{slug}/` with config.json and guide.md. Types: `mcp`, `api`, `local`, `gmail`.

## Dependencies

- `@craft-agent/core` - Shared types
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK

## Type Checking

```bash
# From monorepo root
cd packages/shared && bun run tsc --noEmit
```
