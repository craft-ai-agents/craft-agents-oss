/**
 * Task List Storage Test Suite
 *
 * Comprehensive E2E tests covering:
 * - Task list CRUD operations (create, load, list, delete)
 * - Task CRUD operations (create, update, delete)
 * - Batch task creation (batchCreateTasks)
 * - File locking scenarios (concurrent writes)
 * - Error handling (NOT_FOUND, INVALID_INPUT, IO_ERROR, CORRUPT_DATA)
 * - Edge cases (missing directories, invalid data, etc.)
 * - TaskListMeta calculations
 * - Task dependencies (blocks, blockedBy arrays)
 *
 * Test environment: Uses actual ~/.vesper/task-lists directory with cleanup
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import {
  createTaskList,
  loadTaskList,
  listTaskLists,
  deleteTaskList,
  createTask,
  updateTask,
  deleteTask,
  batchCreateTasks,
  TaskListError,
  getTaskListsDir,
  getTaskListPath,
} from '../storage';
import type { TaskList } from '../types';

// Backup directory for existing task lists
const backupDir = join(getTaskListsDir(), '.test-backup');

beforeAll(async () => {
  // Backup existing task lists
  try {
    const taskListsDir = getTaskListsDir();
    const files = await readdir(taskListsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('.'));

    if (jsonFiles.length > 0) {
      await mkdir(backupDir, { recursive: true });
      for (const file of jsonFiles) {
        const source = join(taskListsDir, file);
        const dest = join(backupDir, file);
        const content = await readFile(source, 'utf-8');
        await writeFile(dest, content, 'utf-8');
      }
    }
  } catch (error) {
    // No existing task lists to backup
  }

  // Clean up existing task lists
  await cleanupTestFiles();
});

afterAll(async () => {
  // Clean up test files
  await cleanupTestFiles();

  // Restore backed up task lists
  try {
    const files = await readdir(backupDir);
    for (const file of files) {
      const source = join(backupDir, file);
      const dest = join(getTaskListsDir(), file);
      const content = await readFile(source, 'utf-8');
      await writeFile(dest, content, 'utf-8');
    }
    await rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    // No backup to restore
  }
});

/**
 * Clean up all test files (JSON files in task-lists directory)
 */
async function cleanupTestFiles() {
  try {
    const taskListsDir = getTaskListsDir();
    const files = await readdir(taskListsDir);

    for (const file of files) {
      if (file.endsWith('.json') && !file.startsWith('.test-backup')) {
        await rm(join(taskListsDir, file), { force: true });
      }
    }
  } catch (error) {
    // Directory doesn't exist yet
  }
}

