# Task Lists Package

Core types and utilities for structured task management with dependencies, ownership, and metadata tracking in Vesper.

## Overview

The task lists package provides a file-based storage system for managing tasks with status tracking, dependencies, and multi-agent coordination. It's designed for use in Vesper's agent workflows, Ralph Loop automation, and session-based coordination.

## Quick Start

### Installation

This package is part of the `@vesper/shared` monorepo package. Import from subpath:

```typescript
import {
  createTaskList,
  loadTaskList,
  listTaskLists,
  deleteTaskList,
  createTask,
  batchCreateTasks,
  updateTask,
  deleteTask,
  TaskListError,
  type Task,
  type TaskList,
  type TaskListMeta,
  type TaskStatus,
} from '@vesper/shared/task-lists';
```

### Basic Usage

```typescript
// Create a new task list
const taskList = await createTaskList(
  'Sprint 1 - Authentication',
  'First sprint focusing on user authentication features'
);

// Create a task
const task = await createTask(
  taskList.id,
  'Implement login endpoint',
  'Create POST /api/auth/login with email/password validation',
  'Implementing login endpoint',  // activeForm (optional)
  { priority: 'high' }            // metadata (optional)
);

// Update task status
await updateTask(taskList.id, task.id, {
  status: 'in_progress',
  owner: 'agent-1',
});

// Mark task as completed
await updateTask(taskList.id, task.id, {
  status: 'completed',
  metadata: {
    completedAt: new Date().toISOString(),
  },
});

// List all task lists
const taskLists = await listTaskLists();
console.log(`Found ${taskLists.length} task lists`);

// Load full task list with tasks
const fullTaskList = await loadTaskList(taskList.id);
console.log(`Task list has ${fullTaskList?.tasks.length} tasks`);
```

---

## Module Structure

```
packages/shared/src/task-lists/
├── README.md          # This file
├── index.ts           # Public API exports
├── types.ts           # Type definitions (Task, TaskList, TaskListMeta, TaskStatus)
└── storage.ts         # Storage implementation with file locking
```

### Exports

**Types** (`types.ts`):
- `TaskStatus` - Status enum (`'pending' | 'in_progress' | 'completed'`)
- `Task` - Single task interface
- `TaskList` - Complete task list interface
- `TaskListMeta` - Lightweight metadata interface

**Storage** (`storage.ts`):
- `TaskListError` - Custom error class with error codes
- `getTaskListsDir()` - Get task lists directory path
- `getTaskListPath()` - Get specific task list file path
- `createTaskList()` - Create new task list
- `loadTaskList()` - Load task list from disk
- `listTaskLists()` - List all task lists (metadata only)
- `deleteTaskList()` - Delete task list
- `createTask()` - Create single task
- `batchCreateTasks()` - Batch create multiple tasks
- `updateTask()` - Update task
- `deleteTask()` - Delete task

---

## Key Concepts

### Task Status Lifecycle

Tasks progress through three states in a linear workflow:

```
pending → in_progress → completed
```

- **pending**: Task not started yet (initial state, or waiting for dependencies)
- **in_progress**: Task currently being worked on (agent has claimed the task)
- **completed**: Task finished successfully (all acceptance criteria met)

### Task Dependencies

Tasks can have two types of dependencies:

- **blocks**: Task IDs that cannot start until this task completes
- **blockedBy**: Task IDs that must complete before this task can start

Dependencies enable:
- Sequential execution (A must complete before B starts)
- Parallel execution (A and B can run simultaneously)
- Dependency chains (A → B → C)
- Multi-agent coordination (claim tasks with no blockers)

### File-Based Storage

Task lists are stored as JSON files in `~/.vesper/task-lists/{id}.json`:

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
      "blocks": [],
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

All write operations use file-based locking (`proper-lockfile`) to prevent race conditions:

```typescript
import lockfile from 'proper-lockfile';

const lockOptions = {
  stale: 5000,                                    // Lock expires after 5 seconds
  retries: { retries: 5, minTimeout: 50 }         // Retry up to 5 times
};

const release = await lockfile.lock(filePath, lockOptions);
try {
  // Perform write operation
  await writeFile(filePath, JSON.stringify(taskList));
} finally {
  await release();  // Always release lock
}
```

Lock files (`.{id}.json.lock`) are created next to task list files and automatically cleaned up.

### Error Handling

All operations throw `TaskListError` with structured error codes:

