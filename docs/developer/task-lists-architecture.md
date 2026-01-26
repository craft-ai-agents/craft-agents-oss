# Task Lists Architecture

Technical documentation for developers working with the task list system in Vesper.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Type Definitions](#type-definitions)
4. [Storage Layer](#storage-layer)
5. [IPC Handlers](#ipc-handlers)
6. [VesperAgent Integration](#vesperagent-integration)
7. [Ralph Loop Integration](#ralph-loop-integration)
8. [Session Message Handling](#session-message-handling)
9. [API Reference](#api-reference)
10. [Code Examples](#code-examples)
11. [Extension Points](#extension-points)
12. [Best Practices](#best-practices)

---

## Overview

The task list system provides structured task management for Vesper's agent workflows. It enables multi-agent coordination, dependency tracking, and progress visibility across sessions and autonomous loops.

### Key Features

- **File-based storage**: Task lists stored as JSON files in `~/.vesper/task-lists/`
- **File locking**: Concurrent-safe CRUD operations using `proper-lockfile`
- **IPC communication**: Electron main/renderer communication with event broadcasting
- **Agent integration**: Environment variable injection for task list context
- **Ralph Loop automation**: Automatic task creation and synchronization from PRD stories
- **Session isolation**: Per-session task list context with no cross-contamination

### Technology Stack

| Component | Technology |
|-----------|------------|
| Storage | Node.js `fs/promises` with JSON serialization |
| Locking | `proper-lockfile` for file-based locks |
| IPC | Electron `ipcMain` / `ipcRenderer` |
| Events | Electron `BrowserWindow.webContents.send()` |
| Types | TypeScript interfaces and type guards |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Renderer Process                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  React Components (Task List UI, Session UI, Ralph Loop UI)  │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │ IPC Calls                            │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │          IPC Renderer (window.api.taskLists.*)               │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                      IPC Channel
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│                              ▼                Main Process           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │     IPC Handlers (apps/electron/src/main/task-lists-ipc.ts)  │   │
│  │                                                               │   │
│  │  • task-lists:list          • task-lists:task-create         │   │
│  │  • task-lists:create        • task-lists:task-batch-create   │   │
│  │  • task-lists:get           • task-lists:task-update         │   │
│  │  • task-lists:delete        • task-lists:task-delete         │   │
│  │  • task-lists:tasks-list                                     │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │      Storage Layer (packages/shared/src/task-lists/)         │   │
│  │                                                               │   │
│  │  • types.ts        - Type definitions                        │   │
│  │  • storage.ts      - CRUD operations with file locking       │   │
│  │  • index.ts        - Public exports                          │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │        File System (~/.vesper/task-lists/*.json)             │   │
│  │                                                               │   │
│  │  {id}.json - Task list files with file locks                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │    VesperAgent Integration (setTaskListId, env injection)    │   │
│  │                                                               │   │
│  │  packages/shared/src/agent/vesper-agent.ts                   │   │
│  │  • Lines 379: currentTaskListId field                        │   │
│  │  • Lines 799-802: setTaskListId() method                     │   │
│  │  • Lines 1576-1585: Environment variable injection           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │       Ralph Loop Integration (auto task creation & sync)     │   │
│  │                                                               │   │
│  │  packages/shared/src/ralph-loop/loop-runner.ts               │   │
│  │  • Lines 128-171: Upfront task creation from PRD stories     │   │
│  │  • Lines 335-349: Task status → in_progress on story start   │   │
│  │  • Lines 387-405: Task status → completed on story success   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │         Session Integration (task list ID management)        │   │
│  │                                                               │   │
│  │  apps/electron/src/main/sessions.ts                          │   │
│  │  • Lines 2356-2363: setTaskListId() before each chat()       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Task Creation (UI → Storage)**
   - User action triggers React component
   - Component calls `window.api.taskLists.create()`
   - IPC renderer sends `task-lists:create` message
   - IPC handler calls `createTaskList()` from storage layer
   - Storage writes JSON file with file lock
   - Handler broadcasts `task-lists:changed` event
   - UI components re-fetch and update

2. **Agent Task Context (Session → Agent)**
   - Session has `taskListId` field
   - Before `agent.chat()`, session handler calls `agent.setTaskListId(taskListId)`
   - VesperAgent stores ID in `currentTaskListId` field
   - On chat invocation, agent sets `CLAUDE_CODE_TASK_LIST_ID` environment variable
   - Agent tools can read environment variable to access task list context

3. **Ralph Loop Automation (Loop → Storage)**
   - Loop starts with `taskListId` and `autoCreateTasks: true`
   - Loop validates task list exists via `loadTaskList()`
   - Loop batch creates tasks from PRD stories via `batchCreateTasks()`
   - Loop stores story ID → task ID mapping
   - On story start, loop updates task status to `in_progress`
   - On story completion, loop updates task status to `completed` with metadata
   - Loop continues processing, non-fatal if task updates fail

---

## Type Definitions

Full type definitions are in `packages/shared/src/task-lists/types.ts`.

### Core Types

```typescript
/**
 * packages/shared/src/task-lists/types.ts
 */

// Task status in lifecycle (pending → in_progress → completed)
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

// Single task with dependencies, ownership, and metadata
export interface Task {
  id: string;                           // UUID
  subject: string;                      // Imperative form ("Fix bug")
  description: string;                  // Detailed requirements
  activeForm: string;                   // Present continuous ("Fixing bug")
  status: TaskStatus;                   // Current status
  owner?: string;                       // Agent/user ID
  metadata?: Record<string, unknown>;   // Extensible metadata
  blocks: string[];                     // Task IDs blocked by this task
  blockedBy: string[];                  // Task IDs blocking this task
  createdAt: string;                    // ISO 8601 timestamp
  updatedAt: string;                    // ISO 8601 timestamp
}

// Complete task list with all tasks
export interface TaskList {
  id: string;                           // UUID
  name: string;                         // Human-readable name
  description?: string;                 // Optional description
  tasks: Task[];                        // All tasks
  createdAt: string;                    // ISO 8601 timestamp
  updatedAt: string;                    // ISO 8601 timestamp
}

// Lightweight metadata for list views (omits tasks array)
export interface TaskListMeta {
  id: string;
  name: string;
  description?: string;
  taskCount: number;                    // Total tasks
  pendingCount: number;                 // Tasks with status 'pending'
  inProgressCount: number;              // Tasks with status 'in_progress'
  completedCount: number;               // Tasks with status 'completed'
  createdAt: string;
  updatedAt: string;
}
```

### Error Handling

```typescript
/**
 * packages/shared/src/task-lists/storage.ts
 */

export class TaskListError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA' | 'LOCK_TIMEOUT',
    public details?: unknown
  ) {
    super(message);
    this.name = 'TaskListError';
  }
}
```

**Error codes:**
- `NOT_FOUND`: Task list or task does not exist
- `INVALID_INPUT`: Invalid parameters (empty name, missing fields)
- `IO_ERROR`: File system operation failed
- `CORRUPT_DATA`: Task list file structure is invalid
- `LOCK_TIMEOUT`: Failed to acquire file lock after retries

---

## Storage Layer

The storage layer (`packages/shared/src/task-lists/storage.ts`) provides file-based persistence with concurrent-safe operations.

### File Structure

```
~/.vesper/task-lists/
  ├── {uuid-1}.json          # Task list 1
  ├── {uuid-2}.json          # Task list 2
  └── {uuid-3}.json          # Task list 3
```

Each JSON file contains:

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440000",
  "name": "Sprint 1 - Authentication",
  "description": "First sprint focusing on user authentication features",
  "tasks": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "subject": "Implement login endpoint",
      "description": "Create POST /api/auth/login with email/password validation",
      "activeForm": "Implementing login endpoint",
      "status": "completed",
      "owner": "agent-1",
      "metadata": { "priority": "high" },
      "blocks": ["550e8400-e29b-41d4-a716-446655440001"],
      "blockedBy": [],
      "createdAt": "2026-01-25T10:00:00Z",
      "updatedAt": "2026-01-25T11:30:00Z"
    }
  ],
  "createdAt": "2026-01-20T09:00:00Z",
  "updatedAt": "2026-01-25T11:30:00Z"
}
```

### File Locking

All write operations (create, update, delete) use file-based locking to prevent race conditions.

```typescript
import lockfile from 'proper-lockfile';

// Lock configuration
const lockOptions = {
  stale: 5000,                        // Lock expires after 5 seconds
  retries: { retries: 5, minTimeout: 50 }  // Retry up to 5 times
};

// Acquire lock
const release = await lockfile.lock(filePath, lockOptions);
try {
  // Perform write operation
  await saveTaskList(taskList);
} finally {
  await release();  // Always release lock
}
```

**Lock files:** `.{id}.json.lock` created next to task list files, automatically cleaned up.

### Path Functions

```typescript
/**
 * Get the directory where task lists are stored
 * Returns: ~/.vesper/task-lists
 */
export function getTaskListsDir(): string;

/**
 * Get the file path for a specific task list
 * Returns: ~/.vesper/task-lists/{id}.json
 */
export function getTaskListPath(id: string): string;
```

### Task List CRUD

```typescript
/**
 * Create a new task list
 * Throws: TaskListError (INVALID_INPUT, IO_ERROR)
 */
export async function createTaskList(
  name: string,
  description?: string
): Promise<TaskList>;

/**
 * Load a task list from disk
 * Returns: TaskList or null if not found/corrupted
 */
export async function loadTaskList(id: string): Promise<TaskList | null>;

/**
 * List all task lists with metadata only (no tasks array)
 * Returns: TaskListMeta[] sorted by most recently updated first
 */
export async function listTaskLists(): Promise<TaskListMeta[]>;

/**
 * Delete a task list
 * Throws: TaskListError (NOT_FOUND, IO_ERROR)
 */
export async function deleteTaskList(id: string): Promise<void>;
```

### Task CRUD

```typescript
/**
 * Create a new task in a task list
 * Uses file locking for concurrent safety
 * Throws: TaskListError (INVALID_INPUT, NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)
 */
export async function createTask(
  taskListId: string,
  subject: string,
  description: string,
  activeForm?: string,
  metadata?: Record<string, unknown>
): Promise<Task>;

/**
 * Batch create multiple tasks (for Ralph Loop upfront task creation)
 * More efficient than multiple createTask() calls
 * Uses file locking for concurrent safety
 * Throws: TaskListError (INVALID_INPUT, NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)
 */
export async function batchCreateTasks(
  taskListId: string,
  tasks: Array<{
    subject: string;
    description: string;
    activeForm?: string;
    metadata?: Record<string, unknown>;
    blocks?: string[];
    blockedBy?: string[];
  }>
): Promise<Task[]>;

/**
 * Update a task
 * Uses file locking for concurrent safety
 * Metadata is merged (not replaced)
 * Dependencies are additive only
 * Throws: TaskListError (NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)
 */
export async function updateTask(
  taskListId: string,
  taskId: string,
  updates: {
    subject?: string;
    description?: string;
    activeForm?: string;
    status?: TaskStatus;
    owner?: string;
    metadata?: Record<string, unknown>;
    addBlocks?: string[];
    addBlockedBy?: string[];
  }
): Promise<Task>;

/**
 * Delete a task
 * Uses file locking for concurrent safety
 * Automatically removes task ID from dependency arrays in other tasks
 * Throws: TaskListError (NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)
 */
export async function deleteTask(
  taskListId: string,
  taskId: string
): Promise<void>;
```

---

## IPC Handlers

IPC handlers bridge the renderer and main processes for task list operations. Located in `apps/electron/src/main/task-lists-ipc.ts`.

### Registration

```typescript
/**
 * apps/electron/src/main/task-lists-ipc.ts
 */

export function registerTaskListsIpc(): void {
  // Register all IPC handlers
}

// Call from apps/electron/src/main/index.ts
import { registerTaskListsIpc } from './task-lists-ipc';
registerTaskListsIpc();
```

### IPC Channels

| Channel | Parameters | Returns | Description |
|---------|-----------|---------|-------------|
| `task-lists:list` | none | `TaskListMeta[]` | List all task lists |
| `task-lists:create` | `name`, `description?` | `TaskList` | Create new task list |
| `task-lists:get` | `taskListId` | `TaskList \| null` | Get task list by ID |
| `task-lists:delete` | `taskListId` | `void` | Delete task list |
| `task-lists:task-create` | `taskListId`, `subject`, `description`, `activeForm?`, `metadata?` | `Task` | Create task |
| `task-lists:task-batch-create` | `taskListId`, `tasks[]` | `Task[]` | Batch create tasks |
| `task-lists:task-update` | `taskListId`, `taskId`, `updates` | `Task` | Update task |
| `task-lists:task-delete` | `taskListId`, `taskId` | `void` | Delete task |
| `task-lists:tasks-list` | `taskListId` | `Task[]` | Get all tasks in list |

### Event Broadcasting

After write operations (create, update, delete), the IPC handler broadcasts a change event to all windows:

```typescript
/**
 * apps/electron/src/main/task-lists-ipc.ts
 */

function broadcastTaskListChanged(taskListId: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('task-lists:changed', taskListId);
  });
}

// Example: After creating a task
ipcMain.handle('task-lists:task-create', async (_event, ...) => {
  const task = await createTask(...);
  broadcastTaskListChanged(taskListId);  // Notify all windows
  return task;
});
```

**Listener in renderer:**

```typescript
// Listen for changes
window.api.on('task-lists:changed', (taskListId: string) => {
  // Re-fetch task list
  refreshTaskList(taskListId);
});
```

### Error Handling

IPC handlers catch `TaskListError` and handle error codes:

```typescript
// Idempotent delete (treat NOT_FOUND as success)
ipcMain.handle('task-lists:delete', async (_event, taskListId: string) => {
  try {
    await deleteTaskList(taskListId);
    broadcastTaskListChanged(taskListId);
  } catch (error) {
    if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
      return;  // Already deleted, treat as success
    }
    console.error('[task-lists:delete] Error:', error);
    throw error;  // Re-throw other errors
  }
});
```

---

## VesperAgent Integration

VesperAgent integration enables agents to access task list context via environment variables. Located in `packages/shared/src/agent/vesper-agent.ts`.

### Task List ID Field

```typescript
/**
 * packages/shared/src/agent/vesper-agent.ts (line 379)
 */

class VesperAgent {
  // Task list ID for coordinating multi-agent workflows (set per-session via setTaskListId())
  private currentTaskListId?: string;
}
```

### setTaskListId() Method

```typescript
/**
 * packages/shared/src/agent/vesper-agent.ts (lines 799-802)
 *
 * Set the task list ID for coordinating multi-agent workflows.
 * This must be called before each chat() invocation to ensure the correct
 * CLAUDE_CODE_TASK_LIST_ID environment variable is set per-session.
 *
 * @param taskListId - The task list ID to use, or undefined to clear
 */
setTaskListId(taskListId: string | undefined): void {
  this.currentTaskListId = taskListId;
  debug(`[setTaskListId] Task list ID set to: ${taskListId || 'none'}`);
}
```

### Environment Variable Injection

```typescript
/**
 * packages/shared/src/agent/vesper-agent.ts (lines 1576-1585)
 *
 * Set task list environment variable for this chat invocation
 * This must be done per-chat to prevent cross-session contamination
 */

async *chat(
  userMessage: string,
  attachments?: FileAttachment[],
  flowyEmbeds?: FlowyInlineEmbed[],
  _isRetry: boolean = false
): AsyncGenerator<AgentEvent> {
  // ... other code ...

  // Set task list environment variable for this chat invocation
  const env: Record<string, string> = {};
  if (this.currentTaskListId) {
    env.CLAUDE_CODE_TASK_LIST_ID = this.currentTaskListId;
    debug(`[chat] Setting CLAUDE_CODE_TASK_LIST_ID=${this.currentTaskListId}`);
  } else {
    debug(`[chat] No task list ID set (env var will be empty)`);
  }
  setAnthropicOptionsEnv(env);

  // ... continue with chat() ...
}
```

### Session Integration

Session handler calls `setTaskListId()` before each `agent.chat()` call.

```typescript
/**
 * apps/electron/src/main/sessions.ts (lines 2356-2363)
 */

// Set task list ID for coordinating multi-agent workflows
// This must be called before each chat() to ensure correct CLAUDE_CODE_TASK_LIST_ID env var
if (managed.taskListId) {
  sessionLog.info(`Setting task list ID: ${managed.taskListId}`);
  agent.setTaskListId(managed.taskListId);
} else {
  // Clear task list ID if not set for this session
  agent.setTaskListId(undefined);
}

// Process the message through the agent
sessionLog.info('Calling agent.chat()...');
const eventStream = agent.chat(message, attachments, flowyEmbeds);
```

### How Agents Access Task List

Within agent tools (via Claude Agent SDK), the task list ID is available as an environment variable:

```typescript
// In agent tool implementation
const taskListId = process.env.CLAUDE_CODE_TASK_LIST_ID;

if (taskListId) {
  const taskList = await loadTaskList(taskListId);
  // ... use task list ...
}
```

---

## Ralph Loop Integration

Ralph Loop automatically creates and synchronizes tasks from PRD stories when configured with a task list ID. Located in `packages/shared/src/ralph-loop/loop-runner.ts`.

### Upfront Task Creation

When a loop starts with `taskListId` and `autoCreateTasks !== false`, all PRD stories are converted to tasks upfront.

```typescript
/**
 * packages/shared/src/ralph-loop/loop-runner.ts (lines 128-171)
 */

// Create tasks upfront if task list is configured
if (this.config.taskListId && this.config.autoCreateTasks !== false) {
  try {
    // Validate task list exists
    const taskList = await loadTaskList(this.config.taskListId);
    if (!taskList) {
      throw new Error(`Task list not found: ${this.config.taskListId}`);
    }

    // Prepare task data from PRD stories
    const tasksToCreate = prd.stories.map(story => ({
      subject: story.title,
      description: story.content,
      activeForm: `Processing ${story.title}`,
      metadata: {
        storyId: story.id,
        loopId: loopId,
        lineNumber: story.lineNumber,
      },
    }));

    // Batch create all tasks at once
    const createdTasks = await batchCreateTasks(this.config.taskListId, tasksToCreate);

    // Build mapping of story ID -> task ID
    const taskIds: Record<string, string> = {};
    createdTasks.forEach((task, index) => {
      const story = prd.stories[index];
      if (story) {
        taskIds[story.id] = task.id;
      }
    });

    // Update state with task list info
    if (this.state) {
      this.state.taskListId = this.config.taskListId;
      this.state.taskIds = taskIds;
    }

    console.log(`[Ralph Loop] Created ${createdTasks.length} tasks in task list ${this.config.taskListId}`);
  } catch (error) {
    console.error('[Ralph Loop] Failed to create tasks:', error);
    // Don't fail the loop, just log the error and continue without task tracking
  }
}
```

**Key points:**
- Validates task list exists before creating tasks
- Uses `batchCreateTasks()` for efficiency (single file lock, single write)
- Stores story metadata in task for traceability
- Builds story ID → task ID mapping for status updates
- Non-fatal: Loop continues even if task creation fails

### Task Status Synchronization

#### Story Start (in_progress)

```typescript
/**
 * packages/shared/src/ralph-loop/loop-runner.ts (lines 335-349)
 */

// Update task status to in_progress (non-fatal)
if (this.state!.taskListId && this.state!.taskIds) {
  const taskId = this.state!.taskIds[story.id];
  if (taskId) {
    try {
      await updateTask(this.state!.taskListId, taskId, {
        status: 'in_progress',
        owner: this.sessionId,
      });
    } catch (error) {
      console.error('[Ralph Loop] Failed to update task status to in_progress:', error);
      // Continue processing even if task update fails
    }
  }
}
```

#### Story Completion (completed)

```typescript
/**
 * packages/shared/src/ralph-loop/loop-runner.ts (lines 387-405)
 */

// Update task status to completed (non-fatal)
if (this.state!.taskListId && this.state!.taskIds) {
  const taskId = this.state!.taskIds[story.id];
  if (taskId) {
    try {
      await updateTask(this.state!.taskListId, taskId, {
        status: 'completed',
        metadata: {
          completedAt: new Date().toISOString(),
          iterations,
          commitSha,
        },
      });
    } catch (error) {
      console.error('[Ralph Loop] Failed to update task status to completed:', error);
      // Continue processing even if task update fails
    }
  }
}
```

**Key points:**
- Sets `owner` to session ID when starting story
- Adds completion metadata (timestamp, iterations, commit SHA)
- Non-fatal: Loop continues even if task update fails
- Ensures task list reflects loop progress in real-time

### Configuration

Ralph Loop config supports task list integration:

```typescript
interface RalphLoopConfig {
  taskListId?: string;          // Task list ID to use
  autoCreateTasks?: boolean;    // Default: true (set false to disable)
  // ... other config fields ...
}
```

---

## Session Message Handling

Session message handling integrates task lists into the conversation flow. Located in `apps/electron/src/main/sessions.ts`.

### Task List ID Management

Sessions store an optional `taskListId` field:

```typescript
interface ManagedSession {
  taskListId?: string;
  // ... other session fields ...
}
```

### setTaskListId() Before chat()

Before each `agent.chat()` call, the session handler sets the task list ID:

```typescript
/**
 * apps/electron/src/main/sessions.ts (lines 2356-2363)
 */

// Set task list ID for coordinating multi-agent workflows
// This must be called before each chat() to ensure correct CLAUDE_CODE_TASK_LIST_ID env var
if (managed.taskListId) {
  sessionLog.info(`Setting task list ID: ${managed.taskListId}`);
  agent.setTaskListId(managed.taskListId);
} else {
  // Clear task list ID if not set for this session
  agent.setTaskListId(undefined);
}

// Process the message through the agent
sessionLog.info('Calling agent.chat()...');
const eventStream = agent.chat(message, attachments, flowyEmbeds);
```

**Key points:**
- Called before every `chat()` invocation
- Clears task list ID if session doesn't have one (prevents cross-session contamination)
- Logs task list ID for debugging

### Multi-Session Coordination

Multiple sessions can share the same task list for parallel work:

```typescript
// Session 1
session1.taskListId = 'shared-task-list-id';
agent1.setTaskListId('shared-task-list-id');

// Session 2 (same task list)
session2.taskListId = 'shared-task-list-id';
agent2.setTaskListId('shared-task-list-id');

// Both agents can claim different tasks from the same list
// Task ownership prevents duplicate work
```

---

## API Reference

Complete API reference available at [`docs/api/task-lists.md`](/Users/tinnguyen/vesper/docs/api/task-lists.md).

### Quick Reference

**Storage API** (`packages/shared/src/task-lists/storage.ts`):
- `getTaskListsDir(): string`
- `getTaskListPath(id: string): string`
- `createTaskList(name: string, description?: string): Promise<TaskList>`
- `loadTaskList(id: string): Promise<TaskList | null>`
- `listTaskLists(): Promise<TaskListMeta[]>`
- `deleteTaskList(id: string): Promise<void>`
- `createTask(taskListId: string, subject: string, description: string, activeForm?: string, metadata?: Record<string, unknown>): Promise<Task>`
- `batchCreateTasks(taskListId: string, tasks: Array<{...}>): Promise<Task[]>`
- `updateTask(taskListId: string, taskId: string, updates: {...}): Promise<Task>`
- `deleteTask(taskListId: string, taskId: string): Promise<void>`

**VesperAgent API** (`packages/shared/src/agent/vesper-agent.ts`):
- `setTaskListId(taskListId: string | undefined): void` (line 799)
- Environment variable: `process.env.CLAUDE_CODE_TASK_LIST_ID`

**IPC API** (`apps/electron/src/main/task-lists-ipc.ts`):
- Channels: `task-lists:*` (see [IPC Channels](#ipc-channels) table)
- Event: `task-lists:changed` (broadcast on write operations)

---

## Code Examples

### Example 1: Creating a Task List from Renderer

```typescript
// React component
import { useState } from 'react';

function CreateTaskListForm() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async () => {
    try {
      const taskList = await window.api.taskLists.create(name, description);
      console.log('Created task list:', taskList.id);

      // Listen for changes
      window.api.on('task-lists:changed', (changedId: string) => {
        if (changedId === taskList.id) {
          console.log('Task list changed, refetching...');
        }
      });
    } catch (error) {
      console.error('Failed to create task list:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
      <button type="submit">Create Task List</button>
    </form>
  );
}
```

### Example 2: Creating Tasks with Dependencies

```typescript
import { createTask, updateTask } from '@vesper/shared/task-lists';

async function createFeatureTasks(taskListId: string) {
  // Create tasks sequentially
  const task1 = await createTask(
    taskListId,
    'Design database schema',
    'Create ERD and migration scripts for user tables',
    'Designing database schema',
    { priority: 'high' }
  );

  const task2 = await createTask(
    taskListId,
    'Implement user registration',
    'Create API endpoint for user signup with validation',
    'Implementing user registration',
    { priority: 'medium' }
  );

  const task3 = await createTask(
    taskListId,
    'Add email verification',
    'Send verification emails and implement confirmation flow',
    'Adding email verification',
    { priority: 'low' }
  );

  // Set up dependencies
  await updateTask(taskListId, task2.id, {
    addBlockedBy: [task1.id],  // task2 depends on task1
  });

  await updateTask(taskListId, task3.id, {
    addBlockedBy: [task2.id],  // task3 depends on task2
  });

  console.log('Created 3 tasks with dependency chain');
}
```

### Example 3: Batch Creating Tasks (Ralph Loop Pattern)

```typescript
import { batchCreateTasks } from '@vesper/shared/task-lists';

async function createTasksFromPRD(taskListId: string, stories: Array<{ title: string; content: string }>) {
  const tasksToCreate = stories.map(story => ({
    subject: story.title,
    description: story.content,
    activeForm: `Processing ${story.title}`,
    metadata: {
      source: 'prd',
      createdAt: new Date().toISOString(),
    },
  }));

  const createdTasks = await batchCreateTasks(taskListId, tasksToCreate);
  console.log(`Created ${createdTasks.length} tasks from PRD`);

  return createdTasks;
}
```

### Example 4: Updating Task Status

```typescript
import { updateTask } from '@vesper/shared/task-lists';

async function claimAndStartTask(taskListId: string, taskId: string, agentId: string) {
  // Atomically claim and start task
  const task = await updateTask(taskListId, taskId, {
    status: 'in_progress',
    owner: agentId,
    metadata: {
      startedAt: new Date().toISOString(),
    },
  });

  console.log(`Task ${task.subject} claimed by ${agentId}`);
  return task;
}

async function completeTask(taskListId: string, taskId: string, result: string) {
  const task = await updateTask(taskListId, taskId, {
    status: 'completed',
    metadata: {
      completedAt: new Date().toISOString(),
      result,
    },
  });

  console.log(`Task ${task.subject} completed`);
  return task;
}
```

### Example 5: Multi-Agent Coordination

```typescript
import { loadTaskList, updateTask } from '@vesper/shared/task-lists';

async function claimNextAvailableTask(taskListId: string, agentId: string) {
  const taskList = await loadTaskList(taskListId);
  if (!taskList) {
    throw new Error('Task list not found');
  }

  // Find first available task (pending, no owner, not blocked)
  const availableTask = taskList.tasks.find(task =>
    task.status === 'pending' &&
    !task.owner &&
    task.blockedBy.length === 0
  );

  if (!availableTask) {
    console.log('No available tasks');
    return null;
  }

  // Claim the task
  return await updateTask(taskListId, availableTask.id, {
    status: 'in_progress',
    owner: agentId,
  });
}
```

### Example 6: Listing Tasks with Filtering

```typescript
import { loadTaskList } from '@vesper/shared/task-lists';

async function getTasksByStatus(taskListId: string, status: TaskStatus) {
  const taskList = await loadTaskList(taskListId);
  if (!taskList) return [];

  return taskList.tasks.filter(task => task.status === status);
}

async function getTasksByOwner(taskListId: string, owner: string) {
  const taskList = await loadTaskList(taskListId);
  if (!taskList) return [];

  return taskList.tasks.filter(task => task.owner === owner);
}

async function getBlockedTasks(taskListId: string) {
  const taskList = await loadTaskList(taskListId);
  if (!taskList) return [];

  return taskList.tasks.filter(task => task.blockedBy.length > 0);
}
```

---

## Extension Points

### 1. Custom Metadata Fields

Tasks support arbitrary metadata for extensibility:

```typescript
await createTask(taskListId, subject, description, activeForm, {
  // Custom fields
  priority: 'high',
  labels: ['security', 'backend'],
  estimatedHours: 8,
  assignee: 'john@example.com',
  dueDate: '2026-02-01',
  customField: 'custom value',
});
```

**Use cases:**
- Priority sorting
- Label filtering
- Time tracking
- Custom workflows
- Integration with external systems

### 2. Task List Event Listeners

Listen for task list changes in the renderer:

```typescript
window.api.on('task-lists:changed', (taskListId: string) => {
  // Custom logic when task list changes
  refreshUI(taskListId);
  notifyUser(taskListId);
  syncToExternalSystem(taskListId);
});
```

### 3. Custom Storage Backends

Replace file-based storage with a custom backend:

```typescript
// Implement storage interface
export async function loadTaskList(id: string): Promise<TaskList | null> {
  // Custom implementation (database, API, etc.)
  const data = await myDatabase.query('SELECT * FROM task_lists WHERE id = ?', [id]);
  return data ? parseTaskList(data) : null;
}

// Update all storage functions
// Maintain same API contract
```

### 4. Additional IPC Handlers

Add custom IPC handlers for domain-specific operations:

```typescript
// apps/electron/src/main/task-lists-ipc.ts

ipcMain.handle('task-lists:get-by-status', async (_event, taskListId: string, status: TaskStatus) => {
  const taskList = await loadTaskList(taskListId);
  return taskList?.tasks.filter(t => t.status === status) || [];
});

ipcMain.handle('task-lists:reorder-tasks', async (_event, taskListId: string, taskIds: string[]) => {
  // Custom reordering logic
  const taskList = await loadTaskList(taskListId);
  // ... reorder tasks ...
  await saveTaskList(taskList);
  broadcastTaskListChanged(taskListId);
});
```

### 5. Task Dependencies Validation

Add validation for circular dependencies:

```typescript
function detectCircularDependency(tasks: Task[], taskId: string, visited: Set<string> = new Set()): boolean {
  if (visited.has(taskId)) return true;
  visited.add(taskId);

  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  for (const blockedBy of task.blockedBy) {
    if (detectCircularDependency(tasks, blockedBy, new Set(visited))) {
      return true;
    }
  }

  return false;
}

// Use in updateTask() before adding dependencies
if (detectCircularDependency(taskList.tasks, taskId)) {
  throw new TaskListError('Circular dependency detected', 'INVALID_INPUT');
}
```

### 6. Task Templates

Create reusable task templates:

```typescript
interface TaskTemplate {
  name: string;
  tasks: Array<{
    subject: string;
    description: string;
    metadata?: Record<string, unknown>;
  }>;
}

async function createTasksFromTemplate(taskListId: string, template: TaskTemplate) {
  return await batchCreateTasks(taskListId, template.tasks);
}

const authTemplate: TaskTemplate = {
  name: 'Authentication Feature',
  tasks: [
    { subject: 'Design schema', description: 'Create ERD...' },
    { subject: 'Implement login', description: 'Create endpoint...' },
    { subject: 'Add tests', description: 'Write integration tests...' },
  ],
};
```

---

## Best Practices

### 1. Error Handling

Always catch `TaskListError` and check error codes:

```typescript
import { TaskListError } from '@vesper/shared/task-lists';

try {
  await createTask(taskListId, subject, description);
} catch (error) {
  if (error instanceof TaskListError) {
    switch (error.code) {
      case 'NOT_FOUND':
        console.error('Task list does not exist');
        break;
      case 'INVALID_INPUT':
        console.error('Invalid task data:', error.message);
        break;
      case 'IO_ERROR':
        console.error('File system error:', error.details);
        break;
      case 'LOCK_TIMEOUT':
        console.error('Lock timeout, retry operation');
        break;
      default:
        console.error('Unknown error:', error.message);
    }
  } else {
    throw error;  // Rethrow unexpected errors
  }
}
```

### 2. Batch Operations

Use `batchCreateTasks()` for creating multiple tasks:

```typescript
// Good: Single file lock, single write
const tasks = await batchCreateTasks(taskListId, [
  { subject: 'Task 1', description: 'Description 1' },
  { subject: 'Task 2', description: 'Description 2' },
  { subject: 'Task 3', description: 'Description 3' },
]);

// Bad: Multiple file locks, multiple writes
for (const taskData of taskDataArray) {
  await createTask(taskListId, taskData.subject, taskData.description);
}
```

### 3. Dependency Management

Model natural dependencies and enable parallelism:

```typescript
// Good: Only block when necessary
const [task1, task2, task3] = await batchCreateTasks(taskListId, [
  { subject: 'Setup database', description: '...' },
  { subject: 'Seed test data', description: '...' },  // depends on task1
  { subject: 'Write tests', description: '...' },     // independent
]);

await updateTask(taskListId, task2.id, { addBlockedBy: [task1.id] });
// task3 can run in parallel with task1 and task2

// Bad: Over-blocking
await updateTask(taskListId, task3.id, { addBlockedBy: [task1.id, task2.id] });
// task3 unnecessarily waits for task2
```

### 4. Concurrent Updates

File locking prevents race conditions, but last write wins:

```typescript
// Safe: Both updates will succeed, but not atomically
await Promise.all([
  updateTask(taskListId, taskId, { metadata: { field1: 'value1' } }),
  updateTask(taskListId, taskId, { metadata: { field2: 'value2' } }),
]);
// Result: Last write wins (not ideal, but no corruption)

// Better: Batch updates
await updateTask(taskListId, taskId, {
  metadata: { field1: 'value1', field2: 'value2' },
});
```

### 5. Non-Fatal Task Updates

Ralph Loop pattern: Don't fail the main workflow if task updates fail:

```typescript
try {
  await updateTask(taskListId, taskId, { status: 'completed' });
} catch (error) {
  console.error('Failed to update task status:', error);
  // Continue processing (task update is not critical)
}
```

### 6. Task List Validation

Validate task list exists before operations:

```typescript
const taskList = await loadTaskList(taskListId);
if (!taskList) {
  throw new Error('Task list not found');
}
// Proceed with operations
```

### 7. List View Performance

Use `listTaskLists()` for overview pages (metadata only):

```typescript
// Good: Fast, metadata only
const taskLists = await listTaskLists();
for (const meta of taskLists) {
  console.log(`${meta.name}: ${meta.completedCount}/${meta.taskCount}`);
}

// Bad: Loads all tasks for every list
const allTaskLists = [];
for (const meta of await listTaskLists()) {
  allTaskLists.push(await loadTaskList(meta.id));
}
```

### 8. Session Isolation

Clear task list ID when switching sessions:

```typescript
// When switching to session with task list
agent.setTaskListId(session.taskListId);

// When switching to session without task list
agent.setTaskListId(undefined);

// Never reuse task list ID across unrelated sessions
```

---

## Related Documentation

- **API Reference:** [`docs/api/task-lists.md`](/Users/tinnguyen/vesper/docs/api/task-lists.md)
- **User Manual:** [`docs/user-guide/task-lists.md`](/Users/tinnguyen/vesper/docs/user-guide/task-lists.md)
- **Source Code:**
  - Types: [`packages/shared/src/task-lists/types.ts`](/Users/tinnguyen/vesper/packages/shared/src/task-lists/types.ts)
  - Storage: [`packages/shared/src/task-lists/storage.ts`](/Users/tinnguyen/vesper/packages/shared/src/task-lists/storage.ts)
  - IPC: [`apps/electron/src/main/task-lists-ipc.ts`](/Users/tinnguyen/vesper/apps/electron/src/main/task-lists-ipc.ts)
  - VesperAgent: [`packages/shared/src/agent/vesper-agent.ts`](/Users/tinnguyen/vesper/packages/shared/src/agent/vesper-agent.ts) (lines 379, 799-802, 1576-1585)
  - Ralph Loop: [`packages/shared/src/ralph-loop/loop-runner.ts`](/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/loop-runner.ts) (lines 128-171, 335-349, 387-405)
  - Sessions: [`apps/electron/src/main/sessions.ts`](/Users/tinnguyen/vesper/apps/electron/src/main/sessions.ts) (lines 2356-2363)

---

*Last Updated: 2026-01-25*