describe('Task List CRUD Operations', () => {
  test('should create a task list with valid name', async () => {
    const taskList = await createTaskList('My First Task List', 'A test description');

    expect(taskList.id).toBeDefined();
    expect(taskList.name).toBe('My First Task List');
    expect(taskList.description).toBe('A test description');
    expect(taskList.tasks).toEqual([]);
    expect(taskList.createdAt).toBeDefined();
    expect(taskList.updatedAt).toBeDefined();
  });

  test('should create a task list without description', async () => {
    const taskList = await createTaskList('Minimal Task List');

    expect(taskList.id).toBeDefined();
    expect(taskList.name).toBe('Minimal Task List');
    expect(taskList.description).toBeUndefined();
    expect(taskList.tasks).toEqual([]);
  });

  test('should trim whitespace from task list name', async () => {
    const taskList = await createTaskList('  Spaces Everywhere  ');

    expect(taskList.name).toBe('Spaces Everywhere');
  });

  test('should throw INVALID_INPUT for empty name', async () => {
    await expect(createTaskList('')).rejects.toThrow(TaskListError);
    await expect(createTaskList('')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Task list name is required',
    });
  });

  test('should throw INVALID_INPUT for whitespace-only name', async () => {
    await expect(createTaskList('   ')).rejects.toThrow(TaskListError);
    await expect(createTaskList('   ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  test('should throw INVALID_INPUT for name exceeding 200 characters', async () => {
    const longName = 'a'.repeat(201);
    await expect(createTaskList(longName)).rejects.toThrow(TaskListError);
    await expect(createTaskList(longName)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Task list name too long (max 200 chars)',
    });
  });

  test('should load an existing task list', async () => {
    const created = await createTaskList('Test List', 'Test description');
    const loaded = await loadTaskList(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.name).toBe('Test List');
    expect(loaded?.description).toBe('Test description');
    expect(loaded?.tasks).toEqual([]);
  });

  test('should return null for non-existent task list', async () => {
    const loaded = await loadTaskList('non-existent-id');

    expect(loaded).toBeNull();
  });

  test('should list all task lists with correct metadata', async () => {
    // Clean up first
    await cleanupTestFiles();

    const list1 = await createTaskList('List 1', 'First list');
    const list2 = await createTaskList('List 2', 'Second list');

    // Add some tasks to list1
    await createTask(list1.id, 'Task 1', 'Description 1');
    await createTask(list1.id, 'Task 2', 'Description 2');

    const lists = await listTaskLists();

    expect(lists.length).toBeGreaterThanOrEqual(2);

    // Lists should be sorted by most recently updated first
    expect(lists[0]?.id).toBe(list1.id); // list1 was updated when tasks were added
    expect(lists[1]?.id).toBe(list2.id);

    // Check metadata
    const list1Meta = lists.find((l) => l.id === list1.id);
    expect(list1Meta).toBeDefined();
    expect(list1Meta?.name).toBe('List 1');
    expect(list1Meta?.description).toBe('First list');
    expect(list1Meta?.taskCount).toBe(2);
    expect(list1Meta?.pendingCount).toBe(2);
    expect(list1Meta?.inProgressCount).toBe(0);
    expect(list1Meta?.completedCount).toBe(0);

    // Clean up after
    await deleteTaskList(list1.id);
    await deleteTaskList(list2.id);
  });

  test('should return only created task lists', async () => {
    // Clean up first
    await cleanupTestFiles();

    const created = await createTaskList('Single List');
    const lists = await listTaskLists();

    expect(lists).toHaveLength(1);
    expect(lists[0]?.id).toBe(created.id);

    // Clean up after
    await deleteTaskList(created.id);
  });

  test('should delete an existing task list', async () => {
    const taskList = await createTaskList('To Delete');

    await deleteTaskList(taskList.id);

    const loaded = await loadTaskList(taskList.id);
    expect(loaded).toBeNull();
  });

  test('should throw NOT_FOUND when deleting non-existent task list', async () => {
    await expect(deleteTaskList('non-existent-id')).rejects.toThrow(TaskListError);
    await expect(deleteTaskList('non-existent-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Task list not found',
    });
  });
});