```typescript
class TaskListError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA' | 'LOCK_TIMEOUT',
    public details?: unknown
  );
}
```

**Error codes:**
- `NOT_FOUND`: Task list or task does not exist
- `INVALID_INPUT`: Invalid parameters (empty name, missing fields)
- `IO_ERROR`: File system operation failed
- `CORRUPT_DATA`: Task list file structure is invalid
- `LOCK_TIMEOUT`: Failed to acquire file lock after retries

---

## Usage Examples

### Example 1: Creating Tasks with Dependencies

```typescript
import { createTask, updateTask } from '@vesper/shared/task-lists';

async function createFeatureTasks(taskListId: string) {
  // Create tasks
  const task1 = await createTask(
    taskListId,
    'Design database schema',
    'Create ERD and migration scripts',
    'Designing database schema',
    { priority: 'high' }
  );

  const task2 = await createTask(
    taskListId,
    'Implement API endpoints',
    'Build REST API with validation',
    'Implementing API endpoints',
    { priority: 'medium' }
  );

  const task3 = await createTask(
    taskListId,
    'Write integration tests',
    'Test all endpoints with fixtures',
    'Writing integration tests',
    { priority: 'low' }
  );

  // Set up dependency chain: task1 → task2 → task3
  await updateTask(taskListId, task2.id, { addBlockedBy: [task1.id] });
  await updateTask(taskListId, task3.id, { addBlockedBy: [task2.id] });

  console.log('Created 3 tasks with sequential dependencies');
}
```

### Example 2: Batch Creating Tasks (Ralph Loop Pattern)

```typescript
import { batchCreateTasks } from '@vesper/shared/task-lists';

async function createTasksFromPRD(
  taskListId: string,
  stories: Array<{ id: string; title: string; content: string }>
) {
  const tasksToCreate = stories.map(story => ({
    subject: story.title,
    description: story.content,
    activeForm: `Processing ${story.title}`,
    metadata: {
      storyId: story.id,
      source: 'prd',
      createdAt: new Date().toISOString(),
    },
  }));

  // Single file lock, single write (more efficient than createTask in a loop)
  const createdTasks = await batchCreateTasks(taskListId, tasksToCreate);

  // Build story ID → task ID mapping
  const storyTaskMap: Record<string, string> = {};
  createdTasks.forEach((task, index) => {
    storyTaskMap[stories[index].id] = task.id;
  });

  return { createdTasks, storyTaskMap };
}
```

### Example 3: Multi-Agent Coordination

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
    console.log('No available tasks for agent', agentId);
    return null;
  }

  // Atomically claim and start the task
  return await updateTask(taskListId, availableTask.id, {
    status: 'in_progress',
    owner: agentId,
    metadata: {
      startedAt: new Date().toISOString(),
    },
  });
}
```

### Example 4: Error Handling

```typescript
import { createTask, TaskListError } from '@vesper/shared/task-lists';

async function createTaskWithErrorHandling(taskListId: string, subject: string, description: string) {
  try {
    return await createTask(taskListId, subject, description);
  } catch (error) {
    if (error instanceof TaskListError) {
      switch (error.code) {
        case 'NOT_FOUND':
          console.error('Task list does not exist:', taskListId);
          break;
        case 'INVALID_INPUT':
          console.error('Invalid task data:', error.message);
          break;
        case 'IO_ERROR':
          console.error('File system error:', error.details);
          break;
        case 'LOCK_TIMEOUT':
          console.error('Lock timeout, retrying...');
          // Implement retry logic
          break;
        default:
          console.error('Unknown error:', error.message);
      }
    } else {
      throw error;  // Rethrow unexpected errors
    }
  }
}
```

### Example 5: Filtering and Querying Tasks

```typescript
import { loadTaskList, type TaskStatus } from '@vesper/shared/task-lists';

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

async function getHighPriorityTasks(taskListId: string) {
  const taskList = await loadTaskList(taskListId);
  if (!taskList) return [];

  return taskList.tasks.filter(task => task.metadata?.priority === 'high');
}
```

### Example 6: Metadata Management

```typescript
import { createTask, updateTask } from '@vesper/shared/task-lists';

// Create task with rich metadata
const task = await createTask(
  taskListId,
  'Implement user authentication',
  'Add JWT-based authentication with refresh tokens',
  'Implementing user authentication',
  {
    priority: 'high',
    labels: ['security', 'backend'],
    estimatedHours: 8,
    assignee: 'john@example.com',
    dueDate: '2026-02-01',
    customField: 'custom value',
  }
);

