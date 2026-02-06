/**
 * Cloud Plugin - Main Process Entry Point
 *
 * Consolidates all cloud-workspace functionality:
 * - Cloud IPC handlers (workspace creation, sandbox operations)
 * - Storage provider resolution (cloud vs local)
 * - Cloud sync lifecycle (startup, shutdown)
 *
 * The electron app imports and calls initCloudPlugin() at startup.
 * This keeps cloud logic out of upstream files (index.ts, ipc.ts, sessions.ts).
 */

import type { Workspace } from '@craft-agent/shared/config'
import type { IStorageProvider } from '@craft-agent/shared/storage'
import type { MainPlugin } from '../plugins'
import { registerCloudIpcHandlers } from './ipc-handlers'
import { getCloudSyncManager } from '../cloud-sync'
import type { SessionManager } from '../sessions'
import type { WindowManager } from '../window-manager'

export const cloudPlugin: MainPlugin = {
  id: 'cloud',

  async resolveStorage(workspace: Workspace): Promise<IStorageProvider | null> {
    if (workspace.storageType !== 'cloud' || !workspace.cloudConfig) return null
    return getCloudSyncManager().getProvider(workspace)
  },

  registerIpcHandlers({ sessionManager, windowManager }) {
    registerCloudIpcHandlers(sessionManager, windowManager)
  },

  async onAppReady({ sessionManager, windowManager }) {
    const cloudSyncManager = getCloudSyncManager()
    cloudSyncManager.setWindowManager(windowManager)
    cloudSyncManager.setSessionChangeHandler((workspaceId, event) =>
      sessionManager.handleRemoteSessionChange(workspaceId, event)
    )
  },

  async onAppQuit() {
    try {
      await getCloudSyncManager().disposeAll()
    } catch { /* ignore cleanup errors */ }
  },
}