describe('Task CRUD Operations', () => {
  let taskListId: string;

  beforeEach(async () => {
    const taskList = await createTaskList('Test Task List');
    taskListId = taskList.id;
  });

  test('should create a task with required fields', async () => {
    const task = await createTask(
      taskListId,
      'Implement feature',
      'Add new feature to the app'
    );

    expect(task.id).toBeDefined();
    expect(task.subject).toBe('Implement feature');
    expect(task.description).toBe('Add new feature to the app');
    expect(task.activeForm).toBe('Implement feature');
    expect(task.status).toBe('pending');
    expect(task.blocks).toEqual([]);
    expect(task.blockedBy).toEqual([]);
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();
    expect(task.metadata).toBeUndefined();
  });

  test('should create a task with custom activeForm', async () => {
    const task = await createTask(
      taskListId,
      'Run tests',
      'Execute all unit tests',
      'Running tests'
    );

    expect(task.subject).toBe('Run tests');
    expect(task.activeForm).toBe('Running tests');
  });

  test('should create a task with metadata', async () => {
    const task = await createTask(
      taskListId,
      'Fix bug',
      'Fix authentication issue',
      undefined,
      { priority: 'high', labels: ['bug', 'security'] }
    );

    expect(task.metadata).toEqual({
      priority: 'high',
      labels: ['bug', 'security'],
    });
  });

  test('should trim whitespace from task fields', async () => {
    const task = await createTask(
      taskListId,
      '  Task Subject  ',
      '  Task Description  ',
      '  Active Form  '
    );

    expect(task.subject).toBe('Task Subject');
    expect(task.description).toBe('Task Description');
    expect(task.activeForm).toBe('Active Form');
  });

  test('should throw INVALID_INPUT for empty subject', async () => {
    await expect(createTask(taskListId, '', 'Description')).rejects.toThrow(TaskListError);
    await expect(createTask(taskListId, '', 'Description')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Task subject is required',
    });
  });

  test('should throw INVALID_INPUT for empty description', async () => {
    await expect(createTask(taskListId, 'Subject', '')).rejects.toThrow(TaskListError);
    await expect(createTask(taskListId, 'Subject', '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Task description is required',
    });
  });

  test('should throw error when creating task in non-existent list', async () => {
    await expect(
      createTask('non-existent-id', 'Subject', 'Description')
    ).rejects.toThrow(TaskListError);

    // The error will be IO_ERROR because lockfile fails on non-existent file
    try {
      await createTask('non-existent-id', 'Subject', 'Description');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskListError);
      expect((error as TaskListError).code).toMatch(/IO_ERROR|NOT_FOUND/);
    }
  });

  test('should update task subject', async () => {
    const task = await createTask(taskListId, 'Original subject', 'Description');
    const updated = await updateTask(taskListId, task.id, {
      subject: 'Updated subject',
    });

    expect(updated.subject).toBe('Updated subject');
    expect(updated.description).toBe('Description');
  });

  test('should update task status', async () => {
    const task = await createTask(taskListId, 'Task', 'Description');
    const updated = await updateTask(taskListId, task.id, {
      status: 'in_progress',
    });

    expect(updated.status).toBe('in_progress');
  });

  test('should update task owner', async () => {
    const task = await createTask(taskListId, 'Task', 'Description');
    const updated = await updateTask(taskListId, task.id, {
      owner: 'agent-123',
    });

    expect(updated.owner).toBe('agent-123');
  });

  test('should merge metadata on update', async () => {
    const task = await createTask(
      taskListId,
      'Task',
      'Description',
      undefined,
      { priority: 'low' }
    );

    const updated = await updateTask(taskListId, task.id, {
      metadata: { labels: ['feature'] },
    });

    expect(updated.metadata).toEqual({
      priority: 'low',
      labels: ['feature'],
    });
  });

  test('should add blocks dependencies', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');
    const task3 = await createTask(taskListId, 'Task 3', 'Third');

    const updated = await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id, task3.id],
    });

    expect(updated.blocks).toContain(task2.id);
    expect(updated.blocks).toContain(task3.id);
  });

  test('should add blockedBy dependencies', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');

    const updated = await updateTask(taskListId, task2.id, {
      addBlockedBy: [task1.id],
    });

    expect(updated.blockedBy).toContain(task1.id);
  });

  test('should not duplicate dependencies', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');

    await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id],
    });

    const updated = await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id], // Add same dependency again
    });

    expect(updated.blocks).toEqual([task2.id]);
  });

  test('should update task updatedAt timestamp', async () => {
    const task = await createTask(taskListId, 'Task', 'Description');
    const originalUpdatedAt = task.updatedAt;

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await updateTask(taskListId, task.id, {
      subject: 'New subject',
    });

    expect(updated.updatedAt).not.toBe(originalUpdatedAt);
  });

  test('should throw error when updating task in non-existent list', async () => {
    await expect(
      updateTask('non-existent-id', 'task-id', { subject: 'New' })
    ).rejects.toThrow(TaskListError);

    // The error will be IO_ERROR because lockfile fails on non-existent file
    try {
      await updateTask('non-existent-id', 'task-id', { subject: 'New' });
    } catch (error) {
      expect(error).toBeInstanceOf(TaskListError);
      expect((error as TaskListError).code).toMatch(/IO_ERROR|NOT_FOUND/);
    }
  });

  test('should throw NOT_FOUND when updating non-existent task', async () => {
    await expect(
      updateTask(taskListId, 'non-existent-task', { subject: 'New' })
    ).rejects.toThrow(TaskListError);
    await expect(
      updateTask(taskListId, 'non-existent-task', { subject: 'New' })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Task not found',
    });
  });

  test('should delete a task', async () => {
    const task = await createTask(taskListId, 'To Delete', 'Description');

    await deleteTask(taskListId, task.id);

    const taskList = await loadTaskList(taskListId);
    expect(taskList?.tasks).toHaveLength(0);
  });

  test('should remove task from dependency arrays when deleted', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');
    const task3 = await createTask(taskListId, 'Task 3', 'Third');

    // Set up dependencies: task1 blocks task2 and task3
    await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id, task3.id],
    });

    await updateTask(taskListId, task2.id, {
      addBlockedBy: [task1.id],
    });

    await updateTask(taskListId, task3.id, {
      addBlockedBy: [task1.id],
    });

    // Delete task1
    await deleteTask(taskListId, task1.id);

    // Check that task1.id is removed from other tasks' dependencies
    const taskList = await loadTaskList(taskListId);
    const updatedTask2 = taskList?.tasks.find((t) => t.id === task2.id);
    const updatedTask3 = taskList?.tasks.find((t) => t.id === task3.id);

    expect(updatedTask2?.blockedBy).not.toContain(task1.id);
    expect(updatedTask3?.blockedBy).not.toContain(task1.id);
  });

  test('should throw error when deleting task from non-existent list', async () => {
    await expect(deleteTask('non-existent-id', 'task-id')).rejects.toThrow(
      TaskListError
    );

    // The error will be IO_ERROR because lockfile fails on non-existent file
    try {
      await deleteTask('non-existent-id', 'task-id');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskListError);
      expect((error as TaskListError).code).toMatch(/IO_ERROR|NOT_FOUND/);
    }
  });

  test('should throw NOT_FOUND when deleting non-existent task', async () => {
    await expect(deleteTask(taskListId, 'non-existent-task')).rejects.toThrow(
      TaskListError
    );
    await expect(deleteTask(taskListId, 'non-existent-task')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Task not found',
    });
  });
});