// Update metadata (merges with existing)
await updateTask(taskListId, task.id, {
  metadata: {
    actualHours: 6,
    completedAt: new Date().toISOString(),
    reviewedBy: 'jane@example.com',
  },
});
// Result: metadata now has all fields (priority, labels, ..., actualHours, completedAt, reviewedBy)
```

---

## Integration Points

### VesperAgent Integration

VesperAgent can access task list context via environment variable:

```typescript
// packages/shared/src/agent/vesper-agent.ts

// Set task list ID before chat()
agent.setTaskListId(taskListId);

// Agent injects CLAUDE_CODE_TASK_LIST_ID env var
// Tools can access it:
const taskListId = process.env.CLAUDE_CODE_TASK_LIST_ID;
```

See [`packages/shared/src/agent/vesper-agent.ts`](/Users/tinnguyen/vesper/packages/shared/src/agent/vesper-agent.ts) (lines 379, 799-802, 1576-1585).

### Ralph Loop Integration

Ralph Loop automatically creates and synchronizes tasks from PRD stories:

```typescript
// packages/shared/src/ralph-loop/loop-runner.ts

// Loop config
const config = {
  taskListId: 'task-list-uuid',
  autoCreateTasks: true,  // Default: true
};

// Loop creates tasks upfront from PRD stories
// Updates task status to in_progress on story start
// Updates task status to completed on story success
```

See [`packages/shared/src/ralph-loop/loop-runner.ts`](/Users/tinnguyen/vesper/packages/shared/src/ralph-loop/loop-runner.ts) (lines 128-171, 335-349, 387-405).

### Session Integration

Sessions can link to task lists for coordinated work:

```typescript
// apps/electron/src/main/sessions.ts

// Set task list ID before agent.chat()
if (session.taskListId) {
  agent.setTaskListId(session.taskListId);
}

// Multiple sessions can share the same task list for parallel work
```

See [`apps/electron/src/main/sessions.ts`](/Users/tinnguyen/vesper/apps/electron/src/main/sessions.ts) (lines 2356-2363).

### IPC Communication

IPC handlers expose task list operations to the renderer process:

```typescript
// apps/electron/src/main/task-lists-ipc.ts

// Register IPC handlers
registerTaskListsIpc();

// Renderer can call via window.api.taskLists.*
const taskList = await window.api.taskLists.create(name, description);
const tasks = await window.api.taskLists.tasksList(taskListId);

