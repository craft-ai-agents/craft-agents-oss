# AGENTS.md - Vesper Agent Architecture

This document provides a technical overview of Vesper's agent system architecture. For project setup and usage, see [README.md](README.md) and [CLAUDE.md](CLAUDE.md).

## Introduction

Vesper's agent system is built on the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with significant enhancements for production agentic workflows. The core design philosophy centers on **session-based isolation**, **granular permission control**, and **extensibility through MCP**.

Key architectural decisions:
- **Session-first design** - Each conversation is isolated with its own permission state and tool context
- **Mode-based security** - Three permission modes (`safe`, `ask`, `allow-all`) control tool execution
- **Hook-based customization** - PreToolUse and PostToolUse hooks enable permission validation and response summarization
- **Intent preservation** - Large tool responses are summarized while preserving user intent via injected `_intent` field

## VesperAgent Architecture

### Class Overview

**VesperAgent** (`packages/shared/src/agent/vesper-agent.ts`) wraps the Claude Agent SDK's `query()` function and provides:
- MCP server connection management
- Session state persistence
- Permission mode integration
- Large response summarization
- Tool permission hooks

### Session-Based Isolation

Every VesperAgent instance is bound to a **session** - the primary isolation boundary in Vesper:

```typescript
interface VesperAgentConfig {
  workspace: Workspace;           // Workspace containing MCP servers and config
  session?: Session;              // Current session (1:1 with SDK session)
  mcpToken?: string;              // Override token for testing
  model?: string;                 // Model ID (defaults to DEFAULT_MODEL)
  thinkingLevel?: ThinkingLevel;  // Extended thinking budget
  onSdkSessionIdUpdate?: (id: string) => void;
  getRecoveryMessages?: () => RecoveryMessage[];
}
```

Sessions provide:
- **Isolated permission mode** - Each session has its own `safe`/`ask`/`allow-all` state
- **Conversation continuity** - Full message history persisted to `~/.vesper/workspaces/{id}/sessions/{sessionId}.jsonl`
- **Tool context** - Session-scoped tools (plan submission, OAuth, credential prompts)
- **SDK session mapping** - Seamless resume via Claude Agent SDK's session persistence

### Tool Management

VesperAgent provides three categories of tools:

#### 1. Base Tools
Always available regardless of session state:
- `update_user_preferences` - Store user preferences (name, timezone, location, notes)

#### 2. Session-Scoped Tools
Provided per session via `getSessionScopedTools()` (`packages/shared/src/agent/session-scoped-tools.ts`):
- `SubmitPlan` - Submit structured plans for user review
- `source_test` - Test MCP server connection
- `source_oauth_trigger` - Trigger OAuth flow for MCP sources
- `source_google_oauth_trigger` - Google-specific OAuth
- `source_credential_prompt` - Request credentials from user

#### 3. MCP Tools
Loaded from workspace sources (`~/.vesper/workspaces/{id}/sources/`):
- Dynamically discovered via MCP server connections
- Prefixed with `mcp__<sourceSlug>__` for scoping
- Subject to permission mode filtering

## Permission System

### Three Permission Modes

Vesper implements a three-level permission system managed by `ModeManager` (`packages/shared/src/agent/mode-manager.ts`):

| Mode | Display Name | Behavior | Use Case |
|------|--------------|----------|----------|
| `safe` | **Explore** | Read-only, blocks write operations | Exploration and research |
| `ask` | **Ask to Edit** | Prompts for write operations | Default interactive mode |
| `allow-all` | **Auto** | Auto-approves all operations | Executing approved plans |

There's also a fourth mode `ralph` (Ralph Loop) used for autonomous workflows.

### Mode Cycling (SHIFT+TAB)

Users cycle through modes via keyboard shortcut:

```typescript
cyclePermissionMode(sessionId: string, enabledModes?: PermissionMode[]): PermissionMode
```