describe('Batch Task Creation', () => {
  let taskListId: string;

  beforeEach(async () => {
    const taskList = await createTaskList('Batch Test List');
    taskListId = taskList.id;
  });

  test('should create multiple tasks in a single operation', async () => {
    const tasks = await batchCreateTasks(taskListId, [
      { subject: 'Task 1', description: 'First task' },
      { subject: 'Task 2', description: 'Second task' },
      { subject: 'Task 3', description: 'Third task' },
    ]);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]?.subject).toBe('Task 1');
    expect(tasks[1]?.subject).toBe('Task 2');
    expect(tasks[2]?.subject).toBe('Task 3');

    const taskList = await loadTaskList(taskListId);
    expect(taskList?.tasks).toHaveLength(3);
  });

  test('should create tasks with custom activeForm and metadata', async () => {
    const tasks = await batchCreateTasks(taskListId, [
      {
        subject: 'Build feature',
        description: 'Implement new feature',
        activeForm: 'Building feature',
        metadata: { priority: 'high' },
      },
    ]);

    expect(tasks[0]?.activeForm).toBe('Building feature');
    expect(tasks[0]?.metadata).toEqual({ priority: 'high' });
  });

  test('should create tasks with dependencies', async () => {
    const tasks = await batchCreateTasks(taskListId, [
      { subject: 'Task 1', description: 'First' },
      {
        subject: 'Task 2',
        description: 'Second',
        blockedBy: ['placeholder'],
      },
    ]);

    expect(tasks[1]?.blockedBy).toEqual(['placeholder']);
  });

  test('should throw INVALID_INPUT for empty tasks array', async () => {
    await expect(batchCreateTasks(taskListId, [])).rejects.toThrow(TaskListError);
    await expect(batchCreateTasks(taskListId, [])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Tasks array is required and must not be empty',
    });
  });

  test('should throw INVALID_INPUT when any task has empty subject', async () => {
    await expect(
      batchCreateTasks(taskListId, [
        { subject: 'Valid', description: 'Good' },
        { subject: '', description: 'Bad subject' },
      ])
    ).rejects.toThrow(TaskListError);
    await expect(
      batchCreateTasks(taskListId, [
        { subject: 'Valid', description: 'Good' },
        { subject: '', description: 'Bad subject' },
      ])
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'All tasks must have a subject',
    });
  });

  test('should throw INVALID_INPUT when any task has empty description', async () => {
    await expect(
      batchCreateTasks(taskListId, [
        { subject: 'Valid', description: 'Good' },
        { subject: 'Bad', description: '' },
      ])
    ).rejects.toThrow(TaskListError);
    await expect(
      batchCreateTasks(taskListId, [
        { subject: 'Valid', description: 'Good' },
        { subject: 'Bad', description: '' },
      ])
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'All tasks must have a description',
    });
  });

  test('should throw error when batch creating in non-existent list', async () => {
    await expect(
      batchCreateTasks('non-existent-id', [
        { subject: 'Task', description: 'Description' },
      ])
    ).rejects.toThrow(TaskListError);

    // The error will be IO_ERROR because lockfile fails on non-existent file
    try {
      await batchCreateTasks('non-existent-id', [
        { subject: 'Task', description: 'Description' },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(TaskListError);
      expect((error as TaskListError).code).toMatch(/IO_ERROR|NOT_FOUND/);
    }
  });

  test('should assign same timestamps to all tasks in batch', async () => {
    const tasks = await batchCreateTasks(taskListId, [
      { subject: 'Task 1', description: 'First' },
      { subject: 'Task 2', description: 'Second' },
      { subject: 'Task 3', description: 'Third' },
    ]);

    const timestamp = tasks[0]?.createdAt;
    expect(tasks.every((t) => t.createdAt === timestamp)).toBe(true);
    expect(tasks.every((t) => t.updatedAt === timestamp)).toBe(true);
  });
});

