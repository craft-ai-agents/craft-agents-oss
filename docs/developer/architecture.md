# Vesper Architecture Overview

This document provides a comprehensive overview of Vesper's system architecture, design patterns, and core components.

## Table of Contents

- [High-Level Architecture](#high-level-architecture)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Multi-Process Architecture](#multi-process-architecture)
- [Key Design Patterns](#key-design-patterns)
- [Security Architecture](#security-architecture)

## High-Level Architecture

Vesper is built as an Electron desktop application with a clear separation between business logic and UI. The architecture follows a modular, layered approach:

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron App                             │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────┐ │
│  │  Main Process  │  │    Preload     │  │   Renderer    │ │
│  │   (Node.js)    │◄─┤  (Bridge)      │◄─┤   (React)     │ │
│  │                │  │                │  │               │ │
│  │  - IPC         │  │  - Context     │  │  - UI         │ │
│  │  - Sessions    │  │  - Exposed     │  │  - State      │ │
│  │  - Scheduler   │  │    APIs        │  │  - Components │ │
│  │  - File I/O    │  │                │  │               │ │
│  └────────────────┘  └────────────────┘  └───────────────┘ │
│         │                                        │          │
└─────────┼────────────────────────────────────────┼──────────┘
          │                                        │
          ▼                                        ▼
  ┌───────────────┐                      ┌─────────────────┐
  │  @vesper/     │                      │   @vesper/ui    │
  │  shared       │                      │                 │
  │               │                      │  - Chat         │
  │  - Agent      │                      │  - Markdown     │
  │  - Auth       │                      │  - UI Kit       │
  │  - Config     │                      └─────────────────┘
  │  - Sessions   │
  │  - Sources    │
  │  - MCP        │
  └───────────────┘
          │
          ▼
  ┌───────────────────────────────┐
  │  Claude Agent SDK             │
  │  @anthropic-ai/claude-agent-sdk│
  └───────────────────────────────┘
```

### Package Structure

```
vesper/
├── apps/
│   ├── electron/              # Main desktop application
│   │   └── src/
│   │       ├── main/          # Electron main process (Node.js)
│   │       ├── preload/       # Context bridge (secure IPC)
│   │       ├── renderer/      # React UI (browser environment)
│   │       └── shared/        # Shared types between processes
│   └── viewer/                # Session viewer web app
└── packages/
    ├── core/                  # Shared TypeScript types
    ├── shared/                # Core business logic
    └── ui/                    # Shared React components
```

## Core Components

### 1. VesperAgent (`packages/shared/src/agent/`)

The central agent implementation that wraps the Claude Agent SDK with Vesper-specific functionality.

**Key Features:**
- MCP server connection management
- Tool permission enforcement via hooks
- Large response summarization
- Session continuity
- Task list integration for multi-agent coordination

**Core Files:**
- `vesper-agent.ts` - Main agent class
- `mode-manager.ts` - Permission mode system
- `session-scoped-tools.ts` - Tools available within sessions
- `permissions-config.ts` - Customizable safety rules
- `options.ts` - SDK configuration builder

```typescript
// Example: Creating a VesperAgent instance
const agent = new VesperAgent({
  workspace,
  session,
  claudeApiKey,
  onEvent: async (event) => {
    // Handle agent events
  }
});

// Set permission mode
agent.setPermissionMode('ask');

// Set task list for multi-agent coordination
agent.setTaskListId('task-list-123');

// Chat with the agent
for await (const event of agent.chat('Hello!')) {
  // Process streaming events
}
```

### 2. Session Management (`packages/shared/src/sessions/`)

Handles session persistence, indexing, and lifecycle management.

**Architecture:**
- **JSONL storage** - One file per session, append-only log format
- **Debounced writes** - 500ms batching to reduce I/O
- **Session index** - Fast listing without reading full sessions
- **Portable paths** - Cross-platform path resolution

**Core Files:**
- `storage.ts` - Session CRUD operations
- `persistence-queue.ts` - Debounced async writes
- `index.ts` - Session listing and metadata

**Storage Format:**
```
~/.vesper/workspaces/{workspaceId}/sessions/
├── {sessionId}.jsonl          # Full conversation history
└── _index.json                # Session metadata index
```

### 3. Configuration System (`packages/shared/src/config/`)

Cascading configuration with file watching and hot reloading.

**Hierarchy:**
```
App Config         (~/.vesper/config.json)
  ↓
Workspace Config   (~/.vesper/workspaces/{id}/config.json)
  ↓
Source Config      (~/.vesper/workspaces/{id}/sources/{slug}/config.json)
```

**Core Files:**
- `storage.ts` - Multi-workspace config management
- `watcher.ts` - File system watcher for live updates
- `theme.ts` - Theme system with dark mode support
- `preferences.ts` - User preferences

### 4. Credential Management (`packages/shared/src/credentials/`)

Secure storage for API keys, OAuth tokens, and sensitive data.

**Security:**
- AES-256-GCM encryption
- Encrypted file at `~/.vesper/credentials.enc`
- Per-credential type organization
- Safe deletion with overwrite

**Core Files:**
- `credential-manager.ts` - Main API
- `encryption.ts` - AES-256-GCM implementation

```typescript
const manager = getCredentialManager();

// Store credential
await manager.setCredential('anthropic_api_key', 'sk-ant-...');

// Retrieve credential
const apiKey = await manager.getCredential('anthropic_api_key');

// List by type
const profiles = await manager.getCredentialsByType('claude_profile');
```

### 5. MCP Integration (`packages/shared/src/mcp/`)

Model Context Protocol client for connecting to external data sources.

**Features:**
- Multiple transport support (stdio, SSE)
- Connection validation
- Schema injection for summarization
- Server lifecycle management

**Core Files:**
- `vesper-mcp-client.ts` - MCP client wrapper
- `validation.ts` - Connection validation

### 6. Permission System (`packages/shared/src/agent/mode-manager.ts`)

Three-level permission system with per-session isolation.

```typescript
// Permission modes
type PermissionMode = 'safe' | 'ask' | 'allow-all';

// Mode configuration
const PERMISSION_MODE_CONFIG = {
  safe: {
    label: 'Explore',
    color: 'green',
    description: 'Read-only, blocks write operations'
  },
  ask: {
    label: 'Ask to Edit',
    color: 'yellow',
    description: 'Prompts for approval (default)'
  },
  'allow-all': {
    label: 'Auto',
    color: 'red',
    description: 'Auto-approves all commands'
  }
};
```

**Permission Rules:**
- `blockedTools` - Tools to block entirely
- `allowedBashPatterns` - Regex for read-only bash commands
- `allowedMcpPatterns` - Regex for allowed MCP tools
- `allowedApiEndpoints` - Fine-grained API rules
- `allowedWritePaths` - Glob patterns for writable directories

### 7. Task Lists System (`packages/shared/src/task-lists/`)

Structured task management with dependencies and ownership tracking for multi-agent coordination.

**Features:**
- File-based storage with concurrent-safe operations
- Task dependencies (blocks/blockedBy)
- Status workflow (pending → in_progress → completed)
- Ralph Loop integration
- Session template support

**Core Files:**
- `storage.ts` - CRUD with file locking
- `types.ts` - Task list and task types

```typescript
// Create task list
const taskList = await createTaskList('Feature Implementation', 'Build new feature');

// Create task
const task = await createTask(taskList.id, 'Fix bug', 'Fix authentication bug', 'Fixing bug');

// Update task status
await updateTask(taskList.id, task.id, { status: 'in_progress' });

// Batch create tasks
await batchCreateTasks(taskList.id, [
  { subject: 'Task 1', description: 'Description 1' },
  { subject: 'Task 2', description: 'Description 2', blockedBy: ['task-1'] }
]);
```

### 8. Ralph Loop (`packages/shared/src/ralph-loop/`)

Autonomous coding workflow system with PRD parsing and multi-task execution.

**Features:**
- PRD-to-tasks conversion (checkbox stories)
- Autonomous PR creation
- Task status synchronization
- Branch management

**Core Files:**
- `loop-runner.ts` - Main execution loop
- `prd-parser.ts` - PRD parsing logic
- `types.ts` - Ralph Loop types

### 9. Messaging Integrations

#### Slack (`packages/shared/src/slack/`)
- Socket Mode integration
- Message routing with session continuity
- Permission directives (`/ask`, `/allow-all`, `/safe`)
- Message formatting (mrkdwn, chunking)

#### Telegram (`packages/shared/src/telegram/`)
- In-process polling
- Per-chat rate limiting (token bucket)
- Message queue for API limits
- Large result handling with deep links

#### WhatsApp (`packages/shared/src/whatsapp/`)
- Baileys library integration
- QR code authentication
- Message queue and debouncing
- Result formatting

## Data Flow

### User Message Flow

```
User Input (Renderer)
  │
  ├─► IPC Call (session:chat)
  │     │
  │     ▼
  │   Main Process
  │     │
  │     ├─► Load Session
  │     ├─► Create VesperAgent
  │     ├─► agent.chat(message)
  │     │     │
  │     │     ▼
  │     │   Claude Agent SDK
  │     │     │
  │     │     ├─► MCP Tool Calls
  │     │     ├─► Bash Commands
  │     │     └─► API Calls
  │     │           │
  │     │           ▼
  │     │     PreToolUse Hook (Permission Check)
  │     │           │
  │     │           ▼
  │     │     Execute Tool
  │     │           │
  │     │           ▼
  │     │     PostToolUse Hook (Summarization)
  │     │           │
  │     │           ▼
  │     ├─► Stream Events ──► Broadcast IPC
  │     │                        │
  │     └─► Save Session         ▼
  │                         Renderer Updates UI
  │                              │
  └──────────────────────────────┘
```

### Session Persistence Flow

```
Agent Event
  │
  ▼
Event Processor (Renderer)
  │
  ├─► Update In-Memory State
  │
  ├─► IPC Call (session:update)
  │     │
  │     ▼
  │   Main Process
  │     │
  │     ▼
  │   Persistence Queue (500ms debounce)
  │     │
  │     ▼
  │   Write to JSONL File
  │
  └─► Broadcast Update Event
        │
        ▼
      All Renderer Windows Update
```

### Configuration Watcher Flow

```
File System Change
  │
  ▼
Config Watcher (Main)
  │
  ├─► Detect Change Type
  │     │
  │     ├─► config.json
  │     ├─► theme.json
  │     ├─► permissions.json
  │     └─► sources/*.json
  │
  ├─► Load New Config
  │
  └─► Broadcast IPC Event
        │
        ▼
      Renderer Reacts to Change
        │
        ├─► Update UI
        ├─► Reconnect Sources
        └─► Apply New Theme
```

## Multi-Process Architecture

### Electron Process Model

```
Main Process (Node.js)
  │
  ├─► File System Access
  ├─► Native Modules
  ├─► IPC Handlers
  ├─► Session Management
  ├─► Scheduler (Cron)
  └─► MCP Server Spawning

Preload Script (Context Bridge)
  │
  └─► Expose Safe APIs to Renderer

Renderer Process (Chromium)
  │
  ├─► React UI
  ├─► Jotai State Management
  ├─► Event Processing
  └─► IPC Calls to Main
```

### IPC Communication Patterns

#### Request-Response Pattern
```typescript
// Renderer
const result = await window.electron.invoke('session:get', sessionId);

// Main (IPC Handler)
ipcMain.handle('session:get', async (_, sessionId) => {
  return await loadSession(sessionId);
});
```

#### Event Broadcasting Pattern
```typescript
// Main
BrowserWindow.getAllWindows().forEach(win => {
  win.webContents.send('session:updated', sessionData);
});

// Renderer
window.electron.on('session:updated', (sessionData) => {
  updateUIState(sessionData);
});
```

#### Stream Pattern
```typescript
// Main (for agent streaming)
const generator = agent.chat(message);
for await (const event of generator) {
  win.webContents.send('session:event', event);
}
```

## Key Design Patterns

### 1. Session-Based Isolation

Every session has isolated state:
- Separate VesperAgent instance
- Isolated permission mode
- Independent task list ID
- Isolated working directory

This prevents cross-contamination between concurrent sessions.

### 2. Debounced Persistence

High-frequency updates (agent events) are batched:
```typescript
class PersistenceQueue {
  private queue = new Map<string, Session>();
  private timer: NodeJS.Timeout | null = null;

  enqueue(session: Session) {
    this.queue.set(session.id, session);

    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      this.flush();
    }, 500); // 500ms debounce
  }

  async flush() {
    for (const [id, session] of this.queue) {
      await writeSession(session);
    }
    this.queue.clear();
  }
}
```

### 3. Hook-Based Extension

VesperAgent uses SDK hooks for cross-cutting concerns:
- **PreToolUse** - Permission enforcement
- **PostToolUse** - Response summarization
- **OnAbort** - Cleanup logic

### 4. Atomic State Management

UI state uses Jotai atoms for granular reactivity:
```typescript
// Command palette atom
export const commandPaletteAtom = atom({
  isOpen: false,
  query: '',
  results: []
});

// Vector search atom
export const vectorSearchAtom = atom({
  isOpen: false,
  collections: [],
  results: []
});
```

### 5. File-Based Locking

Concurrent-safe operations use proper-lockfile:
```typescript
import * as lockfile from 'proper-lockfile';

async function updateTaskList(id: string, updates: TaskList) {
  const filePath = getTaskListPath(id);

  // Acquire lock
  const release = await lockfile.lock(filePath, {
    retries: 10,
    stale: 10000
  });

  try {
    // Critical section
    const current = await readTaskList(id);
    const updated = { ...current, ...updates };
    await writeTaskList(updated);
  } finally {
    // Release lock
    await release();
  }
}
```

## Security Architecture

### 1. Credential Encryption

```
User Credential
  │
  ▼
AES-256-GCM Encryption
  │
  ├─► Encryption Key (derived from machine ID)
  ├─► Initialization Vector (random, 12 bytes)
  └─► Authentication Tag (16 bytes)
  │
  ▼
Encrypted File (~/.vesper/credentials.enc)
```

### 2. IPC Security

- **Context Isolation** - Renderer has no direct Node.js access
- **Preload Whitelist** - Only exposed APIs are callable
- **Input Validation** - All IPC inputs validated
- **No eval()** - No dynamic code execution

### 3. MCP Server Isolation

Environment variable filtering prevents credential leakage:
```typescript
const BLOCKED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GITHUB_TOKEN',
  'OPENAI_API_KEY',
  // ... more
];

function getFilteredEnv() {
  const filtered = { ...process.env };
  for (const key of BLOCKED_ENV_VARS) {
    delete filtered[key];
  }
  return filtered;
}
```

### 4. Permission Enforcement

Multi-layer permission checks:
1. **Mode check** - Respect current permission mode
2. **Tool pattern matching** - Regex-based allowlists
3. **Path validation** - Glob-based writable path checks
4. **User confirmation** - Explicit approval for dangerous operations

## Performance Considerations

### 1. Lazy Loading

- Sessions loaded on-demand
- MCP servers connected when needed
- UI components code-split

### 2. Debouncing

- Session writes (500ms)
- Vector search queries (300ms)
- Config file watching (100ms)

### 3. Caching

- Session index cached in memory
- MCP schemas cached per connection
- Theme CSS cached until change

### 4. Background Operations

Long-running tasks use background execution:
```typescript
async function runInBackground(task: BackgroundTask) {
  const taskId = generateId();

  // Notify UI of task start
  broadcastEvent('background-task:started', { taskId });

  try {
    const result = await task.execute();
    broadcastEvent('background-task:completed', { taskId, result });
  } catch (error) {
    broadcastEvent('background-task:failed', { taskId, error });
  }
}
```

## Extensibility

### 1. Custom Skills

Skills are markdown files with agent instructions:
```
~/.vesper/workspaces/{id}/skills/
├── react-best-practices.md
├── code-review.md
└── custom-skill.md
```

### 2. Custom Sources

Sources follow a plugin-like pattern:
```typescript
interface Source {
  type: 'mcp' | 'api' | 'local';
  slug: string;
  name: string;
  config: Record<string, any>;
}
```

### 3. Custom Themes

Themes are JSON files with 6-color system:
```json
{
  "colors": {
    "background": "#1e1e1e",
    "foreground": "#d4d4d4",
    "accent": "#007acc",
    "info": "#3794ff",
    "success": "#89d185",
    "destructive": "#f14c4c"
  },
  "dark": {
    "background": "#000000"
  }
}
```

## Related Documentation

- [Development Setup](development-setup.md)
- [Testing Guide](testing-guide.md)
- [IPC Patterns](ipc-patterns.md)
- [Code Organization](code-organization.md)

---

*Last Updated: 2026-01-26*
