// packages/shared/src/task-lists/storage.ts

import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import lockfile from 'proper-lockfile';
import type { TaskList, Task, TaskListMeta, TaskStatus } from './types';

const VESPER_DIR = join(homedir(), '.vesper');

/**
 * Custom error class for task list operations
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

/**
 * Get the directory where task lists are stored
 */
export function getTaskListsDir(): string {
  return join(VESPER_DIR, 'task-lists');
}

/**
 * Get the file path for a specific task list
 */
export function getTaskListPath(id: string): string {
  return join(getTaskListsDir(), `${id}.json`);
}

/**
 * Load a task list from disk
 */
export async function loadTaskList(id: string): Promise<TaskList | null> {
  try {
    const filePath = getTaskListPath(id);
    const content = await readFile(filePath, 'utf-8');
    const taskList = JSON.parse(content) as TaskList;

    // Validate task list structure
    if (!taskList.id || !taskList.name || !Array.isArray(taskList.tasks)) {
      throw new TaskListError('Invalid task list structure', 'CORRUPT_DATA', { id });
    }

    return taskList;
  } catch (error) {
    // Return null for not found, but log corruption errors
    if (error instanceof TaskListError) {
      console.error(`[TaskLists] ${error.message}`, error.details);
    }
    return null;
  }
}

/**
 * Save a task list to disk
 */
async function saveTaskList(taskList: TaskList): Promise<void> {
  const filePath = getTaskListPath(taskList.id);
  await writeFile(filePath, JSON.stringify(taskList, null, 2));
}

/**
 * List all task lists with metadata only (no tasks array)
 */
export async function listTaskLists(): Promise<TaskListMeta[]> {
  const taskListsMeta: TaskListMeta[] = [];
  const errors: TaskListError[] = [];

  try {
    const dir = getTaskListsDir();
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);

    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const taskList = JSON.parse(content) as TaskList;

          // Validate task list structure
          if (!taskList.id || !taskList.name || !Array.isArray(taskList.tasks)) {
            throw new Error('Invalid task list structure: missing required fields');
          }

          // Compute statistics
          const pendingCount = taskList.tasks.filter(t => t.status === 'pending').length;
          const inProgressCount = taskList.tasks.filter(t => t.status === 'in_progress').length;
          const completedCount = taskList.tasks.filter(t => t.status === 'completed').length;

          taskListsMeta.push({
            id: taskList.id,
            name: taskList.name,
            description: taskList.description,
            taskCount: taskList.tasks.length,
            pendingCount,
            inProgressCount,
            completedCount,
            createdAt: taskList.createdAt,
            updatedAt: taskList.updatedAt,
          });
        } catch (error) {
          errors.push(
            new TaskListError(
              `Failed to load task list ${file}`,
              'CORRUPT_DATA',
              { file, error }
            )
          );
        }
      }
    }
  } catch (error) {
    errors.push(
      new TaskListError(
        'Failed to read task lists directory',
        'IO_ERROR',
        { error }
      )
    );
  }

  // Log errors but don't fail the entire operation
  errors.forEach(error => {
    console.error(`[TaskLists] ${error.message}`, error.details);
  });

  // Sort by most recently updated first
  return taskListsMeta.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Create a new task list
 */
export async function createTaskList(
  name: string,
  description?: string
): Promise<TaskList> {
  if (!name || name.trim().length === 0) {
    throw new TaskListError('Task list name is required', 'INVALID_INPUT');
  }
  if (name.length > 200) {
    throw new TaskListError('Task list name too long (max 200 chars)', 'INVALID_INPUT');
  }

  const taskList: TaskList = {
    id: uuidv4(),
    name: name.trim(),
    description,
    tasks: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const dir = getTaskListsDir();
    await mkdir(dir, { recursive: true });

    const filePath = getTaskListPath(taskList.id);

    // Check if file already exists (shouldn't happen with UUID, but be safe)
    if (existsSync(filePath)) {
      throw new TaskListError('Task list already exists', 'INVALID_INPUT');
    }

    await saveTaskList(taskList);
    return taskList;
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to create task list',
      'IO_ERROR',
      { originalError: error }
    );
  }
}

/**
 * Delete a task list
 */
export async function deleteTaskList(id: string): Promise<void> {
  const filePath = getTaskListPath(id);

  try {
    // Check if task list exists first
    if (!existsSync(filePath)) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { id });
    }

    await unlink(filePath);
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to delete task list',
      'IO_ERROR',
      { id, originalError: error }
    );
  }
}

/**
 * Create a new task in a task list
 */
