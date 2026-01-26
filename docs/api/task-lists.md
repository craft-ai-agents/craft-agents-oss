# Task Lists API Reference

Core types and utilities for structured task management with dependencies, ownership, and metadata tracking.

## Table of Contents

- [Types](#types)
  - [TaskStatus](#taskstatus)
  - [Task](#task)
  - [TaskList](#tasklist)
  - [TaskListMeta](#tasklistmeta)
- [Error Handling](#error-handling)
  - [TaskListError](#tasklisterror)
  - [Error Codes](#error-codes)
- [Path Functions](#path-functions)
  - [getTaskListsDir()](#gettasklistsdir)
  - [getTaskListPath()](#gettasklistpath)
- [Task List CRUD](#task-list-crud)
  - [createTaskList()](#createtasklist)
  - [loadTaskList()](#loadtasklist)
  - [listTaskLists()](#listtasklists)
  - [deleteTaskList()](#deletetasklist)
- [Task CRUD](#task-crud)
  - [createTask()](#createtask)
  - [batchCreateTasks()](#batchcreatetasks)
  - [updateTask()](#updatetask)
  - [deleteTask()](#deletetask)
- [Best Practices](#best-practices)
- [Source Code](#source-code)

---

## Types

### TaskStatus

```typescript
type TaskStatus = 'pending' | 'in_progress' | 'completed';
```

Status of a task in its lifecycle.

- **`pending`**: Task has not been started yet
- **`in_progress`**: Task is currently being worked on
- **`completed`**: Task has been finished

**Example:**

```typescript
import type { TaskStatus } from '@vesper/shared/task-lists';

const status: TaskStatus = 'in_progress';
```

---

### Task

```typescript
interface Task {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  owner?: string;
  metadata?: Record<string, unknown>;
  blocks: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}
```

Represents a single task within a task list. Tasks can have dependencies on other tasks (`blockedBy`), block other tasks (`blocks`), and carry arbitrary metadata for extensibility.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for the task (UUID) |
| `subject` | `string` | Brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow") |
| `description` | `string` | Detailed description of what needs to be done, including context and acceptance criteria |
| `activeForm` | `string` | Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug") |
| `status` | `TaskStatus` | Current status of the task |
| `owner` | `string?` | Agent or user ID who owns/is assigned to this task (optional) |
| `metadata` | `Record<string, unknown>?` | Arbitrary metadata for extensibility (e.g., priority, labels, custom fields) |
| `blocks` | `string[]` | Task IDs that this task blocks (cannot start until this one completes) |
| `blockedBy` | `string[]` | Task IDs that block this task (must complete before this one can start) |
| `createdAt` | `string` | Timestamp when the task was created (ISO 8601) |
| `updatedAt` | `string` | Timestamp when the task was last updated (ISO 8601) |

**Example:**

```typescript
import type { Task } from '@vesper/shared/task-lists';

const task: Task = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  subject: 'Implement user authentication',
  description: 'Add JWT-based authentication with refresh tokens',
  activeForm: 'Implementing user authentication',
  status: 'in_progress',
  owner: 'agent-1',
  metadata: { priority: 'high', labels: ['security'] },
  blocks: ['550e8400-e29b-41d4-a716-446655440001'],
  blockedBy: [],
  createdAt: '2026-01-25T10:00:00Z',
  updatedAt: '2026-01-25T11:30:00Z',
};
```

---

### TaskList

```typescript
interface TaskList {
  id: string;
  name: string;
  description?: string;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}
```

Represents a complete task list with all tasks. Task lists organize related tasks and track their dependencies, ownership, and progress.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for the task list (UUID) |
| `name` | `string` | Human-readable name for the task list (e.g., "Q1 2026 Feature Development") |
| `description` | `string?` | Optional description providing context for the task list |
| `tasks` | `Task[]` | All tasks in this list |
| `createdAt` | `string` | Timestamp when the task list was created (ISO 8601) |
| `updatedAt` | `string` | Timestamp when the task list was last updated (ISO 8601) |

**Example:**

```typescript
import type { TaskList } from '@vesper/shared/task-lists';

const taskList: TaskList = {
  id: '660e8400-e29b-41d4-a716-446655440000',
  name: 'Sprint 1 - Authentication',
  description: 'First sprint focusing on user authentication features',
  tasks: [
    // ... Task objects
  ],
  createdAt: '2026-01-20T09:00:00Z',
  updatedAt: '2026-01-25T11:30:00Z',
};
```

---

### TaskListMeta

```typescript
interface TaskListMeta {
  id: string;
  name: string;
  description?: string;
  taskCount: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  createdAt: string;
  updatedAt: string;
}
```

Lightweight task list metadata for list views. Omits the full task array for performance when displaying multiple lists. Includes computed statistics for quick overview.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for the task list (UUID) |
| `name` | `string` | Human-readable name for the task list |
| `description` | `string?` | Optional description providing context for the task list |
| `taskCount` | `number` | Total number of tasks in the list |
| `pendingCount` | `number` | Number of tasks with status 'pending' |
| `inProgressCount` | `number` | Number of tasks with status 'in_progress' |
| `completedCount` | `number` | Number of tasks with status 'completed' |
| `createdAt` | `string` | Timestamp when the task list was created (ISO 8601) |
| `updatedAt` | `string` | Timestamp when the task list was last updated (ISO 8601) |

**Example:**

```typescript
import type { TaskListMeta } from '@vesper/shared/task-lists';

const meta: TaskListMeta = {
  id: '660e8400-e29b-41d4-a716-446655440000',
  name: 'Sprint 1 - Authentication',
  description: 'First sprint focusing on user authentication features',
  taskCount: 5,
  pendingCount: 2,
  inProgressCount: 2,
  completedCount: 1,
  createdAt: '2026-01-20T09:00:00Z',
  updatedAt: '2026-01-25T11:30:00Z',
};
```

---

## Error Handling

### TaskListError

```typescript
class TaskListError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA' | 'LOCK_TIMEOUT',
    public details?: unknown
  );
}
```

Custom error class for task list operations. Extends the standard `Error` class with structured error codes and optional details.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Human-readable error message |
| `code` | `ErrorCode` | Machine-readable error code (see [Error Codes](#error-codes)) |
| `details` | `unknown?` | Optional additional context (e.g., task IDs, original errors) |

**Example:**

```typescript
import { TaskListError } from '@vesper/shared/task-lists';

try {
  await loadTaskList('non-existent-id');
} catch (error) {
  if (error instanceof TaskListError) {
    console.error(`Error [${error.code}]: ${error.message}`, error.details);
  }
}
```

---

### Error Codes

| Code | Description | Thrown By |
|------|-------------|-----------|
| `NOT_FOUND` | Task list or task does not exist | `deleteTaskList()`, `createTask()`, `updateTask()`, `deleteTask()` |
| `INVALID_INPUT` | Invalid parameters (empty name, missing fields, etc.) | `createTaskList()`, `createTask()`, `batchCreateTasks()` |
| `IO_ERROR` | File system operation failed | All CRUD operations |
| `CORRUPT_DATA` | Task list file structure is invalid | `loadTaskList()`, `listTaskLists()` |
| `LOCK_TIMEOUT` | Failed to acquire file lock after retries | Task CRUD operations |

---

## Path Functions

### getTaskListsDir()

```typescript
function getTaskListsDir(): string
```

Get the directory where task lists are stored.

**Returns:**

- `string` - Absolute path to task lists directory (`~/.vesper/task-lists`)

**Example:**

```typescript
import { getTaskListsDir } from '@vesper/shared/task-lists';

const dir = getTaskListsDir();
console.log(dir); // "/Users/username/.vesper/task-lists"
```

---

### getTaskListPath()

```typescript
function getTaskListPath(id: string): string
```

Get the file path for a specific task list.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Task list ID (UUID) |

**Returns:**

- `string` - Absolute path to task list JSON file

**Example:**

```typescript
import { getTaskListPath } from '@vesper/shared/task-lists';

const path = getTaskListPath('660e8400-e29b-41d4-a716-446655440000');
console.log(path); // "/Users/username/.vesper/task-lists/660e8400-e29b-41d4-a716-446655440000.json"
```

---

## Task List CRUD

### createTaskList()

```typescript
async function createTaskList(
  name: string,
  description?: string
): Promise<TaskList>
```

Create a new task list.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Human-readable name for the task list (max 200 chars, required) |
| `description` | `string?` | Optional description providing context |

**Returns:**

- `Promise<TaskList>` - Newly created task list with empty tasks array

**Throws:**

- `TaskListError` with code `INVALID_INPUT` if name is empty or too long
- `TaskListError` with code `IO_ERROR` if file system operation fails

**Example:**

```typescript
import { createTaskList } from '@vesper/shared/task-lists';

try {
  const taskList = await createTaskList(
    'Sprint 1 - Authentication',
    'First sprint focusing on user authentication features'
  );
  console.log('Created task list:', taskList.id);
} catch (error) {
  if (error instanceof TaskListError) {
    console.error('Failed to create task list:', error.message);
  }
}
```

---

### loadTaskList()

```typescript
async function loadTaskList(id: string): Promise<TaskList | null>
```

Load a task list from disk.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Task list ID (UUID) |

**Returns:**

- `Promise<TaskList | null>` - Task list object if found, `null` if not found or corrupted

**Notes:**

- Returns `null` for missing files (not an error)
- Logs corruption errors to console but returns `null`
- Validates task list structure (id, name, tasks array)

**Example:**

```typescript
import { loadTaskList } from '@vesper/shared/task-lists';

const taskList = await loadTaskList('660e8400-e29b-41d4-a716-446655440000');
if (taskList) {
  console.log(`Loaded "${taskList.name}" with ${taskList.tasks.length} tasks`);
} else {
  console.log('Task list not found');
}
```

---

### listTaskLists()

```typescript
async function listTaskLists(): Promise<TaskListMeta[]>
```

List all task lists with metadata only (no tasks array).

**Returns:**

- `Promise<TaskListMeta[]>` - Array of task list metadata, sorted by most recently updated first

**Notes:**

- Creates task lists directory if it doesn't exist
- Skips hidden files (starting with `.`)
- Logs corruption errors but continues processing other files
- Computes statistics (pending/in-progress/completed counts)

**Example:**

```typescript
import { listTaskLists } from '@vesper/shared/task-lists';

const taskLists = await listTaskLists();
console.log(`Found ${taskLists.length} task lists`);

for (const meta of taskLists) {
  console.log(`${meta.name}: ${meta.completedCount}/${meta.taskCount} completed`);
}
```

---

### deleteTaskList()

```typescript
async function deleteTaskList(id: string): Promise<void>
```

Delete a task list.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Task list ID (UUID) |

**Returns:**

- `Promise<void>` - Resolves when deletion is complete

**Throws:**

- `TaskListError` with code `NOT_FOUND` if task list does not exist
- `TaskListError` with code `IO_ERROR` if file system operation fails

**Example:**

```typescript
import { deleteTaskList } from '@vesper/shared/task-lists';

try {
  await deleteTaskList('660e8400-e29b-41d4-a716-446655440000');
  console.log('Task list deleted successfully');
} catch (error) {
  if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
    console.log('Task list already deleted');
  }
}
```

---

## Task CRUD

### createTask()

```typescript
async function createTask(
  taskListId: string,
  subject: string,
  description: string,
  activeForm?: string,
  metadata?: Record<string, unknown>
): Promise<Task>
```

Create a new task in a task list.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskListId` | `string` | Task list ID (UUID) |
| `subject` | `string` | Brief, actionable title in imperative form (required) |
| `description` | `string` | Detailed description of what needs to be done (required) |
| `activeForm` | `string?` | Present continuous form (defaults to subject if not provided) |
| `metadata` | `Record<string, unknown>?` | Arbitrary metadata (priority, labels, etc.) |

**Returns:**

- `Promise<Task>` - Newly created task with status `'pending'`

**Throws:**

- `TaskListError` with code `INVALID_INPUT` if subject or description is empty
- `TaskListError` with code `NOT_FOUND` if task list does not exist
- `TaskListError` with code `IO_ERROR` if file system operation fails
- `TaskListError` with code `LOCK_TIMEOUT` if file lock cannot be acquired

**Notes:**

- Uses file-based locking for concurrent safety
- Automatically trims whitespace from subject, description, and activeForm
- Sets `blocks` and `blockedBy` to empty arrays

**Example:**

```typescript
import { createTask } from '@vesper/shared/task-lists';

const task = await createTask(
  '660e8400-e29b-41d4-a716-446655440000',
  'Implement JWT authentication',
  'Add JWT-based authentication with refresh tokens and proper expiry handling',
  'Implementing JWT authentication',
  { priority: 'high', labels: ['security', 'backend'] }
);

console.log('Created task:', task.id);
```

---

### batchCreateTasks()

```typescript
async function batchCreateTasks(
  taskListId: string,
  tasks: Array<{
    subject: string;
    description: string;
    activeForm?: string;
    metadata?: Record<string, unknown>;
    blocks?: string[];
    blockedBy?: string[];
  }>
): Promise<Task[]>
```

Batch create multiple tasks (for Ralph Loop upfront task creation).

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskListId` | `string` | Task list ID (UUID) |
| `tasks` | `TaskInput[]` | Array of task input objects (required, non-empty) |

**TaskInput Object:**

| Field | Type | Description |
|-------|------|-------------|
| `subject` | `string` | Brief, actionable title in imperative form (required) |
| `description` | `string` | Detailed description of what needs to be done (required) |
| `activeForm` | `string?` | Present continuous form (defaults to subject if not provided) |
| `metadata` | `Record<string, unknown>?` | Arbitrary metadata |
| `blocks` | `string[]?` | Task IDs that this task blocks (defaults to empty array) |
| `blockedBy` | `string[]?` | Task IDs that block this task (defaults to empty array) |

**Returns:**

- `Promise<Task[]>` - Array of newly created tasks with status `'pending'`

**Throws:**

- `TaskListError` with code `INVALID_INPUT` if tasks array is empty or any task is missing subject/description
- `TaskListError` with code `NOT_FOUND` if task list does not exist
- `TaskListError` with code `IO_ERROR` if file system operation fails
- `TaskListError` with code `LOCK_TIMEOUT` if file lock cannot be acquired

**Notes:**

- Uses file-based locking for concurrent safety
- Validates all tasks before creating any
- All tasks share the same `createdAt` timestamp
- More efficient than calling `createTask()` multiple times

**Example:**

```typescript
import { batchCreateTasks } from '@vesper/shared/task-lists';

const tasks = await batchCreateTasks(
  '660e8400-e29b-41d4-a716-446655440000',
  [
    {
      subject: 'Design database schema',
      description: 'Create ERD and migration scripts for user tables',
      metadata: { priority: 'high' },
    },
    {
      subject: 'Implement user registration',
      description: 'Create API endpoint for user signup with validation',
      blockedBy: ['task-id-from-previous-create'],
      metadata: { priority: 'medium' },
    },
    {
      subject: 'Add email verification',
      description: 'Send verification emails and implement confirmation flow',
      metadata: { priority: 'low' },
    },
  ]
);

console.log(`Created ${tasks.length} tasks`);
```

---

### updateTask()

```typescript
async function updateTask(
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
): Promise<Task>
```

Update a task.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskListId` | `string` | Task list ID (UUID) |
| `taskId` | `string` | Task ID (UUID) |
| `updates` | `TaskUpdates` | Fields to update (see below) |

**TaskUpdates Object:**

| Field | Type | Description |
|-------|------|-------------|
| `subject` | `string?` | New task subject |
| `description` | `string?` | New task description |
| `activeForm` | `string?` | New active form text |
| `status` | `TaskStatus?` | New task status |
| `owner` | `string?` | New owner ID |
| `metadata` | `Record<string, unknown>?` | Metadata to merge (existing + new) |
| `addBlocks` | `string[]?` | Task IDs to add to blocks array (duplicates ignored) |
| `addBlockedBy` | `string[]?` | Task IDs to add to blockedBy array (duplicates ignored) |

**Returns:**

- `Promise<Task>` - Updated task object

**Throws:**

- `TaskListError` with code `NOT_FOUND` if task list or task does not exist
- `TaskListError` with code `IO_ERROR` if file system operation fails
- `TaskListError` with code `LOCK_TIMEOUT` if file lock cannot be acquired

**Notes:**

- Uses file-based locking for concurrent safety
- Text fields are automatically trimmed
- Metadata is merged (not replaced)
- Dependencies are additive only (no removal API)
- Updates `updatedAt` timestamp

**Example:**

```typescript
import { updateTask } from '@vesper/shared/task-lists';

// Mark task as in progress and assign owner
const task = await updateTask(
  '660e8400-e29b-41d4-a716-446655440000',
  '550e8400-e29b-41d4-a716-446655440000',
  {
    status: 'in_progress',
    owner: 'agent-1',
    metadata: { startedAt: new Date().toISOString() },
  }
);

// Add dependencies
await updateTask(
  '660e8400-e29b-41d4-a716-446655440000',
  '550e8400-e29b-41d4-a716-446655440000',
  {
    addBlockedBy: ['task-id-1', 'task-id-2'],
  }
);

// Mark as completed
await updateTask(
  '660e8400-e29b-41d4-a716-446655440000',
  '550e8400-e29b-41d4-a716-446655440000',
  {
    status: 'completed',
  }
);
```

---

### deleteTask()

```typescript
async function deleteTask(
  taskListId: string,
  taskId: string
): Promise<void>
```

Delete a task.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `taskListId` | `string` | Task list ID (UUID) |
| `taskId` | `string` | Task ID (UUID) |

**Returns:**

- `Promise<void>` - Resolves when deletion is complete

**Throws:**

- `TaskListError` with code `NOT_FOUND` if task list or task does not exist
- `TaskListError` with code `IO_ERROR` if file system operation fails
- `TaskListError` with code `LOCK_TIMEOUT` if file lock cannot be acquired

**Notes:**

- Uses file-based locking for concurrent safety
- Automatically removes task ID from all dependency arrays (`blocks`, `blockedBy`) in other tasks
- Updates task list `updatedAt` timestamp

**Example:**

```typescript
import { deleteTask } from '@vesper/shared/task-lists';

try {
  await deleteTask(
    '660e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440000'
  );
  console.log('Task deleted successfully');
} catch (error) {
  if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
    console.log('Task already deleted');
  }
}
```

---

## Best Practices

### 1. Error Handling

Always catch `TaskListError` and check error codes:

```typescript
import { createTask, TaskListError } from '@vesper/shared/task-lists';

try {
  const task = await createTask(taskListId, subject, description);
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
      default:
        console.error('Unknown error:', error.message);
    }
  } else {
    throw error; // Rethrow unexpected errors
  }
}
```

### 2. Batch Operations

Use `batchCreateTasks()` for creating multiple tasks at once:

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

### 3. Metadata Management

Use metadata for extensible task properties:

```typescript
await createTask(taskListId, subject, description, activeForm, {
  priority: 'high',
  labels: ['security', 'backend'],
  estimatedHours: 8,
  assignee: 'john@example.com',
  dueDate: '2026-02-01',
  customField: 'custom value',
});

// Update metadata (merges with existing)
await updateTask(taskListId, taskId, {
  metadata: {
    completedAt: new Date().toISOString(),
    actualHours: 6,
  },
});
```

### 4. Dependency Management

Build dependency graphs with `blocks` and `blockedBy`:

```typescript
// Create tasks first
const task1 = await createTask(taskListId, 'Design schema', 'Create ERD');
const task2 = await createTask(taskListId, 'Implement API', 'Build endpoints');
const task3 = await createTask(taskListId, 'Add tests', 'Write integration tests');

// Set up dependencies (task2 depends on task1, task3 depends on task2)
await updateTask(taskListId, task2.id, { addBlockedBy: [task1.id] });
await updateTask(taskListId, task3.id, { addBlockedBy: [task2.id] });

// Or use batchCreateTasks with dependencies
const [t1, t2, t3] = await batchCreateTasks(taskListId, [
  { subject: 'Design schema', description: 'Create ERD' },
  {
    subject: 'Implement API',
    description: 'Build endpoints',
    // Can't reference t1.id yet, so set dependencies in a second pass
  },
  { subject: 'Add tests', description: 'Write integration tests' },
]);

await updateTask(taskListId, t2.id, { addBlockedBy: [t1.id] });
await updateTask(taskListId, t3.id, { addBlockedBy: [t2.id] });
```

### 5. List View Performance

Use `listTaskLists()` for overview pages:

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

### 6. Task Status Workflow

Follow the standard workflow: `pending` → `in_progress` → `completed`:

```typescript
// Claim and start a task
await updateTask(taskListId, taskId, {
  status: 'in_progress',
  owner: 'agent-1',
  metadata: { startedAt: new Date().toISOString() },
});

// Complete the task
await updateTask(taskListId, taskId, {
  status: 'completed',
  metadata: { completedAt: new Date().toISOString() },
});
```

### 7. Concurrent Updates

The storage layer uses file-based locking to prevent race conditions:

```typescript
// Safe: Both agents can update different tasks concurrently
await Promise.all([
  updateTask(taskListId, task1Id, { status: 'in_progress', owner: 'agent-1' }),
  updateTask(taskListId, task2Id, { status: 'in_progress', owner: 'agent-2' }),
]);

// Safe: Lock prevents corruption even with same task
await Promise.all([
  updateTask(taskListId, taskId, { metadata: { field1: 'value1' } }),
  updateTask(taskListId, taskId, { metadata: { field2: 'value2' } }),
]);
// Result: Last write wins (not ideal, but no corruption)
```

---

## Source Code

**Types:** [`packages/shared/src/task-lists/types.ts`](../../packages/shared/src/task-lists/types.ts)

**Storage & CRUD:** [`packages/shared/src/task-lists/storage.ts`](../../packages/shared/src/task-lists/storage.ts)

**Public Exports:** [`packages/shared/src/task-lists/index.ts`](../../packages/shared/src/task-lists/index.ts)

---

*Last Updated: 2026-01-25*