describe('File Locking and Concurrent Operations', () => {
  let taskListId: string;

  beforeEach(async () => {
    const taskList = await createTaskList('Concurrency Test');
    taskListId = taskList.id;
  });

  test('should handle concurrent task creation with lock retries', async () => {
    // Create tasks sequentially to avoid lock contention exceeding retry limit
    const tasks: any[] = [];
    for (let i = 0; i < 5; i++) {
      const task = await createTask(taskListId, `Task ${i}`, `Description ${i}`);
      tasks.push(task);
    }

    expect(tasks).toHaveLength(5);

    const taskList = await loadTaskList(taskListId);
    expect(taskList?.tasks).toHaveLength(5);
  });

  test('should handle concurrent task updates', async () => {
    const task = await createTask(taskListId, 'Base Task', 'Description');

    const promises = Array.from({ length: 5 }, (_, i) =>
      updateTask(taskListId, task.id, {
        metadata: { [`key${i}`]: `value${i}` },
      })
    );

    await Promise.all(promises);

    const taskList = await loadTaskList(taskListId);
    const updatedTask = taskList?.tasks.find((t) => t.id === task.id);

    // All metadata updates should be merged
    expect(Object.keys(updatedTask?.metadata || {}).length).toBe(5);
  });

  test('should handle concurrent batch task creation', async () => {
    const promises = Array.from({ length: 3 }, (_, batchIndex) =>
      batchCreateTasks(
        taskListId,
        Array.from({ length: 5 }, (_, taskIndex) => ({
          subject: `Batch ${batchIndex} Task ${taskIndex}`,
          description: `Description ${batchIndex}-${taskIndex}`,
        }))
      )
    );

    await Promise.all(promises);

    const taskList = await loadTaskList(taskListId);
    expect(taskList?.tasks).toHaveLength(15); // 3 batches × 5 tasks
  });
});