export async function createTask(
  taskListId: string,
  subject: string,
  description: string,
  activeForm?: string,
  metadata?: Record<string, unknown>
): Promise<Task> {
  if (!subject || subject.trim().length === 0) {
    throw new TaskListError('Task subject is required', 'INVALID_INPUT');
  }
  if (!description || description.trim().length === 0) {
    throw new TaskListError('Task description is required', 'INVALID_INPUT');
  }

  const task: Task = {
    id: uuidv4(),
    subject: subject.trim(),
    description: description.trim(),
    activeForm: activeForm?.trim() || subject.trim(),
    status: 'pending',
    metadata,
    blocks: [],
    blockedBy: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const filePath = getTaskListPath(taskListId);
  let release: (() => Promise<void>) | null = null;

  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const taskList = await loadTaskList(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    taskList.tasks.push(task);
    taskList.updatedAt = new Date().toISOString();

    await saveTaskList(taskList);
    return task;
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to create task',
      'IO_ERROR',
      { taskListId, originalError: error }
    );
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Batch create multiple tasks (for Ralph Loop upfront task creation)
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
): Promise<Task[]> {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new TaskListError('Tasks array is required and must not be empty', 'INVALID_INPUT');
  }

  // Validate all tasks first
  for (const task of tasks) {
    if (!task.subject || task.subject.trim().length === 0) {
      throw new TaskListError('All tasks must have a subject', 'INVALID_INPUT');
    }
    if (!task.description || task.description.trim().length === 0) {
      throw new TaskListError('All tasks must have a description', 'INVALID_INPUT');
    }
  }

  const filePath = getTaskListPath(taskListId);
  let release: (() => Promise<void>) | null = null;

  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const taskList = await loadTaskList(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    const now = new Date().toISOString();
    const createdTasks: Task[] = [];

    for (const taskData of tasks) {
      const task: Task = {
        id: uuidv4(),
        subject: taskData.subject.trim(),
        description: taskData.description.trim(),
        activeForm: taskData.activeForm?.trim() || taskData.subject.trim(),
        status: 'pending',
        metadata: taskData.metadata,
        blocks: taskData.blocks || [],
        blockedBy: taskData.blockedBy || [],
        createdAt: now,
        updatedAt: now,
      };
      createdTasks.push(task);
      taskList.tasks.push(task);
    }

    taskList.updatedAt = now;
    await saveTaskList(taskList);

    return createdTasks;
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to batch create tasks',
      'IO_ERROR',
      { taskListId, taskCount: tasks.length, originalError: error }
    );
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Update a task
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
): Promise<Task> {
  const filePath = getTaskListPath(taskListId);
  let release: (() => Promise<void>) | null = null;

  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const taskList = await loadTaskList(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    const task = taskList.tasks.find(t => t.id === taskId);
    if (!task) {
      throw new TaskListError('Task not found', 'NOT_FOUND', { taskListId, taskId });
    }

    // Apply updates
    if (updates.subject !== undefined) task.subject = updates.subject.trim();
    if (updates.description !== undefined) task.description = updates.description.trim();
    if (updates.activeForm !== undefined) task.activeForm = updates.activeForm.trim();
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.owner !== undefined) task.owner = updates.owner;
    if (updates.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...updates.metadata };
    }

    // Handle dependency updates (additive only)
    if (updates.addBlocks) {
      const newBlocks = updates.addBlocks.filter(id => !task.blocks.includes(id));
      task.blocks.push(...newBlocks);
    }
    if (updates.addBlockedBy) {
      const newBlockedBy = updates.addBlockedBy.filter(id => !task.blockedBy.includes(id));
      task.blockedBy.push(...newBlockedBy);
    }

    task.updatedAt = new Date().toISOString();
    taskList.updatedAt = task.updatedAt;

    await saveTaskList(taskList);
    return task;
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to update task',
      'IO_ERROR',
      { taskListId, taskId, originalError: error }
    );
  } finally {
    if (release) {
      await release();
    }
  }
}

/**
 * Delete a task
 */
export async function deleteTask(
  taskListId: string,
  taskId: string
): Promise<void> {
  const filePath = getTaskListPath(taskListId);
  let release: (() => Promise<void>) | null = null;

  try {
    // Acquire lock with retry
    release = await lockfile.lock(filePath, {
      stale: 5000,
      retries: { retries: 5, minTimeout: 50 }
    });

    const taskList = await loadTaskList(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    const taskIndex = taskList.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      throw new TaskListError('Task not found', 'NOT_FOUND', { taskListId, taskId });
    }

    // Remove the task
    taskList.tasks.splice(taskIndex, 1);

    // Remove task from all dependency arrays
    for (const task of taskList.tasks) {
      task.blocks = task.blocks.filter(id => id !== taskId);
      task.blockedBy = task.blockedBy.filter(id => id !== taskId);
    }

    taskList.updatedAt = new Date().toISOString();
    await saveTaskList(taskList);
  } catch (error) {
    if (error instanceof TaskListError) throw error;

    throw new TaskListError(
      'Failed to delete task',
      'IO_ERROR',
      { taskListId, taskId, originalError: error }
    );
  } finally {
    if (release) {
      await release();
    }
  }
}
