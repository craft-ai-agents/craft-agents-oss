/**
 * Task Lists IPC Handlers
 *
 * IPC handlers for task list operations (CRUD).
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { TaskList, Task, TaskListMeta, TaskStatus } from '@vesper/shared/task-lists';
import {
  TaskListError,
  listTaskLists,
  createTaskList,
  loadTaskList,
  deleteTaskList,
  createTask,
  batchCreateTasks,
  updateTask,
  deleteTask,
} from '@vesper/shared/task-lists';

/**
 * Broadcast task list changed event to all windows
 */
function broadcastTaskListChanged(taskListId: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('task-lists:changed', taskListId);
  });
}

/**
 * Register task list IPC handlers
 */
export function registerTaskListsIpc(): void {
  // List all task lists
  ipcMain.handle('task-lists:list', async (): Promise<TaskListMeta[]> => {
    try {
      return await listTaskLists();
    } catch (error) {
      console.error('[task-lists:list] Error:', error);
      throw error;
    }
  });

  // Create a new task list
  ipcMain.handle(
    'task-lists:create',
    async (_event, name: string, description?: string): Promise<TaskList> => {
      try {
        const taskList = await createTaskList(name, description);
        broadcastTaskListChanged(taskList.id);
        return taskList;
      } catch (error) {
        console.error('[task-lists:create] Error:', error);
        throw error;
      }
    }
  );

  // Get a task list by ID
  ipcMain.handle('task-lists:get', async (_event, taskListId: string): Promise<TaskList | null> => {
    try {
      return await loadTaskList(taskListId);
    } catch (error) {
      console.error('[task-lists:get] Error:', error);
      throw error;
    }
  });

  // Delete a task list
  ipcMain.handle('task-lists:delete', async (_event, taskListId: string): Promise<void> => {
    try {
      await deleteTaskList(taskListId);
      broadcastTaskListChanged(taskListId);
    } catch (error) {
      // If task list not found, treat as success (idempotent delete)
      if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
        return;
      }
      console.error('[task-lists:delete] Error:', error);
      throw error;
    }
  });

  // Create a task
  ipcMain.handle(
    'task-lists:task-create',
    async (
      _event,
      taskListId: string,
      subject: string,
      description: string,
      activeForm?: string,
      metadata?: Record<string, unknown>
    ): Promise<Task> => {
      try {
        const task = await createTask(taskListId, subject, description, activeForm, metadata);
        broadcastTaskListChanged(taskListId);
        return task;
      } catch (error) {
        console.error('[task-lists:task-create] Error:', error);
        throw error;
      }
    }
  );

  // Batch create tasks (for Ralph Loop)
  ipcMain.handle(
    'task-lists:task-batch-create',
    async (
      _event,
      taskListId: string,
      tasks: Array<{
        subject: string;
        description: string;
        activeForm?: string;
        metadata?: Record<string, unknown>;
        blocks?: string[];
        blockedBy?: string[];
      }>
    ): Promise<Task[]> => {
      try {
        const createdTasks = await batchCreateTasks(taskListId, tasks);
        broadcastTaskListChanged(taskListId);
        return createdTasks;
      } catch (error) {
        console.error('[task-lists:task-batch-create] Error:', error);
        throw error;
      }
    }
  );

  // Update a task
  ipcMain.handle(
    'task-lists:task-update',
    async (
      _event,
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
    ): Promise<Task> => {
      try {
        const task = await updateTask(taskListId, taskId, updates);
        broadcastTaskListChanged(taskListId);
        return task;
      } catch (error) {
        console.error('[task-lists:task-update] Error:', error);
        throw error;
      }
    }
  );

  // Delete a task
  ipcMain.handle(
    'task-lists:task-delete',
    async (_event, taskListId: string, taskId: string): Promise<void> => {
      try {
        await deleteTask(taskListId, taskId);
        broadcastTaskListChanged(taskListId);
      } catch (error) {
        // If task not found, treat as success (idempotent delete)
        if (error instanceof TaskListError && error.code === 'NOT_FOUND') {
          return;
        }
        console.error('[task-lists:task-delete] Error:', error);
        throw error;
      }
    }
  );

  // Get all tasks in a task list (convenience method)
  ipcMain.handle('task-lists:tasks-list', async (_event, taskListId: string): Promise<Task[]> => {
    try {
      const taskList = await loadTaskList(taskListId);
      return taskList?.tasks || [];
    } catch (error) {
      console.error('[task-lists:tasks-list] Error:', error);
      throw error;
    }
  });
}