This updates the session's permission mode and broadcasts to UI subscribers.

### Per-Session State

**Critical design principle**: Permission modes are **per-session**, NOT global.

```typescript
// Mode state is stored per session ID
interface ModeState {
  sessionId: string;
  permissionMode: PermissionMode;
  onStateChange?: (state: ModeState) => void;
}
```

This ensures:
- No cross-session contamination
- Independent workflows in different tabs/windows
- Predictable behavior when switching sessions

### Permission Rules

Permission enforcement is centralized in `shouldAllowToolInMode()`:

**Safe Mode (`safe`)** blocks:
- File writes (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`) - except plans folder
- Bash commands not matching read-only patterns
- MCP write operations (create, update, delete)
- API mutations (POST, PUT, DELETE)

**Safe Mode allows**:
- File reads (`Read`, `Glob`, `Grep`)
- Read-only bash commands (ls, git status, grep, etc.)
- MCP read operations (search, list, get)
- API GET requests
- **Plans folder exception** - Write/Edit allowed to session plans directory

**Ask Mode (`ask`)** allows:
- All operations, but prompts for dangerous commands
- Read-only bash commands run without prompting
- "Always allow" option for non-dangerous commands

**Auto Mode (`allow-all`)** allows:
- Everything without prompts

## Tool Hooks

VesperAgent uses SDK hooks to intercept tool execution:

### PreToolUse Hook

Validates tool permissions before execution:

```typescript
preToolUse: async (params) => {
  const { toolName, toolInput } = params;
  const mode = getPermissionMode(sessionId);

  // Check if tool is allowed in current mode
  const result = shouldAllowToolInMode(toolName, toolInput, mode, {
    plansFolderPath: getSessionPlansPath(workspaceRootPath, sessionId),
    permissionsContext: { workspaceRootPath, activeSourceSlugs }
  });

  if (!result.allowed) {
    return blockWithReason(result.reason);
  }

  // In ask mode, prompt for bash commands
  if (mode === 'ask' && toolName === 'Bash') {
    const allowed = await requestBashPermission(command);
    if (!allowed) {
      return blockWithReason('User denied permission');
    }
  }

  return { continue: true };
}
```

This hook:
1. Checks permission mode
2. Validates tool against mode rules
3. Requests user permission in ask mode
4. Blocks or allows execution

### PostToolUse Hook

Summarizes large tool responses to prevent context overflow:

```typescript
postToolUse: async (params) => {
  const { result } = params;
  const tokens = estimateTokens(JSON.stringify(result));

  if (tokens > TOKEN_LIMIT) {
    const intent = extractIntentFromContext();
    const summarized = await summarizeLargeResult(result, intent);
    return { result: summarized };
  }

  return { result };
}
```

Large responses (>60KB) are summarized using Claude Haiku while preserving user intent.

### Intent Field Injection

To preserve summarization context, VesperAgent injects an `_intent` field into MCP tool schemas:

```typescript
_intent: z.string().optional().describe(
  "The user's current goal or question. Include this to help the MCP server provide relevant responses."
)
```

This allows:
- Intent-aware summarization (focus on what matters)
- Better MCP server responses
- Reduced token usage while preserving utility

## MCP Integration

### Server Connection Patterns

MCP servers are loaded from workspace sources (`packages/shared/src/sources/`):

```typescript
interface LoadedSource {
  slug: string;              // Source identifier
  name: string;              // Display name
  type: 'mcp' | 'api' | 'local';
  mcpConfig?: {              // For MCP sources
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  status: 'active' | 'inactive';
}
```

Connection lifecycle:
1. Load source configs from `~/.vesper/workspaces/{id}/sources/{slug}/config.json`
2. Spawn MCP server processes (stdio transport)
3. Connect via SDK's `createSdkMcpServer()`
4. Prefix tools with `mcp__<slug>__` for scoping
5. Filter environment variables for security (blocks `ANTHROPIC_API_KEY`, `AWS_*`, etc.)

### Tool Schema Handling

MCP tools are exposed through the SDK with modifications:

```typescript
// Original MCP tool: "search_linear"
// Exposed as: "mcp__linear__search_linear"

// Schema augmented with _intent field
{
  _intent: "User's current goal",
  query: "Search query",
  // ... other parameters
}
```

Tool scoping prevents naming conflicts and enables per-source permissions.

### Large Response Summarization

When an MCP tool returns >60KB:
1. Extract user intent from recent messages
2. Pass to `summarizeLargeResult()` which calls Claude Haiku
3. Replace response with summary focusing on intent
4. Include "summarized by AI" marker

This prevents context overflow while keeping responses actionable.

## State Management

### Jotai Atoms (Renderer)

Local UI state in `apps/electron/src/renderer/atoms/`:
- `scheduler.ts` - Scheduled job state
- `vector-search.ts` - Search UI state
- `command-palette.ts` - Command palette state

Atoms provide:
- Reactive UI updates
- Minimal re-renders
- Simple state derivation

### Context Providers (Renderer)

Global state in `apps/electron/src/renderer/contexts/`:
- `NavigationContext` - Current route and navigation
- `SessionContext` - Active session and workspace

Contexts provide:
- Cross-component state sharing
- Event subscription
- Action dispatchers

### IPC Event Communication

Main/renderer communication via Electron IPC (`apps/electron/src/main/ipc.ts`):

**Main → Renderer broadcasts:**
- `mode-changed` - Permission mode updated
- `session-updated` - Session state changed
- `source-activated` - MCP source connected

**Renderer → Main requests:**
- `session:get-mode` - Get permission mode
- `session:set-mode` - Set permission mode
- `session:cycle-mode` - Cycle permission mode

IPC ensures:
- Main process as source of truth
- Consistent state across windows
- Event-driven UI updates

## Key Implementation Files

### Agent Core
- **`packages/shared/src/agent/vesper-agent.ts`** (1,400+ lines)
  - Main VesperAgent class
  - SDK wrapper and configuration
  - Hook implementations
  - MCP server lifecycle

- **`packages/shared/src/agent/mode-manager.ts`** (1,640 lines)
  - Permission mode state management
  - Tool blocking logic
  - Bash command validation
  - Session state formatting

- **`packages/shared/src/agent/permissions-config.ts`** (689 lines)
  - Customizable permission rules
  - JSON schema validation
  - Config caching and merging
  - Workspace/source-level overrides

- **`packages/shared/src/agent/session-scoped-tools.ts`**
  - Plan submission tool
  - OAuth trigger tools
  - Credential prompt tool
  - Callback registry

### Permission System
- **`packages/shared/src/agent/mode-types.ts`**
  - Permission mode types
  - Mode configuration (display names, colors, icons)
  - Compiled pattern types

- **`packages/shared/src/agent/bash-validator.ts`**
  - AST-based bash validation
  - Compound command parsing
  - Security checks (injection, substitution, redirects)

### Supporting Infrastructure
- **`packages/shared/src/sessions/storage.ts`**
  - Session persistence (JSONL format)
  - Portable path format
  - Session CRUD operations

- **`packages/shared/src/sources/storage.ts`**
  - Source configuration storage
  - MCP server config
  - Source CRUD operations

- **`packages/shared/src/utils/summarize.ts`**
  - Large response summarization
  - Token estimation
  - Intent extraction

- **`packages/shared/src/config/watcher.ts`**
  - File watcher for live config updates
  - Permission config invalidation
  - Theme/config change callbacks

### Main Process Integration
- **`apps/electron/src/main/sessions.ts`**
  - Session lifecycle management
  - IPC handlers for session operations
  - Mode state synchronization

- **`apps/electron/src/main/ipc.ts`**
  - Central IPC handler registration
  - Request/response routing
  - Event broadcasting

### Renderer Components
- **`apps/electron/src/renderer/components/chat/ChatDisplay.tsx`**
  - Message rendering
  - Tool execution visualization
  - Permission prompt UI

- **`apps/electron/src/renderer/components/app-shell/input/PermissionModeBadge.tsx`**
  - Mode indicator badge
  - Mode cycling UI
  - Color-coded states

## Testing

Permission system tests:
```bash
cd packages/shared
bun test src/agent/__tests__/
```

Tests cover:
- Permission mode state isolation
- Bash command validation
- Tool blocking logic
- Config merging

## Debugging

Enable debug logging:
```bash
# Development mode (auto-enabled)
bun run electron:dev

# Check logs
tail -f ~/Library/Logs/Vesper/main.log
tail -f ~/Library/Logs/Vesper/renderer.log
```

Debug output includes:
- `[Mode]` - Permission mode operations
- `[Permissions]` - Config loading and validation
- `[Agent]` - SDK interactions
- `[MCP]` - MCP server lifecycle

## Extending the Agent System

### Adding a New Permission Mode

1. Update `PERMISSION_MODE_ORDER` in `packages/shared/src/agent/mode-types.ts`
2. Add mode config to `PERMISSION_MODE_CONFIG`
3. Update `shouldAllowToolInMode()` logic in `mode-manager.ts`
4. Add UI badge variant in `PermissionModeBadge.tsx`

### Adding a Session-Scoped Tool

1. Create tool in `packages/shared/src/agent/session-scoped-tools.ts`:
```typescript
export function createMyTool(sessionId: string) {
  return tool('my_tool', 'Description', schema, async (args) => {
    // Implementation
  });
}
```

2. Add to `getSessionScopedTools()` return array
3. Register callback in `SessionScopedToolCallbacks` if needed

### Customizing Permissions

Create `permissions.json` files for fine-grained control:

**Workspace-level** (`~/.vesper/workspaces/{id}/permissions.json`):
```json
{
  "allowedBashPatterns": [
    { "pattern": "^docker\\s+ps", "comment": "List Docker containers" }
  ],
  "allowedMcpPatterns": [".*_list$"],
  "allowedApiEndpoints": [
    { "method": "POST", "path": "/api/v1/comments" }
  ],
  "allowedWritePaths": ["~/projects/**"]
}
```

**Source-level** (`~/.vesper/workspaces/{id}/sources/{slug}/permissions.json`):
- MCP patterns auto-scoped to source
- Extends workspace permissions additively

See `~/.vesper/docs/permissions.md` for full schema and examples.

## Security Considerations

### Environment Variable Filtering

MCP servers spawned via stdio transport have sensitive env vars filtered:
- `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`
- `AWS_*`, `GITHUB_TOKEN`, `OPENAI_API_KEY`
- Use source config `env` field to explicitly pass variables

### Bash Command Validation

AST-based validation prevents:
- Command injection (`&&`, `||`, `;`, `|`)
- File redirection (`>`, `>>`)
- Command substitution (`$()`, backticks)
- Process substitution (`<()`, `>()`)
- Control character injection (newlines, null bytes)

### Permission Escalation

Permission mode is **per-session** to prevent:
- Cross-session permission leakage
- Unintended escalation when switching sessions
- Ambient authority issues

## Performance

### Config Caching

`PermissionsConfigCache` caches:
- Workspace permissions
- Source permissions
- Merged permission configs

Cache invalidation via `ConfigWatcher` on file changes.

### Token Budget Management

Large responses (>60KB) are summarized to prevent:
- Context window overflow
- Slow API responses
- High token costs

Summary preserves intent using the `_intent` field.

---

**See Also:**
- [CLAUDE.md](CLAUDE.md) - Project guide for Claude Code
- [README.md](README.md) - Installation and quick start
- [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md) - Shared package internals
- `~/.vesper/docs/permissions.md` - Permission system documentation