// Listen for changes
window.api.on('task-lists:changed', (taskListId: string) => {
  // Refresh UI
});
```

See [`apps/electron/src/main/task-lists-ipc.ts`](/Users/tinnguyen/vesper/apps/electron/src/main/task-lists-ipc.ts).

---

## API Reference

### Task List CRUD

#### `createTaskList(name, description?)`

Create a new task list.

**Parameters:**
- `name` (string, required): Human-readable name (max 200 chars)
- `description` (string, optional): Optional description

**Returns:** `Promise<TaskList>`

**Throws:** `TaskListError` (INVALID_INPUT, IO_ERROR)

---

#### `loadTaskList(id)`

Load a task list from disk.

**Parameters:**
- `id` (string, required): Task list ID (UUID)

**Returns:** `Promise<TaskList | null>` (null if not found or corrupted)

---

#### `listTaskLists()`

List all task lists with metadata only (no tasks array).

**Returns:** `Promise<TaskListMeta[]>` (sorted by most recently updated first)

---

#### `deleteTaskList(id)`

Delete a task list.

**Parameters:**
- `id` (string, required): Task list ID (UUID)

**Returns:** `Promise<void>`

**Throws:** `TaskListError` (NOT_FOUND, IO_ERROR)

---

### Task CRUD

#### `createTask(taskListId, subject, description, activeForm?, metadata?)`

Create a new task in a task list.

**Parameters:**
- `taskListId` (string, required): Task list ID
- `subject` (string, required): Brief, actionable title (imperative form)
- `description` (string, required): Detailed requirements
- `activeForm` (string, optional): Present continuous form (defaults to subject)
- `metadata` (Record<string, unknown>, optional): Arbitrary metadata

**Returns:** `Promise<Task>`

**Throws:** `TaskListError` (INVALID_INPUT, NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)

---

#### `batchCreateTasks(taskListId, tasks)`

Batch create multiple tasks (for Ralph Loop upfront task creation).

**Parameters:**
- `taskListId` (string, required): Task list ID
- `tasks` (Array, required): Array of task input objects

**Task input object:**
- `subject` (string, required)
- `description` (string, required)
- `activeForm` (string, optional)
- `metadata` (Record<string, unknown>, optional)
- `blocks` (string[], optional)
- `blockedBy` (string[], optional)

**Returns:** `Promise<Task[]>`

**Throws:** `TaskListError` (INVALID_INPUT, NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)

---

#### `updateTask(taskListId, taskId, updates)`

Update a task.

**Parameters:**
- `taskListId` (string, required): Task list ID
- `taskId` (string, required): Task ID
- `updates` (object, required): Fields to update

**Updates object:**
- `subject` (string, optional)
- `description` (string, optional)
- `activeForm` (string, optional)
- `status` (TaskStatus, optional)
- `owner` (string, optional)
- `metadata` (Record<string, unknown>, optional): Merged with existing
- `addBlocks` (string[], optional): Task IDs to add to blocks
- `addBlockedBy` (string[], optional): Task IDs to add to blockedBy

**Returns:** `Promise<Task>`

**Throws:** `TaskListError` (NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)

---

#### `deleteTask(taskListId, taskId)`

Delete a task.

**Parameters:**
- `taskListId` (string, required): Task list ID
- `taskId` (string, required): Task ID

**Returns:** `Promise<void>`

**Throws:** `TaskListError` (NOT_FOUND, IO_ERROR, LOCK_TIMEOUT)

**Note:** Automatically removes task ID from dependency arrays in other tasks.

---

### Path Functions

#### `getTaskListsDir()`

Get the directory where task lists are stored.

**Returns:** `string` (`~/.vesper/task-lists`)

---

#### `getTaskListPath(id)`

Get the file path for a specific task list.

**Parameters:**
- `id` (string, required): Task list ID

**Returns:** `string` (`~/.vesper/task-lists/{id}.json`)

---

## Best Practices

### 1. Use Batch Operations

```typescript
// Good: Single file lock, single write
const tasks = await batchCreateTasks(taskListId, [
  { subject: 'Task 1', description: 'Desc 1' },
  { subject: 'Task 2', description: 'Desc 2' },
]);

// Bad: Multiple file locks, multiple writes
for (const data of taskData) {
  await createTask(taskListId, data.subject, data.description);
}
```

### 2. Always Handle Errors

```typescript
try {
  await createTask(taskListId, subject, description);
} catch (error) {
  if (error instanceof TaskListError) {
    // Handle specific error codes
  } else {
    throw error;
  }
}
```

### 3. Use Metadata for Extensibility

```typescript
await createTask(taskListId, subject, description, activeForm, {
  priority: 'high',
  labels: ['security'],
  customField: 'value',
});
```

### 4. Model Natural Dependencies

```typescript
// Good: Only block when necessary
await updateTask(taskListId, task2.id, {
  addBlockedBy: [task1.id],  // task2 truly depends on task1
});

// Bad: Over-blocking
await updateTask(taskListId, task3.id, {
  addBlockedBy: [task1.id, task2.id],  // task3 doesn't need both
});
```

### 5. Use listTaskLists() for Performance

```typescript
// Good: Fast, metadata only
const taskLists = await listTaskLists();

// Bad: Loads all tasks
const fullLists = await Promise.all(
  (await listTaskLists()).map(meta => loadTaskList(meta.id))
);
```

### 6. Non-Fatal Task Updates (Ralph Loop Pattern)

```typescript
try {
  await updateTask(taskListId, taskId, { status: 'completed' });
} catch (error) {
  console.error('Failed to update task:', error);
  // Continue processing (task update is not critical)
}
```

---

## Related Documentation

- **Architecture Guide:** [`docs/developer/task-lists-architecture.md`](/Users/tinnguyen/vesper/docs/developer/task-lists-architecture.md)
- **API Reference:** [`docs/api/task-lists.md`](/Users/tinnguyen/vesper/docs/api/task-lists.md)
- **User Manual:** [`docs/user-guide/task-lists.md`](/Users/tinnguyen/vesper/docs/user-guide/task-lists.md)

---

## Contributing

When contributing to the task lists package:

1. Maintain backward compatibility with existing types
2. Add unit tests for new functionality
3. Update this README with new features
4. Follow existing error handling patterns
5. Use file locking for all write operations

---

*Last Updated: 2026-01-25*