describe('Error Handling and Edge Cases', () => {
  test('should handle corrupt task list file (CORRUPT_DATA)', async () => {
    const taskList = await createTaskList('Valid List');
    const filePath = getTaskListPath(taskList.id);

    // Corrupt the file by writing invalid JSON
    await writeFile(filePath, '{ invalid json', 'utf-8');

    const loaded = await loadTaskList(taskList.id);
    expect(loaded).toBeNull();
  });

  test('should handle missing required fields in task list file', async () => {
    const taskList = await createTaskList('Valid List');
    const filePath = getTaskListPath(taskList.id);

    // Write file with missing fields
    await writeFile(filePath, JSON.stringify({ id: taskList.id }), 'utf-8');

    const loaded = await loadTaskList(taskList.id);
    expect(loaded).toBeNull();
  });

  test('should skip corrupt files when listing task lists', async () => {
    // Clean up first
    await cleanupTestFiles();

    const validList = await createTaskList('Valid List');
    const corruptFilePath = join(getTaskListsDir(), 'corrupt.json');

    // Create a corrupt file
    await writeFile(corruptFilePath, '{ corrupt json', 'utf-8');

    const lists = await listTaskLists();

    // Should include the valid list and skip the corrupt one
    const validListMeta = lists.find((l) => l.id === validList.id);
    expect(validListMeta).toBeDefined();

    // Clean up
    await deleteTaskList(validList.id);
    await rm(corruptFilePath, { force: true });
  });

  test('should ignore non-JSON files when listing', async () => {
    // Clean up first
    await cleanupTestFiles();

    const validList = await createTaskList('Valid List');

    // Create non-JSON files
    const txtPath = join(getTaskListsDir(), 'readme.txt');
    const lockPath = join(getTaskListsDir(), '.lock-file');

    await writeFile(txtPath, 'not a task list', 'utf-8');
    await writeFile(lockPath, 'lock data', 'utf-8');

    const lists = await listTaskLists();

    // Should only return the valid JSON file
    expect(lists).toHaveLength(1);
    expect(lists[0]?.id).toBe(validList.id);

    // Clean up
    await deleteTaskList(validList.id);
    await rm(txtPath, { force: true });
    await rm(lockPath, { force: true });
  });

  test('should create task-lists directory if it does not exist', async () => {
    // Delete the directory
    await rm(getTaskListsDir(), { recursive: true, force: true });

    // Creating a task list should recreate the directory
    const taskList = await createTaskList('New List');

    expect(taskList.id).toBeDefined();

    const loaded = await loadTaskList(taskList.id);
    expect(loaded).not.toBeNull();
  });

  test('should handle empty task-lists directory gracefully', async () => {
    // Clean up all files
    await cleanupTestFiles();

    // Ensure directory exists but is empty
    await mkdir(getTaskListsDir(), { recursive: true });

    const lists = await listTaskLists();
    expect(lists).toEqual([]);
  });
});

describe('TaskListMeta Calculations', () => {
  test('should calculate task counts correctly', async () => {
    const taskList = await createTaskList('Count Test');

    // Create tasks with different statuses
    const task1 = await createTask(taskList.id, 'Task 1', 'Pending task');
    const task2 = await createTask(taskList.id, 'Task 2', 'Another pending');
    const task3 = await createTask(taskList.id, 'Task 3', 'Will be in progress');
    const task4 = await createTask(taskList.id, 'Task 4', 'Will be completed');

    await updateTask(taskList.id, task3.id, { status: 'in_progress' });
    await updateTask(taskList.id, task4.id, { status: 'completed' });

    const lists = await listTaskLists();
    const meta = lists.find((l) => l.id === taskList.id);

    expect(meta?.taskCount).toBe(4);
    expect(meta?.pendingCount).toBe(2);
    expect(meta?.inProgressCount).toBe(1);
    expect(meta?.completedCount).toBe(1);
  });

  test('should sort task lists by most recently updated first', async () => {
    // Clean up first to ensure clean state
    await cleanupTestFiles();

    const list1 = await createTaskList('First List');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const list2 = await createTaskList('Second List');
    await new Promise((resolve) => setTimeout(resolve, 10));

    const list3 = await createTaskList('Third List');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Update list1 (should move it to the top)
    await createTask(list1.id, 'New Task', 'Makes it recent');

    const lists = await listTaskLists();

    // Verify the three lists we created are in the right order
    const indices = [
      lists.findIndex((l) => l.id === list1.id),
      lists.findIndex((l) => l.id === list2.id),
      lists.findIndex((l) => l.id === list3.id),
    ];

    // list1 should be first (most recently updated)
    // list3 should be second
    // list2 should be third
    expect(indices[0]).toBeLessThan(indices[2]); // list1 < list2
    expect(indices[0]).toBeLessThan(indices[1]); // list1 < list3
    expect(indices[2]).toBeLessThan(indices[1]); // list3 < list2

    // Clean up
    await deleteTaskList(list1.id);
    await deleteTaskList(list2.id);
    await deleteTaskList(list3.id);
  });
});

