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
- Subagent system
- Dynamic status system
- Session persistence

## Package Exports

This package uses subpath exports for clean imports:

```typescript
import { CraftAgent, getPermissionMode, setPermissionMode } from '@craft-agent/shared/agent';
import { loadStoredConfig, type Workspace } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { SubAgentManager } from '@craft-agent/shared/agents';
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
├── agents/             # Agent management, extraction, cache, builtin-agents
├── auth/               # OAuth, balance, craft-token, claude-token, state
├── clients/            # External API clients (Craft API)
├── config/             # Storage, preferences, models, theme, watcher
├── credentials/        # Secure credential storage (AES-256-GCM)
├── headless/           # Non-interactive execution mode
├── mcp/                # MCP client and connection validation
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
└── cache-ttl-interceptor.ts  # Extended prompt cache TTL
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
Customizable safety rules at three levels (additive merging):
- Workspace: `~/.craft-agent/workspaces/{id}/permissions.json`
- Source: `~/.craft-agent/workspaces/{id}/sources/{slug}/permissions.json`
- Agent: `~/.craft-agent/workspaces/{id}/agents/{slug}/permissions.json`

**Rule types:**
- `blockedTools` - Tools to block (extends defaults)
- `allowedBashPatterns` - Regex for read-only bash commands
- `allowedMcpPatterns` - Regex for allowed MCP tools
- `allowedApiEndpoints` - Fine-grained API rules `{ method, pathPattern }`
- `allowedWritePaths` - Glob patterns for writable directories

### Session-Scoped Tools (`src/agent/session-scoped-tools.ts`)
Tools available within agent sessions with callback registry:

**Source management:** `source_test`, `source_oauth_trigger`, `source_gmail_oauth_trigger`, `source_credential_prompt`

**Agent management:** `agent_list`, `agent_create`, `agent_delete`

**Utilities:** `SubmitPlan`, `config_validate`

**Callbacks:** `onPlanSubmitted`, `onOAuthBrowserOpen`, `onOAuthSuccess`, `onOAuthError`, `onCredentialRequest`, `onSourcesChanged`, `onSourceActivated`, `onAgentsChanged`

### Dynamic Status System (`src/statuses/`)
Workspace-level customizable workflow states:

**Storage:** `~/.craft-agent/workspaces/{id}/statuses/config.json`

**Status properties:** `id`, `label`, `color`, `icon`, `shortcut`, `category` (open/closed), `isFixed`, `isDefault`, `order`

**Default statuses:** Todo, In Progress, Needs Review, Done, Cancelled

**CRUD:** `createStatus()`, `updateStatus()`, `deleteStatus()`, `reorderStatuses()`

### Theme System (`src/config/theme.ts`)
Cascading theme configuration: app → workspace → agent (last wins)

**Storage:**
- App: `~/.craft-agent/theme.json`
- Workspace: `~/.craft-agent/workspaces/{id}/theme.json`
- Agent: `~/.craft-agent/workspaces/{id}/agents/{slug}/theme.json`

**6-color system:** `background`, `foreground`, `accent`, `info`, `success`, `destructive`

**Functions:** `resolveTheme()`, `themeToCSS()`, dark mode support via `dark: { ... }` overrides

### Session Persistence (`src/sessions/`)
- **persistence-queue.ts:** Debounced async session writes (500ms)
- **storage.ts:** Session CRUD, portable path format
- **index.ts:** Session listing and metadata

### Credentials (`src/credentials/`)
All sensitive credentials (API keys, OAuth tokens) are stored in an AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. The `CredentialManager` provides the API for reading and writing credentials.

### Configuration (`src/config/storage.ts`)
Multi-workspace configuration stored in `~/.craft-agent/config.json`. Supports:
- Multiple workspaces with separate MCP servers and sessions
- Default permission mode for new sessions
- Extended cache TTL preference
- Token display mode

### Config Watcher (`src/config/watcher.ts`)
File watcher for live config updates:
- Watches `config.json`, `theme.json`, `permissions.json` at all levels
- Callbacks: `onConfigChange`, `onThemeChange`, `onWorkspacePermissionsChange`, `onSourcePermissionsChange`, `onAgentPermissionsChange`

### Agents (`src/agents/`)
Agents are specialized configurations that extend the base agent with custom instructions, MCP servers, and REST APIs. Stored as folders at `~/.craft-agent/workspaces/{id}/agents/{slug}/`.

### Sources (`src/sources/`)
Sources are external data connections (MCP servers, APIs, local filesystems). Stored at `~/.craft-agent/workspaces/{id}/sources/{slug}/` with config.json and guide.md. Types: `mcp`, `api`, `local`, `gmail`.

**Agent scoping:** Sources can be workspace-scoped or agent-scoped (stored in `agents/{slug}/sources/`)

## Dependencies

- `@craft-agent/core` - Shared types
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK

## Type Checking

```bash
# From monorepo root
cd packages/shared && bun run tsc --noEmit
```
