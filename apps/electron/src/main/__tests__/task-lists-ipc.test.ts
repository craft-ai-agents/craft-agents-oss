/**
 * E2E Tests for Task Lists IPC Handlers
 *
 * Comprehensive test suite covering all task list IPC handlers, event broadcasting,
 * error handling, and edge cases.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { TaskList, Task, TaskListMeta, TaskStatus } from '@vesper/shared/task-lists';
import { TaskListError } from '@vesper/shared/task-lists';

// ============================================================================
// Mock Types and Interfaces
// ============================================================================

interface MockBrowserWindow {
  webContents: {
    send: ReturnType<typeof mock>;
  };
}

interface MockIpcMain {
  handle: ReturnType<typeof mock>;
}

interface IpcHandler<TArgs extends unknown[], TReturn> {
  (_event: unknown, ...args: TArgs): Promise<TReturn>;
}

// ============================================================================
// Mock Storage Layer
// ============================================================================

/**
 * Mock storage layer that simulates the behavior of the actual storage
 * without touching the filesystem. Includes error injection capabilities.
 */
class MockTaskListStorage {
  private taskLists = new Map<string, TaskList>();
  private shouldThrowError: TaskListError | null = null;

  reset(): void {
    this.taskLists.clear();
    this.shouldThrowError = null;
  }

  injectError(error: TaskListError): void {
    this.shouldThrowError = error;
  }

  clearError(): void {
    this.shouldThrowError = null;
  }

  private checkForError(): void {
    if (this.shouldThrowError) {
      const error = this.shouldThrowError;
      this.shouldThrowError = null;
      throw error;
    }
  }

