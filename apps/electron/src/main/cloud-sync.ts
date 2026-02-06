/**
 * Cloud Sync Manager
 *
 * Manages CloudStorageProvider instances for cloud workspaces.
 * Forwards remote change events to the renderer via a dedicated
 * CLOUD_SYNC_EVENT IPC channel so the UI stays in sync with the
 * cloud backend in real-time.
 */

import { IPC_CHANNELS, type CloudSyncEvent } from '../shared/types'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CloudStorageProvider, type CloudStorageProviderConfig } from '@craft-agent/shared/storage'
import type { RemoteChangeEvent } from '@craft-agent/shared/storage'
import type { Workspace } from '@craft-agent/shared/config'
import type { WindowManager } from './window-manager'
import { ipcLog } from './logger'

export class CloudSyncManager {
  private providers: Map<string, CloudStorageProvider> = new Map()
  private cleanupFns: Map<string, () => void> = new Map()
  private windowManager: WindowManager | null = null
  private sessionChangeHandler: ((workspaceId: string, event: RemoteChangeEvent) => Promise<void>) | null = null

  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  /**
   * Register a handler for session change events from the cloud.
   * Called BEFORE broadcasting to renderer so SessionManager can update its in-memory state.
   */
  setSessionChangeHandler(handler: (workspaceId: string, event: RemoteChangeEvent) => Promise<void>): void {
    this.sessionChangeHandler = handler
  }

  /**
   * Get or create a CloudStorageProvider for a cloud workspace.
   * If the provider already exists, returns the existing instance.
   * Otherwise, creates a new one, initializes it, and wires up event forwarding.
   */
  async getProvider(workspace: Workspace): Promise<CloudStorageProvider> {
    if (workspace.storageType !== 'cloud' || !workspace.cloudConfig) {
      throw new Error(`Workspace "${workspace.name}" is not a cloud workspace`)
    }

    const existing = this.providers.get(workspace.id)
    if (existing) return existing

    // Retrieve API key from CredentialManager
    const credManager = getCredentialManager()
    const credential = await credManager.get({ type: 'cloud_apikey', workspaceId: workspace.id })
    if (!credential) {
      throw new Error(`No API key found for cloud workspace "${workspace.name}"`)
    }

    const config: CloudStorageProviderConfig = {
      remoteUrl: workspace.cloudConfig.remoteUrl,
      workspaceSlug: workspace.cloudConfig.workspaceSlug,
      apiKey: credential.value,
    }

    const provider = new CloudStorageProvider(config)

    // Wire up remote change events → CLOUD_SYNC_EVENT IPC broadcasts
    const unsubscribe = provider.onRemoteChange((event: RemoteChangeEvent) => {
      this.handleRemoteChange(workspace.id, event)
    })

    this.providers.set(workspace.id, provider)
    this.cleanupFns.set(workspace.id, unsubscribe)

    // Initialize (connects WebSocket)
    try {
      await provider.initialize()
      ipcLog.info(`Cloud sync connected for workspace "${workspace.name}" (${workspace.cloudConfig.workspaceSlug})`)
    } catch (err) {
      // Clean up on failure
      this.providers.delete(workspace.id)
      this.cleanupFns.delete(workspace.id)
      unsubscribe()
      throw err
    }

    return provider
  }

  /**
   * Check if a workspace has an active cloud provider
   */
  hasProvider(workspaceId: string): boolean {
    return this.providers.has(workspaceId)
  }

  /**
   * Handle a remote change event from the cloud backend.
   * Updates SessionManager's in-memory state FIRST, then broadcasts
   * a CLOUD_SYNC_EVENT to all renderer windows for UI refresh.
   */
  private async handleRemoteChange(workspaceId: string, event: RemoteChangeEvent): Promise<void> {
    // Update SessionManager's in-memory state BEFORE notifying renderer
    // This ensures getSessions() returns fresh data when renderer refetches
    if (event.entity === 'session' && this.sessionChangeHandler) {
      try {
        await this.sessionChangeHandler(workspaceId, event)
      } catch (err) {
        ipcLog.error(`Failed to handle session change for ${workspaceId}:`, err)
      }
    }

    // Auto-download URL icons for source/status updates and upload to R2
    this.handleIconDownloads(workspaceId, event)

    // Then broadcast to renderer
    if (!this.windowManager) return

    const syncEvent: CloudSyncEvent = {
      workspaceId,
      entity: event.entity,
      action: event.action,
    }

    ipcLog.info(`Cloud remote change: ${event.entity} ${event.action} in ${workspaceId}`)
    this.windowManager.broadcastToAll(IPC_CHANNELS.CLOUD_SYNC_EVENT, syncEvent)
  }

  /**
   * Check change events for URL icons that need to be downloaded
   * and uploaded to R2. Fire-and-forget — doesn't block the sync event.
   *
   * Public so it can be called after local saves too (the DO broadcast
   * skips the sender, so remote events alone won't cover the sender's own changes).
   */
  handleIconDownloads(workspaceId: string, event: RemoteChangeEvent): void {
    const provider = this.providers.get(workspaceId)
    if (!provider?.assets) return

    const doDownload = async () => {
      const { isIconUrl } = await import('@craft-agent/shared/utils/icon-constants')
      const { downloadIconToStorage } = await import('@craft-agent/shared/utils/icon')

      if (event.entity === 'source' && (event.action === 'created' || event.action === 'updated')) {
        const source = event.data
        if (source.icon && isIconUrl(source.icon)) {
          await downloadIconToStorage(
            source.icon,
            `sources/${source.slug}/icon.svg`,
            provider.assets,
            `CloudSync:source:${source.slug}`
          )
        }
      }

      if (event.entity === 'statuses' && event.action === 'updated') {
        const statusConfig = event.data
        for (const status of statusConfig.statuses) {
          if (status.icon && isIconUrl(status.icon)) {
            await downloadIconToStorage(
              status.icon,
              `statuses/icons/${status.id}.svg`,
              provider.assets,
              `CloudSync:status:${status.id}`
            )
          }
        }
      }
    }

    doDownload().catch(err => {
      ipcLog.error(`Failed to download icons for ${event.entity} in ${workspaceId}:`, err)
    })
  }

  /**
   * Disconnect and remove a cloud provider for a workspace
   */
  async disconnect(workspaceId: string): Promise<void> {
    const provider = this.providers.get(workspaceId)
    if (!provider) return

    const cleanup = this.cleanupFns.get(workspaceId)
    if (cleanup) cleanup()

    await provider.dispose()
    this.providers.delete(workspaceId)
    this.cleanupFns.delete(workspaceId)
    ipcLog.info(`Cloud sync disconnected for workspace ${workspaceId}`)
  }

  /**
   * Disconnect all cloud providers (called on app shutdown)
   */
  async disposeAll(): Promise<void> {
    const ids = Array.from(this.providers.keys())
    await Promise.all(ids.map(id => this.disconnect(id)))
  }
}

/** Singleton instance */
let cloudSyncManager: CloudSyncManager | null = null

export function getCloudSyncManager(): CloudSyncManager {
  if (!cloudSyncManager) {
    cloudSyncManager = new CloudSyncManager()
  }
  return cloudSyncManager
}
