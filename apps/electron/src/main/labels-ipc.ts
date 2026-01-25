/**
 * Labels IPC Handlers
 *
 * IPC handlers for workspace-scoped session labels.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import { loadLabels, createLabel, updateLabel, deleteLabel, type Label } from '@vesper/shared/labels';
import { getWorkspaceByNameOrId } from '@vesper/shared/config';

/**
 * Broadcast labels changed event to all windows
 */
function broadcastLabelsChanged(workspaceId: string): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.LABELS_CHANGED, workspaceId);
  });
}

/**
 * Get workspace root path from workspace ID
 */
function getWorkspaceRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return workspace.rootPath;
}

/**
 * Register labels IPC handlers
 */
export function registerLabelsIpc(): void {
  // List all labels for a workspace
  ipcMain.handle(IPC_CHANNELS.LABELS_LIST, async (_event, workspaceId: string): Promise<Label[]> => {
    try {
      const rootPath = getWorkspaceRootPath(workspaceId);
      return loadLabels(rootPath);
    } catch (error) {
      console.error('[labels:list] Error:', error);
      throw error;
    }
  });

  // Create a new label
  ipcMain.handle(
    IPC_CHANNELS.LABELS_CREATE,
    async (_event, workspaceId: string, name: string, color: string): Promise<Label> => {
      try {
        const rootPath = getWorkspaceRootPath(workspaceId);
        const label = createLabel(rootPath, name, color);
        broadcastLabelsChanged(workspaceId);
        return label;
      } catch (error) {
        console.error('[labels:create] Error:', error);
        throw error;
      }
    }
  );

  // Update an existing label
  ipcMain.handle(
    IPC_CHANNELS.LABELS_UPDATE,
    async (_event, workspaceId: string, labelId: string, updates: { name?: string; color?: string }): Promise<Label> => {
      try {
        const rootPath = getWorkspaceRootPath(workspaceId);
        const label = updateLabel(rootPath, labelId, updates);
        broadcastLabelsChanged(workspaceId);
        return label;
      } catch (error) {
        console.error('[labels:update] Error:', error);
        throw error;
      }
    }
  );

  // Delete a label (cascades removal from all sessions)
  ipcMain.handle(
    IPC_CHANNELS.LABELS_DELETE,
    async (_event, workspaceId: string, labelId: string): Promise<void> => {
      try {
        const rootPath = getWorkspaceRootPath(workspaceId);
        deleteLabel(rootPath, labelId);
        broadcastLabelsChanged(workspaceId);
      } catch (error) {
        console.error('[labels:delete] Error:', error);
        throw error;
      }
    }
  );
}