  async listTaskLists(): Promise<TaskListMeta[]> {
    this.checkForError();

    const meta: TaskListMeta[] = [];
    for (const taskList of this.taskLists.values()) {
      const pendingCount = taskList.tasks.filter(t => t.status === 'pending').length;
      const inProgressCount = taskList.tasks.filter(t => t.status === 'in_progress').length;
      const completedCount = taskList.tasks.filter(t => t.status === 'completed').length;

      meta.push({
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
    }

    return meta.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async createTaskList(name: string, description?: string): Promise<TaskList> {
    this.checkForError();

    if (!name || name.trim().length === 0) {
      throw new TaskListError('Task list name is required', 'INVALID_INPUT');
    }
    if (name.length > 200) {
      throw new TaskListError('Task list name too long (max 200 chars)', 'INVALID_INPUT');
    }

    const taskList: TaskList = {
      id: `tl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      description,
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.taskLists.set(taskList.id, taskList);
    return taskList;
  }

  async loadTaskList(id: string): Promise<TaskList | null> {
    this.checkForError();
    return this.taskLists.get(id) || null;
  }

  async deleteTaskList(id: string): Promise<void> {
    this.checkForError();

    if (!this.taskLists.has(id)) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { id });
    }

    this.taskLists.delete(id);
  }

  async createTask(
    taskListId: string,
    subject: string,
    description: string,
    activeForm?: string,
    metadata?: Record<string, unknown>
  ): Promise<Task> {
    this.checkForError();

    if (!subject || subject.trim().length === 0) {
      throw new TaskListError('Task subject is required', 'INVALID_INPUT');
    }
    if (!description || description.trim().length === 0) {
      throw new TaskListError('Task description is required', 'INVALID_INPUT');
    }

    const taskList = this.taskLists.get(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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

    taskList.tasks.push(task);
    taskList.updatedAt = new Date().toISOString();

    return task;
  }

  async batchCreateTasks(
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
    this.checkForError();

    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new TaskListError('Tasks array is required and must not be empty', 'INVALID_INPUT');
    }

    for (const task of tasks) {
      if (!task.subject || task.subject.trim().length === 0) {
        throw new TaskListError('All tasks must have a subject', 'INVALID_INPUT');
      }
      if (!task.description || task.description.trim().length === 0) {
        throw new TaskListError('All tasks must have a description', 'INVALID_INPUT');
      }
    }

    const taskList = this.taskLists.get(taskListId);
    if (!taskList) {
      throw new TaskListError('Task list not found', 'NOT_FOUND', { taskListId });
    }

    const now = new Date().toISOString();
    const createdTasks: Task[] = [];

    for (const taskData of tasks) {
      const task: Task = {
        id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
    return createdTasks;
  }

  async updateTask(
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
    this.checkForError();

    const taskList = this.taskLists.get(taskListId);
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

    return task;
  }

  async deleteTask(taskListId: string, taskId: string): Promise<void> {
    this.checkForError();

    const taskList = this.taskLists.get(taskListId);
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
  }
}

// ============================================================================
// IPC Handler Simulator
// ============================================================================

/**
 * Simulates the IPC handlers from task-lists-ipc.ts
 * This allows testing the handler logic without Electron IPC overhead
 */
class TaskListIpcSimulator {
  private storage: MockTaskListStorage;
  private broadcastMock: ReturnType<typeof mock>;

  constructor(storage: MockTaskListStorage, broadcastMock: ReturnType<typeof mock>) {
    this.storage = storage;
    this.broadcastMock = broadcastMock;
  }

  async handleList(): Promise<TaskListMeta[]> {
    try {
      return await this.storage.listTaskLists();
    } catch (error) {
      console.error('[task-lists:list] Error:', error);
      throw error;
    }
  }

  async handleCreate(name: string, description?: string): Promise<TaskList> {
    try {
      const taskList = await this.storage.createTaskList(name, description);
      this.broadcastMock(taskList.id);
      return taskList;
    } catch (error) {
      console.error('[task-lists:create] Error:', error);
      throw error;
    }
  }

  async handleGet(taskListId: string): Promise<TaskList | null> {
    try {
      return await this.storage.loadTaskList(taskListId);
    } catch (error) {
      console.error('[task-lists:get] Error:', error);
      throw error;
    }
  }

  async handleDelete(taskListId: string): Promise<void> {
    try {
      await this.storage.deleteTaskList(taskListId);
      this.broadcastMock(taskListId);
    } catch (error) {
      // If task list not found, treat as success (idempotent delete)
      if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
        return;
      }
      console.error('[task-lists:delete] Error:', error);
      throw error;
    }
  }

  async handleTaskCreate(
    taskListId: string,
    subject: string,
    description: string,
    activeForm?: string,
    metadata?: Record<string, unknown>
  ): Promise<Task> {
    try {
      const task = await this.storage.createTask(taskListId, subject, description, activeForm, metadata);
      this.broadcastMock(taskListId);
      return task;
    } catch (error) {
      console.error('[task-lists:task-create] Error:', error);
      throw error;
    }
  }

  async handleTaskBatchCreate(
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
    try {
      const createdTasks = await this.storage.batchCreateTasks(taskListId, tasks);
      this.broadcastMock(taskListId);
      return createdTasks;
    } catch (error) {
      console.error('[task-lists:task-batch-create] Error:', error);
      throw error;
    }
  }

  async handleTaskUpdate(
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
    try {
      const task = await this.storage.updateTask(taskListId, taskId, updates);
      this.broadcastMock(taskListId);
      return task;
    } catch (error) {
      console.error('[task-lists:task-update] Error:', error);
      throw error;
    }
  }

  async handleTaskDelete(taskListId: string, taskId: string): Promise<void> {
    try {
      await this.storage.deleteTask(taskListId, taskId);
      this.broadcastMock(taskListId);
    } catch (error) {
      // If task not found, treat as success (idempotent delete)
      // But still throw if task list not found
      if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
        // Check if it's a task not found vs task list not found error
        if ((error.details as any)?.taskId !== undefined) {
          // Task not found - idempotent delete
          return;
        }
      }
      console.error('[task-lists:task-delete] Error:', error);
      throw error;
    }
  }

  async handleTasksList(taskListId: string): Promise<Task[]> {
    try {
      const taskList = await this.storage.loadTaskList(taskListId);
      return taskList?.tasks || [];
    } catch (error) {
      console.error('[task-lists:tasks-list] Error:', error);
      throw error;
    }
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Task Lists IPC Handlers', () => {
  let storage: MockTaskListStorage;
  let broadcastMock: ReturnType<typeof mock>;
  let ipc: TaskListIpcSimulator;

  beforeEach(() => {
    storage = new MockTaskListStorage();
    broadcastMock = mock(() => {});
    ipc = new TaskListIpcSimulator(storage, broadcastMock);
  });

  afterEach(() => {
    storage.reset();
  });

  // ==========================================================================
  // task-lists:list
  // ==========================================================================

  describe('task-lists:list', () => {
    it('should return empty array when no task lists exist', async () => {
      const result = await ipc.handleList();
      expect(result).toEqual([]);
    });

    it('should return task list metadata for all task lists', async () => {
      const taskList1 = await storage.createTaskList('List 1', 'First list');
      await new Promise(resolve => setTimeout(resolve, 10)); // Ensure different timestamps
      const taskList2 = await storage.createTaskList('List 2', 'Second list');

      const result = await ipc.handleList();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(taskList2.id); // Most recent first
      expect(result[0].name).toBe('List 2');
      expect(result[0].description).toBe('Second list');
      expect(result[0].taskCount).toBe(0);
      expect(result[1].id).toBe(taskList1.id);
    });

    it('should include task counts in metadata', async () => {
      const taskList = await storage.createTaskList('List with tasks');
      await storage.createTask(taskList.id, 'Task 1', 'Description 1');
      await storage.createTask(taskList.id, 'Task 2', 'Description 2');

      const result = await ipc.handleList();

      expect(result).toHaveLength(1);
      expect(result[0].taskCount).toBe(2);
      expect(result[0].pendingCount).toBe(2);
      expect(result[0].inProgressCount).toBe(0);
      expect(result[0].completedCount).toBe(0);
    });

    it('should include status breakdown in metadata', async () => {
      const taskList = await storage.createTaskList('List with tasks');
      const task1 = await storage.createTask(taskList.id, 'Task 1', 'Description 1');
      const task2 = await storage.createTask(taskList.id, 'Task 2', 'Description 2');
      const task3 = await storage.createTask(taskList.id, 'Task 3', 'Description 3');

      await storage.updateTask(taskList.id, task1.id, { status: 'in_progress' });
      await storage.updateTask(taskList.id, task2.id, { status: 'completed' });

      const result = await ipc.handleList();

      expect(result[0].taskCount).toBe(3);
      expect(result[0].pendingCount).toBe(1);
      expect(result[0].inProgressCount).toBe(1);
      expect(result[0].completedCount).toBe(1);
    });

    it('should sort by most recently updated first', async () => {
      const taskList1 = await storage.createTaskList('Old list');
      await new Promise(resolve => setTimeout(resolve, 10));
      const taskList2 = await storage.createTaskList('New list');

      const result = await ipc.handleList();

      expect(result[0].id).toBe(taskList2.id);
      expect(result[1].id).toBe(taskList1.id);
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(ipc.handleList()).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:create
  // ==========================================================================

  describe('task-lists:create', () => {
    it('should create a new task list with name only', async () => {
      const result = await ipc.handleCreate('My Task List');

      expect(result.id).toBeDefined();
      expect(result.name).toBe('My Task List');
      expect(result.description).toBeUndefined();
      expect(result.tasks).toEqual([]);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('should create a new task list with name and description', async () => {
      const result = await ipc.handleCreate('My Task List', 'This is a description');

      expect(result.name).toBe('My Task List');
      expect(result.description).toBe('This is a description');
    });

    it('should broadcast task list changed event', async () => {
      const result = await ipc.handleCreate('My Task List');

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(result.id);
    });

    it('should trim whitespace from name', async () => {
      const result = await ipc.handleCreate('  Trimmed Name  ');

      expect(result.name).toBe('Trimmed Name');
    });

    it('should reject empty name', async () => {
      await expect(ipc.handleCreate('')).rejects.toThrow('Task list name is required');
      await expect(ipc.handleCreate('   ')).rejects.toThrow('Task list name is required');
    });

    it('should reject name longer than 200 characters', async () => {
      const longName = 'a'.repeat(201);

      await expect(ipc.handleCreate(longName)).rejects.toThrow('Task list name too long');
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(ipc.handleCreate('Test')).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:get
  // ==========================================================================

  describe('task-lists:get', () => {
    it('should return task list by ID', async () => {
      const created = await storage.createTaskList('Test List');
      const result = await ipc.handleGet(created.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.name).toBe('Test List');
      expect(result!.tasks).toEqual([]);
    });

    it('should return task list with all tasks', async () => {
      const created = await storage.createTaskList('Test List');
      await storage.createTask(created.id, 'Task 1', 'Description 1');
      await storage.createTask(created.id, 'Task 2', 'Description 2');

      const result = await ipc.handleGet(created.id);

      expect(result!.tasks).toHaveLength(2);
      expect(result!.tasks[0].subject).toBe('Task 1');
      expect(result!.tasks[1].subject).toBe('Task 2');
    });

    it('should return null for non-existent task list', async () => {
      const result = await ipc.handleGet('non-existent-id');

      expect(result).toBeNull();
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(ipc.handleGet('test-id')).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:delete
  // ==========================================================================

  describe('task-lists:delete', () => {
    it('should delete a task list', async () => {
      const created = await storage.createTaskList('Test List');

      await ipc.handleDelete(created.id);

      const result = await storage.loadTaskList(created.id);
      expect(result).toBeNull();
    });

    it('should broadcast task list changed event', async () => {
      const created = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleDelete(created.id);

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(created.id);
    });

    it('should be idempotent (not throw on non-existent task list)', async () => {
      await expect(ipc.handleDelete('non-existent-id')).resolves.toBeUndefined();
    });

    it('should not broadcast for non-existent task list', async () => {
      await ipc.handleDelete('non-existent-id');

      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it('should propagate non-NOT_FOUND storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(ipc.handleDelete('test-id')).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:task-create
  // ==========================================================================

  describe('task-lists:task-create', () => {
    let taskListId: string;

    beforeEach(async () => {
      const taskList = await storage.createTaskList('Test List');
      taskListId = taskList.id;
    });

    it('should create a task with subject and description', async () => {
      const result = await ipc.handleTaskCreate(
        taskListId,
        'Fix bug',
        'Fix the authentication bug'
      );

      expect(result.id).toBeDefined();
      expect(result.subject).toBe('Fix bug');
      expect(result.description).toBe('Fix the authentication bug');
      expect(result.activeForm).toBe('Fix bug');
      expect(result.status).toBe('pending');
      expect(result.blocks).toEqual([]);
      expect(result.blockedBy).toEqual([]);
    });

    it('should create a task with activeForm', async () => {
      const result = await ipc.handleTaskCreate(
        taskListId,
        'Fix bug',
        'Fix the authentication bug',
        'Fixing bug'
      );

      expect(result.activeForm).toBe('Fixing bug');
    });

    it('should create a task with metadata', async () => {
      const result = await ipc.handleTaskCreate(
        taskListId,
        'Fix bug',
        'Fix the authentication bug',
        undefined,
        { priority: 'high', tags: ['security'] }
      );

      expect(result.metadata).toEqual({ priority: 'high', tags: ['security'] });
    });

    it('should broadcast task list changed event', async () => {
      broadcastMock.mockClear();

      await ipc.handleTaskCreate(taskListId, 'Fix bug', 'Description');

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(taskListId);
    });

    it('should trim whitespace from subject and description', async () => {
      const result = await ipc.handleTaskCreate(
        taskListId,
        '  Fix bug  ',
        '  Description  '
      );

      expect(result.subject).toBe('Fix bug');
      expect(result.description).toBe('Description');
    });

    it('should reject empty subject', async () => {
      await expect(
        ipc.handleTaskCreate(taskListId, '', 'Description')
      ).rejects.toThrow('Task subject is required');

      await expect(
        ipc.handleTaskCreate(taskListId, '   ', 'Description')
      ).rejects.toThrow('Task subject is required');
    });

    it('should reject empty description', async () => {
      await expect(
        ipc.handleTaskCreate(taskListId, 'Subject', '')
      ).rejects.toThrow('Task description is required');

      await expect(
        ipc.handleTaskCreate(taskListId, 'Subject', '   ')
      ).rejects.toThrow('Task description is required');
    });

    it('should reject non-existent task list', async () => {
      await expect(
        ipc.handleTaskCreate('non-existent-id', 'Subject', 'Description')
      ).rejects.toThrow('Task list not found');
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(
        ipc.handleTaskCreate(taskListId, 'Subject', 'Description')
      ).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:task-batch-create
  // ==========================================================================

  describe('task-lists:task-batch-create', () => {
    let taskListId: string;

    beforeEach(async () => {
      const taskList = await storage.createTaskList('Test List');
      taskListId = taskList.id;
    });

    it('should create multiple tasks at once', async () => {
      const result = await ipc.handleTaskBatchCreate(taskListId, [
        { subject: 'Task 1', description: 'Description 1' },
        { subject: 'Task 2', description: 'Description 2' },
        { subject: 'Task 3', description: 'Description 3' },
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].subject).toBe('Task 1');
      expect(result[1].subject).toBe('Task 2');
      expect(result[2].subject).toBe('Task 3');
    });

    it('should create tasks with activeForm and metadata', async () => {
      const result = await ipc.handleTaskBatchCreate(taskListId, [
        {
          subject: 'Task 1',
          description: 'Description 1',
          activeForm: 'Running Task 1',
          metadata: { priority: 'high' }
        },
      ]);

      expect(result[0].activeForm).toBe('Running Task 1');
      expect(result[0].metadata).toEqual({ priority: 'high' });
    });

    it('should create tasks with dependencies', async () => {
      const result = await ipc.handleTaskBatchCreate(taskListId, [
        {
          subject: 'Task 1',
          description: 'Description 1',
          blocks: ['task-2', 'task-3']
        },
        {
          subject: 'Task 2',
          description: 'Description 2',
          blockedBy: ['task-1']
        },
      ]);

      expect(result[0].blocks).toEqual(['task-2', 'task-3']);
      expect(result[1].blockedBy).toEqual(['task-1']);
    });

    it('should broadcast task list changed event once', async () => {
      broadcastMock.mockClear();

      await ipc.handleTaskBatchCreate(taskListId, [
        { subject: 'Task 1', description: 'Description 1' },
        { subject: 'Task 2', description: 'Description 2' },
      ]);

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(taskListId);
    });

    it('should reject empty tasks array', async () => {
      await expect(
        ipc.handleTaskBatchCreate(taskListId, [])
      ).rejects.toThrow('Tasks array is required and must not be empty');
    });

    it('should reject tasks with missing subject', async () => {
      await expect(
        ipc.handleTaskBatchCreate(taskListId, [
          { subject: '', description: 'Description' }
        ])
      ).rejects.toThrow('All tasks must have a subject');
    });

    it('should reject tasks with missing description', async () => {
      await expect(
        ipc.handleTaskBatchCreate(taskListId, [
          { subject: 'Subject', description: '' }
        ])
      ).rejects.toThrow('All tasks must have a description');
    });

    it('should reject non-existent task list', async () => {
      await expect(
        ipc.handleTaskBatchCreate('non-existent-id', [
          { subject: 'Task', description: 'Description' }
        ])
      ).rejects.toThrow('Task list not found');
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(
        ipc.handleTaskBatchCreate(taskListId, [
          { subject: 'Task', description: 'Description' }
        ])
      ).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:task-update
  // ==========================================================================

  describe('task-lists:task-update', () => {
    let taskListId: string;
    let taskId: string;

    beforeEach(async () => {
      const taskList = await storage.createTaskList('Test List');
      taskListId = taskList.id;
      const task = await storage.createTask(taskListId, 'Original', 'Original description');
      taskId = task.id;
    });

    it('should update task subject', async () => {
      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        subject: 'Updated subject'
      });

      expect(result.subject).toBe('Updated subject');
      expect(result.description).toBe('Original description');
    });

    it('should update task description', async () => {
      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        description: 'Updated description'
      });

      expect(result.subject).toBe('Original');
      expect(result.description).toBe('Updated description');
    });

    it('should update task activeForm', async () => {
      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        activeForm: 'Running task'
      });

      expect(result.activeForm).toBe('Running task');
    });

    it('should update task status', async () => {
      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        status: 'in_progress'
      });

      expect(result.status).toBe('in_progress');
    });

    it('should update task owner', async () => {
      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        owner: 'agent-123'
      });

      expect(result.owner).toBe('agent-123');
    });

    it('should merge metadata', async () => {
      await storage.updateTask(taskListId, taskId, {
        metadata: { priority: 'low', tags: ['backend'] }
      });

      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        metadata: { priority: 'high', labels: ['urgent'] }
      });

      expect(result.metadata).toEqual({
        priority: 'high',
        tags: ['backend'],
        labels: ['urgent']
      });
    });

    it('should add blocks (additive)', async () => {
      await storage.updateTask(taskListId, taskId, {
        addBlocks: ['task-1']
      });

      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        addBlocks: ['task-2', 'task-3']
      });

      expect(result.blocks).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should add blockedBy (additive)', async () => {
      await storage.updateTask(taskListId, taskId, {
        addBlockedBy: ['task-1']
      });

      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        addBlockedBy: ['task-2', 'task-3']
      });

      expect(result.blockedBy).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should not add duplicate blocks', async () => {
      await storage.updateTask(taskListId, taskId, {
        addBlocks: ['task-1', 'task-2']
      });

      const result = await ipc.handleTaskUpdate(taskListId, taskId, {
        addBlocks: ['task-2', 'task-3']
      });

      expect(result.blocks).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('should broadcast task list changed event', async () => {
      broadcastMock.mockClear();

      await ipc.handleTaskUpdate(taskListId, taskId, { status: 'completed' });

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(taskListId);
    });

    it('should update updatedAt timestamp', async () => {
      const originalUpdatedAt = (await storage.loadTaskList(taskListId))!.tasks[0].updatedAt;
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await ipc.handleTaskUpdate(taskListId, taskId, { status: 'completed' });

      expect(result.updatedAt).not.toBe(originalUpdatedAt);
    });

    it('should reject non-existent task list', async () => {
      await expect(
        ipc.handleTaskUpdate('non-existent-id', taskId, { status: 'completed' })
      ).rejects.toThrow('Task list not found');
    });

    it('should reject non-existent task', async () => {
      await expect(
        ipc.handleTaskUpdate(taskListId, 'non-existent-task', { status: 'completed' })
      ).rejects.toThrow('Task not found');
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(
        ipc.handleTaskUpdate(taskListId, taskId, { status: 'completed' })
      ).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:task-delete
  // ==========================================================================

  describe('task-lists:task-delete', () => {
    let taskListId: string;
    let taskId: string;

    beforeEach(async () => {
      const taskList = await storage.createTaskList('Test List');
      taskListId = taskList.id;
      const task = await storage.createTask(taskListId, 'Task', 'Description');
      taskId = task.id;
    });

    it('should delete a task', async () => {
      await ipc.handleTaskDelete(taskListId, taskId);

      const taskList = await storage.loadTaskList(taskListId);
      expect(taskList!.tasks).toHaveLength(0);
    });

    it('should remove task from dependency arrays', async () => {
      const task2 = await storage.createTask(taskListId, 'Task 2', 'Description 2');
      await storage.updateTask(taskListId, task2.id, {
        addBlocks: [taskId],
        addBlockedBy: [taskId]
      });

      await ipc.handleTaskDelete(taskListId, taskId);

      const taskList = await storage.loadTaskList(taskListId);
      const remainingTask = taskList!.tasks.find(t => t.id === task2.id);
      expect(remainingTask!.blocks).toEqual([]);
      expect(remainingTask!.blockedBy).toEqual([]);
    });

    it('should broadcast task list changed event', async () => {
      broadcastMock.mockClear();

      await ipc.handleTaskDelete(taskListId, taskId);

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(taskListId);
    });

    it('should be idempotent (not throw on non-existent task)', async () => {
      await expect(
        ipc.handleTaskDelete(taskListId, 'non-existent-task')
      ).resolves.toBeUndefined();
    });

    it('should not broadcast for non-existent task', async () => {
      broadcastMock.mockClear();

      await ipc.handleTaskDelete(taskListId, 'non-existent-task');

      expect(broadcastMock).not.toHaveBeenCalled();
    });

    it('should reject non-existent task list', async () => {
      await expect(
        ipc.handleTaskDelete('non-existent-id', taskId)
      ).rejects.toThrow('Task list not found');
    });

    it('should propagate non-NOT_FOUND storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(
        ipc.handleTaskDelete(taskListId, taskId)
      ).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // task-lists:tasks-list
  // ==========================================================================

  describe('task-lists:tasks-list', () => {
    let taskListId: string;

    beforeEach(async () => {
      const taskList = await storage.createTaskList('Test List');
      taskListId = taskList.id;
    });

    it('should return all tasks in a task list', async () => {
      await storage.createTask(taskListId, 'Task 1', 'Description 1');
      await storage.createTask(taskListId, 'Task 2', 'Description 2');

      const result = await ipc.handleTasksList(taskListId);

      expect(result).toHaveLength(2);
      expect(result[0].subject).toBe('Task 1');
      expect(result[1].subject).toBe('Task 2');
    });

    it('should return empty array for task list with no tasks', async () => {
      const result = await ipc.handleTasksList(taskListId);

      expect(result).toEqual([]);
    });

    it('should return empty array for non-existent task list', async () => {
      const result = await ipc.handleTasksList('non-existent-id');

      expect(result).toEqual([]);
    });

    it('should propagate storage errors', async () => {
      storage.injectError(new TaskListError('Storage error', 'IO_ERROR'));

      await expect(ipc.handleTasksList(taskListId)).rejects.toThrow('Storage error');
    });
  });

  // ==========================================================================
  // Event Broadcasting Tests
  // ==========================================================================

  describe('Event Broadcasting', () => {
    it('should broadcast on task list creation', async () => {
      const taskList = await ipc.handleCreate('Test List');

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should broadcast on task list deletion', async () => {
      const taskList = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleDelete(taskList.id);

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should broadcast on task creation', async () => {
      const taskList = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleTaskCreate(taskList.id, 'Task', 'Description');

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should broadcast on task batch creation', async () => {
      const taskList = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleTaskBatchCreate(taskList.id, [
        { subject: 'Task 1', description: 'Description 1' },
        { subject: 'Task 2', description: 'Description 2' },
      ]);

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should broadcast on task update', async () => {
      const taskList = await storage.createTaskList('Test List');
      const task = await storage.createTask(taskList.id, 'Task', 'Description');
      broadcastMock.mockClear();

      await ipc.handleTaskUpdate(taskList.id, task.id, { status: 'completed' });

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should broadcast on task deletion', async () => {
      const taskList = await storage.createTaskList('Test List');
      const task = await storage.createTask(taskList.id, 'Task', 'Description');
      broadcastMock.mockClear();

      await ipc.handleTaskDelete(taskList.id, task.id);

      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should not broadcast for list or get operations', async () => {
      const taskList = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleList();
      await ipc.handleGet(taskList.id);
      await ipc.handleTasksList(taskList.id);

      expect(broadcastMock).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle task list with large number of tasks', async () => {
      const taskList = await storage.createTaskList('Large List');
      const tasks = Array.from({ length: 100 }, (_, i) => ({
        subject: `Task ${i}`,
        description: `Description ${i}`,
      }));

      await ipc.handleTaskBatchCreate(taskList.id, tasks);

      const result = await ipc.handleTasksList(taskList.id);
      expect(result).toHaveLength(100);
    });

    it('should handle task with very long subject and description', async () => {
      const taskList = await storage.createTaskList('Test List');
      const longSubject = 'a'.repeat(500);
      const longDescription = 'b'.repeat(5000);

      const result = await ipc.handleTaskCreate(
        taskList.id,
        longSubject,
        longDescription
      );

      expect(result.subject).toBe(longSubject);
      expect(result.description).toBe(longDescription);
    });

    it('should handle task with complex metadata', async () => {
      const taskList = await storage.createTaskList('Test List');
      const complexMetadata = {
        priority: 'high',
        tags: ['urgent', 'backend', 'security'],
        assignees: ['user1', 'user2'],
        nested: {
          level1: {
            level2: {
              value: 'deep'
            }
          }
        },
        array: [1, 2, 3, { key: 'value' }]
      };

      const result = await ipc.handleTaskCreate(
        taskList.id,
        'Complex task',
        'Description',
        undefined,
        complexMetadata
      );

      expect(result.metadata).toEqual(complexMetadata);
    });

    it('should handle special characters in task list name', async () => {
      const result = await ipc.handleCreate('Test & List (v2) - "Special"');

      expect(result.name).toBe('Test & List (v2) - "Special"');
    });

    it('should handle special characters in task subject and description', async () => {
      const taskList = await storage.createTaskList('Test List');
      const result = await ipc.handleTaskCreate(
        taskList.id,
        'Fix bug: `authentication` failed',
        'Description with "quotes" and <tags>'
      );

      expect(result.subject).toBe('Fix bug: `authentication` failed');
      expect(result.description).toBe('Description with "quotes" and <tags>');
    });

    it('should handle concurrent updates to different tasks in same list', async () => {
      const taskList = await storage.createTaskList('Test List');
      const task1 = await storage.createTask(taskList.id, 'Task 1', 'Description 1');
      const task2 = await storage.createTask(taskList.id, 'Task 2', 'Description 2');

      // Simulate concurrent updates
      await Promise.all([
        ipc.handleTaskUpdate(taskList.id, task1.id, { status: 'in_progress' }),
        ipc.handleTaskUpdate(taskList.id, task2.id, { status: 'completed' }),
      ]);

      const result = await ipc.handleTasksList(taskList.id);
      expect(result.find(t => t.id === task1.id)!.status).toBe('in_progress');
      expect(result.find(t => t.id === task2.id)!.status).toBe('completed');
    });
  });
});
