/**
 * Plugin Registry for Main Process
 *
 * Provides extension points for features like cloud workspaces and sandbox execution.
 * Plugins register via registerPlugin() and the app queries them at each hook point.
 */

import type { IpcMain } from 'electron'
import type { Workspace } from '@craft-agent/shared/config'
import type { IStorageProvider } from '@craft-agent/shared/storage'
import type { WindowManager } from './window-manager'
import type { SessionManager } from './sessions'

export interface MainPluginDeps {
  ipcMain: IpcMain
  sessionManager: SessionManager
  windowManager: WindowManager
}

export interface MainPlugin {
  id: string

  /** Register additional IPC handlers (sandbox, cloud workspace creation, etc.) */
  registerIpcHandlers?(deps: MainPluginDeps): void

  /**
   * Resolve a storage provider for a workspace.
   * Return null to fall through to the default (local) provider.
   */
  resolveStorage?(workspace: Workspace): Promise<IStorageProvider | null>

  /** Called after app.whenReady() completes */
  onAppReady?(deps: MainPluginDeps): Promise<void>

  /** Called before app quit — clean up resources */
  onAppQuit?(): Promise<void>
}

// ============================================================
// Plugin Registry (singleton)
// ============================================================

const plugins: MainPlugin[] = []

export function registerPlugin(plugin: MainPlugin): void {
  plugins.push(plugin)
}

export function getPlugins(): readonly MainPlugin[] {
  return plugins
}

/**
 * Resolve the storage provider for a workspace.
 * Queries all registered plugins; first non-null result wins.
 * Falls back to null (caller should use default local provider).
 */
export async function resolvePluginStorage(workspace: Workspace): Promise<IStorageProvider | null> {
  for (const plugin of plugins) {
    if (plugin.resolveStorage) {
      const provider = await plugin.resolveStorage(workspace)
      if (provider) return provider
    }
  }
  return null
}