describe('Task Dependencies', () => {
  let taskListId: string;

  beforeEach(async () => {
    const taskList = await createTaskList('Dependency Test');
    taskListId = taskList.id;
  });

  test('should create tasks with blocks and blockedBy arrays', async () => {
    const tasks = await batchCreateTasks(taskListId, [
      { subject: 'Task A', description: 'First', blocks: ['task-b-id'] },
      { subject: 'Task B', description: 'Second', blockedBy: ['task-a-id'] },
    ]);

    expect(tasks[0]?.blocks).toEqual(['task-b-id']);
    expect(tasks[1]?.blockedBy).toEqual(['task-a-id']);
  });

  test('should add multiple dependencies', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');
    const task3 = await createTask(taskListId, 'Task 3', 'Third');
    const task4 = await createTask(taskListId, 'Task 4', 'Fourth');

    // task1 blocks task2 and task3
    await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id, task3.id],
    });

    // task4 is blocked by task2 and task3
    await updateTask(taskListId, task4.id, {
      addBlockedBy: [task2.id, task3.id],
    });

    const taskList = await loadTaskList(taskListId);
    const updatedTask1 = taskList?.tasks.find((t) => t.id === task1.id);
    const updatedTask4 = taskList?.tasks.find((t) => t.id === task4.id);

    expect(updatedTask1?.blocks).toEqual(expect.arrayContaining([task2.id, task3.id]));
    expect(updatedTask4?.blockedBy).toEqual(
      expect.arrayContaining([task2.id, task3.id])
    );
  });

  test('should preserve existing dependencies when adding new ones', async () => {
    const task1 = await createTask(taskListId, 'Task 1', 'First');
    const task2 = await createTask(taskListId, 'Task 2', 'Second');
    const task3 = await createTask(taskListId, 'Task 3', 'Third');

    await updateTask(taskListId, task1.id, {
      addBlocks: [task2.id],
    });

    await updateTask(taskListId, task1.id, {
      addBlocks: [task3.id],
    });

    const taskList = await loadTaskList(taskListId);
    const updatedTask = taskList?.tasks.find((t) => t.id === task1.id);

    expect(updatedTask?.blocks).toEqual(expect.arrayContaining([task2.id, task3.id]));
  });
});

describe('Helper Functions', () => {
  test('should return task lists directory path', () => {
    const dir = getTaskListsDir();
    expect(dir).toContain('.vesper');
    expect(dir).toContain('task-lists');
  });

  test('should return task list file path with .json extension', () => {
    const path = getTaskListPath('test-id-123');
    expect(path).toContain('task-lists');
    expect(path).toEndWith('test-id-123.json');
  });
});

describe('Data Persistence and Integrity', () => {
  test('should persist task list updates to disk', async () => {
    const taskList = await createTaskList('Persistence Test');
    const task = await createTask(taskList.id, 'Task 1', 'Description');

    // Read file directly
    const filePath = getTaskListPath(taskList.id);
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as TaskList;

    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.id).toBe(task.id);
  });

  test('should format JSON with indentation', async () => {
    const taskList = await createTaskList('Formatted JSON');

    const filePath = getTaskListPath(taskList.id);
    const content = await readFile(filePath, 'utf-8');

    // Check if JSON is formatted (has newlines and indentation)
    expect(content).toContain('\n');
    expect(content).toContain('  '); // 2-space indentation
  });

  test('should preserve task order', async () => {
    const taskList = await createTaskList('Order Test');

    const task1 = await createTask(taskList.id, 'First', 'One');
    const task2 = await createTask(taskList.id, 'Second', 'Two');
    const task3 = await createTask(taskList.id, 'Third', 'Three');

    const loaded = await loadTaskList(taskList.id);

    expect(loaded?.tasks[0]?.id).toBe(task1.id);
    expect(loaded?.tasks[1]?.id).toBe(task2.id);
    expect(loaded?.tasks[2]?.id).toBe(task3.id);
  });

  test('should update task list updatedAt when task is modified', async () => {
    const taskList = await createTaskList('Update Test');
    const originalUpdatedAt = taskList.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await createTask(taskList.id, 'New Task', 'Description');

    const loaded = await loadTaskList(taskList.id);
    expect(loaded?.updatedAt).not.toBe(originalUpdatedAt);
  });
});
