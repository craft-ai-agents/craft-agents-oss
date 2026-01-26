# Code Organization

This guide explains the code organization patterns and conventions used throughout the Vesper codebase.

## Table of Contents

- [Project Structure](#project-structure)
- [Module Organization](#module-organization)
- [File Naming Conventions](#file-naming-conventions)
- [Import Patterns](#import-patterns)
- [Common Patterns](#common-patterns)
- [Anti-Patterns](#anti-patterns)

## Project Structure

### Monorepo Layout

Vesper uses a monorepo structure managed by Bun workspaces:

```
vesper/
├── apps/                      # Applications
│   ├── electron/             # Main desktop app
│   └── viewer/               # Session viewer web app
├── packages/                 # Shared packages
│   ├── core/                # Shared types
│   ├── shared/              # Business logic
│   └── ui/                  # UI components
├── scripts/                 # Build and utility scripts
├── docs/                    # Documentation
└── package.json             # Root workspace config
```

### Package Dependencies

```
┌─────────────┐
│ apps/electron│
└─────┬───────┘
      │ depends on
      ├──► @vesper/shared
      ├──► @vesper/ui
      └──► @vesper/core

┌─────────────┐
│ @vesper/ui  │
└─────┬───────┘
      │ depends on
      └──► @vesper/core

┌──────────────┐
│ @vesper/shared│
└─────┬────────┘
      │ depends on
      └──► @vesper/core

┌──────────────┐
│ @vesper/core │  ← Base types, no dependencies
└──────────────┘
```

## Module Organization

### Electron App Structure

```
apps/electron/src/
├── main/                     # Main process (Node.js)
│   ├── index.ts             # Entry point
│   ├── ipc.ts               # IPC handler registration
│   ├── sessions.ts          # Session management
│   ├── scheduler.ts         # Cron scheduler
│   ├── slack-service.ts     # Slack integration
│   ├── telegram-service.ts  # Telegram integration
│   ├── task-lists-ipc.ts    # Task list IPC handlers
│   ├── claude-profiles-ipc.ts # Claude profiles IPC
│   └── __tests__/           # Main process tests
│
├── preload/                 # Preload script (context bridge)
│   └── index.ts             # Exposed APIs
│
├── renderer/                # Renderer process (React)
│   ├── atoms/               # Jotai state atoms
│   │   ├── command-palette.ts
│   │   ├── vector-search.ts
│   │   └── scheduler.ts
│   │
│   ├── components/          # React components
│   │   ├── chat/           # Chat UI
│   │   ├── scheduler/      # Scheduler UI
│   │   ├── settings/       # Settings pages
│   │   ├── ui/             # Base UI components
│   │   └── [feature]/      # Feature-specific
│   │
│   ├── pages/              # Page components
│   │   ├── AllChats.tsx
│   │   ├── Settings.tsx
│   │   └── Sources.tsx
│   │
│   ├── hooks/              # Custom React hooks
│   │   ├── useSession.ts
│   │   ├── useWorkspace.ts
│   │   └── useIpc.ts
│   │
│   ├── contexts/           # React contexts
│   │   ├── NavigationContext.tsx
│   │   └── SessionContext.tsx
│   │
│   ├── event-processor/    # Agent event handling
│   │   ├── index.ts
│   │   └── __tests__/
│   │
│   └── main.tsx            # React entry point
│
└── shared/                 # Shared types between processes
    └── types.ts
```

### Shared Package Structure

```
packages/shared/src/
├── agent/                  # VesperAgent implementation
│   ├── vesper-agent.ts    # Main agent class
│   ├── mode-manager.ts    # Permission modes
│   ├── session-scoped-tools.ts # Session tools
│   ├── permissions-config.ts   # Safety rules
│   ├── options.ts         # SDK configuration
│   └── __tests__/
│
├── auth/                  # Authentication
│   ├── vesper-token.ts   # Vesper OAuth
│   ├── claude-token.ts   # Claude OAuth
│   └── state.ts          # Auth state management
│
├── config/               # Configuration
│   ├── storage.ts       # Config CRUD
│   ├── watcher.ts       # File watcher
│   ├── theme.ts         # Theme system
│   └── preferences.ts   # User preferences
│
├── credentials/          # Credential storage
│   ├── credential-manager.ts
│   └── encryption.ts
│
├── mcp/                 # MCP client
│   ├── vesper-mcp-client.ts
│   └── validation.ts
│
├── sessions/            # Session persistence
│   ├── storage.ts      # Session CRUD
│   ├── persistence-queue.ts
│   └── index.ts        # Session listing
│
├── sources/            # Data sources
│   ├── types.ts       # Source types
│   ├── storage.ts     # Source CRUD
│   └── service.ts     # Source lifecycle
│
├── task-lists/        # Task management
│   ├── types.ts      # Task list types
│   └── storage.ts    # Task CRUD
│
├── orchestrate/       # Orchestrate
│   ├── loop-runner.ts
│   ├── prd-parser.ts
│   └── types.ts
│
├── telegram/         # Telegram integration
│   ├── message-router.ts
│   ├── debounce.ts
│   ├── retry.ts
│   └── __tests__/
│
├── slack/           # Slack integration
│   └── message-router.ts
│
├── whatsapp/        # WhatsApp integration
│   ├── message-router.ts
│   ├── message-queue.ts
│   └── result-formatter.ts
│
└── utils/          # Utilities
    ├── debug.ts
    ├── summarization.ts
    └── file-utils.ts
```

### UI Package Structure

```
packages/ui/src/
├── components/
│   ├── chat/              # Chat components
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   └── __tests__/
│   │
│   ├── markdown/          # Markdown rendering
│   │   ├── MarkdownRenderer.tsx
│   │   ├── CodeBlock.tsx
│   │   └── LinkPreview.tsx
│   │
│   └── ui/               # Base UI kit
│       ├── button.tsx
│       ├── input.tsx
│       ├── dialog.tsx
│       └── [component].tsx
│
└── lib/                  # UI utilities
    └── utils.ts
```

## File Naming Conventions

### TypeScript Files

```
kebab-case.ts              # Standard files
PascalCase.tsx             # React components
[name].test.ts             # Test files
[name].stories.tsx         # Storybook stories
```

**Examples:**
```
vesper-agent.ts            ✓
session-manager.ts         ✓
task-lists-ipc.ts          ✓
ChatMessage.tsx            ✓
SessionList.tsx            ✓
debounce.test.ts           ✓
```

### Directory Names

```
kebab-case/                # Feature directories
__tests__/                 # Test directories
```

**Examples:**
```
task-lists/                ✓
orchestrate/                ✓
claude-profiles/           ✓
__tests__/                 ✓
```

## Import Patterns

### Subpath Exports

Vesper packages use subpath exports for clean imports:

```typescript
// ✓ Good - Subpath exports
import { VesperAgent } from '@vesper/shared/agent';
import { loadStoredConfig } from '@vesper/shared/config';
import type { Session } from '@vesper/core/types';

// ✗ Bad - Deep imports
import { VesperAgent } from '@vesper/shared/src/agent/vesper-agent';
import { loadStoredConfig } from '@vesper/shared/src/config/storage';
```

### Type-Only Imports

```typescript
// ✓ Good - Explicit type imports
import type { Session, Workspace } from '@vesper/core/types';
import { createSession } from '@vesper/shared/sessions';

// ✗ Bad - Mixed imports
import { Session, Workspace, createSession } from '@vesper/shared/sessions';
```

### Import Organization

Order imports logically:

```typescript
// 1. External dependencies
import { app, BrowserWindow, ipcMain } from 'electron';
import type { Agent } from '@anthropic-ai/claude-agent-sdk';

// 2. Vesper packages
import type { Session, Workspace } from '@vesper/core/types';
import { VesperAgent } from '@vesper/shared/agent';
import { loadStoredConfig } from '@vesper/shared/config';

// 3. Relative imports
import type { IpcHandlers } from './types';
import { createWindow } from './window';
import { debug } from './utils';
```

### Avoid Circular Dependencies

```typescript
// ✗ Bad - Circular dependency
// file-a.ts
import { FunctionB } from './file-b';
export function FunctionA() { ... }

// file-b.ts
import { FunctionA } from './file-a';  // Circular!
export function FunctionB() { ... }

// ✓ Good - Extract shared code
// shared.ts
export function SharedFunction() { ... }

// file-a.ts
import { SharedFunction } from './shared';
export function FunctionA() { ... }

// file-b.ts
import { SharedFunction } from './shared';
export function FunctionB() { ... }
```

## Common Patterns

### Feature Module Pattern

Each feature is self-contained with clear boundaries:

```
task-lists/
├── types.ts              # Type definitions
├── storage.ts            # Data layer
├── validation.ts         # Business logic
└── __tests__/            # Tests
    ├── storage.test.ts
    └── validation.test.ts
```

**Example:**
```typescript
// types.ts - Export all types
export interface TaskList { ... }
export interface Task { ... }
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

// storage.ts - Data operations
import type { TaskList, Task } from './types';

export async function createTaskList(name: string): Promise<TaskList> { ... }
export async function loadTaskList(id: string): Promise<TaskList | null> { ... }

// validation.ts - Business logic
import type { Task } from './types';

export function validateTaskSubject(subject: string): void { ... }
export function canUpdateTask(task: Task): boolean { ... }
```

### Service Pattern

Long-lived services manage lifecycle and state:

```typescript
// slack-service.ts
export class SlackService {
  private client: App | null = null;
  private isRunning = false;

  async start(config: SlackConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error('Slack service already running');
    }

    this.client = new App({
      token: config.botToken,
      socketMode: true,
      appToken: config.appToken,
    });

    await this.client.start();
    this.setupEventHandlers();
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.client) return;

    await this.client.stop();
    this.client = null;
    this.isRunning = false;
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.message(async ({ message, say }) => {
      // Handle message
    });
  }
}
```

### Factory Pattern

Create complex objects with factory functions:

```typescript
// agent-factory.ts
export async function createVesperAgent(
  config: VesperAgentConfig
): Promise<VesperAgent> {
  // Validate configuration
  validateAgentConfig(config);

  // Load additional data
  const sources = await loadWorkspaceSources(config.workspace.id);

  // Create agent
  const agent = new VesperAgent({
    ...config,
    sources,
  });

  // Setup hooks
  agent.setPermissionMode(config.session.permissionMode);

  return agent;
}
```

### Repository Pattern

Abstract data storage:

```typescript
// session-repository.ts
export interface SessionRepository {
  findById(id: string): Promise<Session | null>;
  findByWorkspace(workspaceId: string): Promise<Session[]>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
}

// jsonl-session-repository.ts
export class JsonlSessionRepository implements SessionRepository {
  async findById(id: string): Promise<Session | null> {
    const filePath = getSessionPath(id);
    if (!existsSync(filePath)) return null;
    return await readSessionFromFile(filePath);
  }

  async save(session: Session): Promise<void> {
    const filePath = getSessionPath(session.id);
    await writeSessionToFile(filePath, session);
  }

  // ... implement other methods
}
```

### Event Emitter Pattern

Decouple components with events:

```typescript
// persistence-queue.ts
import { EventEmitter } from 'events';

export class PersistenceQueue extends EventEmitter {
  private queue = new Map<string, Session>();

  enqueue(session: Session): void {
    this.queue.set(session.id, session);
    this.emit('enqueued', session.id);

    // Trigger flush
    this.scheduleFlush();
  }

  private async flush(): Promise<void> {
    const sessions = Array.from(this.queue.values());
    this.queue.clear();

    for (const session of sessions) {
      await writeSession(session);
      this.emit('persisted', session.id);
    }

    this.emit('flushed', sessions.length);
  }
}

// Usage
queue.on('persisted', (sessionId) => {
  console.log(`Session ${sessionId} persisted`);
});

queue.on('flushed', (count) => {
  console.log(`Flushed ${count} sessions`);
});
```

### Dependency Injection

Pass dependencies explicitly:

```typescript
// ✓ Good - Dependency injection
export class SessionManager {
  constructor(
    private storage: SessionStorage,
    private queue: PersistenceQueue
  ) {}

  async saveSession(session: Session): Promise<void> {
    await this.storage.save(session);
    this.queue.enqueue(session);
  }
}

// Usage - easy to test
const manager = new SessionManager(mockStorage, mockQueue);

// ✗ Bad - Hidden dependencies
export class SessionManager {
  async saveSession(session: Session): Promise<void> {
    await storage.save(session);  // Where does this come from?
    queue.enqueue(session);       // Hard to test
  }
}
```

## Anti-Patterns

### Avoid God Objects

```typescript
// ✗ Bad - God object doing everything
class Application {
  workspace: Workspace;
  sessions: Session[];
  mcpServers: MCPServer[];

  async initialize() { ... }
  async createSession() { ... }
  async loadSessions() { ... }
  async connectMcpServer() { ... }
  async handleMessage() { ... }
  async saveConfig() { ... }
  // ... 50 more methods
}

// ✓ Good - Separate concerns
class WorkspaceManager {
  async loadWorkspace(id: string): Promise<Workspace> { ... }
}

class SessionManager {
  async createSession(workspace: Workspace): Promise<Session> { ... }
  async loadSessions(workspaceId: string): Promise<Session[]> { ... }
}

class MCPManager {
  async connectServer(config: MCPServerConfig): Promise<MCPServer> { ... }
}
```

### Avoid Tight Coupling

```typescript
// ✗ Bad - Tight coupling
export class SessionList {
  private sessions: Session[];

  async loadFromFile() {
    const data = await readFile('~/.vesper/sessions.json');
    this.sessions = JSON.parse(data);
  }
}

// ✓ Good - Loose coupling
export class SessionList {
  constructor(private storage: SessionStorage) {}

  async load() {
    this.sessions = await this.storage.loadAll();
  }
}
```

### Avoid Magic Strings

```typescript
// ✗ Bad - Magic strings
if (session.status === 'in_progress') { ... }
window.electron.invoke('session:get', id);

// ✓ Good - Constants
const SessionStatus = {
  Pending: 'pending' as const,
  InProgress: 'in_progress' as const,
  Completed: 'completed' as const,
};

const IPC_CHANNELS = {
  SessionGet: 'session:get' as const,
  SessionCreate: 'session:create' as const,
};

if (session.status === SessionStatus.InProgress) { ... }
window.electron.invoke(IPC_CHANNELS.SessionGet, id);
```

### Avoid Deep Nesting

```typescript
// ✗ Bad - Deep nesting
async function processSession(id: string) {
  const session = await loadSession(id);
  if (session) {
    const workspace = await loadWorkspace(session.workspaceId);
    if (workspace) {
      const sources = await loadSources(workspace.id);
      if (sources.length > 0) {
        for (const source of sources) {
          if (source.type === 'mcp') {
            // Do something
          }
        }
      }
    }
  }
}

// ✓ Good - Early returns
async function processSession(id: string) {
  const session = await loadSession(id);
  if (!session) return;

  const workspace = await loadWorkspace(session.workspaceId);
  if (!workspace) return;

  const sources = await loadSources(workspace.id);
  if (sources.length === 0) return;

  const mcpSources = sources.filter(s => s.type === 'mcp');
  for (const source of mcpSources) {
    // Do something
  }
}
```

### Avoid Callback Hell

```typescript
// ✗ Bad - Callback hell
loadSession(id, (session) => {
  loadWorkspace(session.workspaceId, (workspace) => {
    loadSources(workspace.id, (sources) => {
      for (const source of sources) {
        connectSource(source, (connection) => {
          // Do something
        });
      }
    });
  });
});

// ✓ Good - async/await
async function setupSession(id: string) {
  const session = await loadSession(id);
  const workspace = await loadWorkspace(session.workspaceId);
  const sources = await loadSources(workspace.id);

  const connections = await Promise.all(
    sources.map(source => connectSource(source))
  );

  return connections;
}
```

## Best Practices

### 1. Single Responsibility

Each module should have one clear purpose:

```typescript
// ✓ Good - Single responsibility
// session-validator.ts
export function validateSession(session: Session): void { ... }

// session-storage.ts
export async function saveSession(session: Session): Promise<void> { ... }

// session-formatter.ts
export function formatSessionForDisplay(session: Session): string { ... }
```

### 2. Composition Over Inheritance

```typescript
// ✓ Good - Composition
interface MessageSender {
  send(message: string): Promise<void>;
}

class SlackMessageSender implements MessageSender {
  async send(message: string): Promise<void> {
    await this.slackClient.postMessage(message);
  }
}

class TelegramMessageSender implements MessageSender {
  async send(message: string): Promise<void> {
    await this.telegramBot.sendMessage(message);
  }
}

class MessageRouter {
  constructor(private sender: MessageSender) {}

  async route(message: string): Promise<void> {
    await this.sender.send(message);
  }
}
```

### 3. Immutability

Prefer immutable operations:

```typescript
// ✓ Good - Immutable
function updateSession(session: Session, updates: Partial<Session>): Session {
  return { ...session, ...updates, updatedAt: new Date().toISOString() };
}

// ✗ Bad - Mutating
function updateSession(session: Session, updates: Partial<Session>): Session {
  session.name = updates.name;
  session.updatedAt = new Date().toISOString();
  return session;
}
```

### 4. Error Handling

Handle errors at appropriate levels:

```typescript
// Low-level - Throw specific errors
async function loadSession(id: string): Promise<Session> {
  const data = await readFile(getSessionPath(id));
  if (!data) {
    throw new SessionNotFoundError(id);
  }
  return parseSession(data);
}

// Mid-level - Handle or propagate
async function getSessionWithWorkspace(id: string) {
  try {
    const session = await loadSession(id);
    const workspace = await loadWorkspace(session.workspaceId);
    return { session, workspace };
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      // Handle expected error
      return null;
    }
    // Propagate unexpected errors
    throw error;
  }
}

// Top-level - User-facing error handling
async function handleSessionRequest(id: string) {
  try {
    const data = await getSessionWithWorkspace(id);
    if (!data) {
      showNotification('Session not found');
      return;
    }
    displaySession(data);
  } catch (error) {
    console.error('Failed to load session:', error);
    showError('Failed to load session. Please try again.');
  }
}
```

## Related Documentation

- [Architecture Overview](architecture.md)
- [Development Setup](development-setup.md)
- [Testing Guide](testing-guide.md)
- [IPC Patterns](ipc-patterns.md)

---

*Last Updated: 2026-01-26*
