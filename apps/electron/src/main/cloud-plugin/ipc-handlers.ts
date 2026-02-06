/**
 * Cloud Plugin - IPC Handlers
 *
 * All cloud-workspace and sandbox-specific IPC handlers live here,
 * extracted from the main ipc.ts to reduce merge conflicts with upstream.
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS, type CloudSyncEvent } from '../../shared/types'
import { getWorkspaceByNameOrId, addWorkspace, setActiveWorkspace } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { ipcLog } from '../logger'
import { getCloudSyncManager } from '../cloud-sync'
import { encryptAnthropicApiKey } from '../sandbox-encryption'
import { getGitInfo } from '../git'
import type { SessionManager } from '../sessions'
import type { WindowManager } from '../window-manager'

/**
 * Get workspace by ID or name, throwing if not found.
 */
function getWorkspaceOrThrow(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`)
  }
  return workspace
}

/**
 * Get cloud workspace config with API key (for sandbox operations)
 */
async function getCloudConfig(workspaceId: string) {
  const workspace = getWorkspaceOrThrow(workspaceId)
  if (workspace.storageType !== 'cloud' || !workspace.cloudConfig) {
    throw new Error('Sandbox operations require a cloud workspace')
  }

  const credManager = getCredentialManager()
  const credential = await credManager.get({ type: 'cloud_apikey', workspaceId: workspace.id })
  if (!credential) {
    throw new Error(`No API key found for cloud workspace "${workspace.name}"`)
  }

  return {
    remoteUrl: workspace.cloudConfig.remoteUrl,
    workspaceSlug: workspace.cloudConfig.workspaceSlug,
    apiKey: credential.value,
  }
}

/**
 * Register all cloud-specific IPC handlers.
 * Called from cloud-plugin/index.ts during app initialization.
 */
export function registerCloudIpcHandlers(sessionManager: SessionManager, windowManager: WindowManager): void {

  // ============================================================
  // Cloud Workspace Creation
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.CREATE_CLOUD_WORKSPACE, async (_event, name: string, remoteUrl: string, apiKey: string) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    if (!slug) throw new Error('Invalid workspace name: cannot derive slug')

    // Cloud workspaces have no local footprint — no rootPath, no local directories
    const workspace = addWorkspace({
      name,
      storageType: 'cloud',
      cloudConfig: {
        remoteUrl: remoteUrl.replace(/\/+$/, ''),
        workspaceSlug: slug,
      },
    })

    const credManager = getCredentialManager()
    await credManager.set(
      { type: 'cloud_apikey', workspaceId: workspace.id },
      { value: apiKey }
    )

    setActiveWorkspace(workspace.id)
    await sessionManager.loadSessionsForWorkspace(workspace)

    // Seed default status icons to R2 (fire-and-forget, don't block workspace creation)
    seedDefaultAssetsToCloud(remoteUrl.replace(/\/+$/, ''), slug, apiKey).catch(err => {
      ipcLog.error(`Failed to seed default assets for "${name}":`, err)
    })

    ipcLog.info(`Created cloud workspace "${name}" (slug: ${slug}) → ${remoteUrl}`)
    return workspace
  })

  ipcMain.handle(IPC_CHANNELS.SET_CLOUD_API_KEY, async (_event, workspaceId: string, apiKey: string) => {
    const workspace = getWorkspaceOrThrow(workspaceId)
    if (workspace.storageType !== 'cloud') {
      throw new Error(`Workspace "${workspace.name}" is not a cloud workspace`)
    }

    const credManager = getCredentialManager()
    await credManager.set(
      { type: 'cloud_apikey', workspaceId: workspace.id },
      { value: apiKey }
    )

    // Disconnect old provider so it reconnects with new credentials
    await getCloudSyncManager().disconnect(workspace.id)

    // Reload sessions for this workspace (connects with new key)
    const loaded = await sessionManager.loadSessionsForWorkspace(workspace)
    ipcLog.info(`Updated API key for cloud workspace "${workspace.name}", loaded ${loaded} sessions`)

    // Notify renderer to refresh session list
    const syncEvent: CloudSyncEvent = {
      workspaceId: workspace.id,
      entity: 'session',
      action: 'updated',
    }
    windowManager.broadcastToAll(IPC_CHANNELS.CLOUD_SYNC_EVENT, syncEvent)

    return { success: true }
  })

  // ============================================================
  // Sandbox Operations
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.SANDBOX_CHECK_AUTH, async (_event, workspaceId: string, repoKey: string, repoUrl: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/api/sandbox/check`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceSlug: config.workspaceSlug,
        repoKey,
        repoUrl,
      }),
    })
    if (!response.ok) throw new Error(`Failed to check sandbox auth: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_CREATE, async (_event, workspaceId: string, repoKey: string, branch: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/api/sandbox/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceSlug: config.workspaceSlug,
        repoKey,
        branch,
      }),
    })
    if (!response.ok) throw new Error(`Failed to create sandbox: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_GET_STATUS, async (_event, workspaceId: string, sessionId: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/api/sandbox/${config.workspaceSlug}/${sessionId}/status`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    })
    if (!response.ok) throw new Error(`Failed to get sandbox status: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_TERMINATE, async (_event, workspaceId: string, sessionId: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/api/sandbox/${config.workspaceSlug}/${sessionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    })
    if (!response.ok) throw new Error(`Failed to terminate sandbox: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_HEARTBEAT, async (_event, workspaceId: string, sessionId: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/api/sandbox/${config.workspaceSlug}/${sessionId}/heartbeat`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    })
    if (!response.ok) throw new Error(`Failed to send sandbox heartbeat: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_LIST_SESSIONS, async (_event, workspaceId: string) => {
    const config = await getCloudConfig(workspaceId)
    const response = await fetch(`${config.remoteUrl}/workspace/${config.workspaceSlug}/sandbox/sessions`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    })
    if (!response.ok) throw new Error(`Failed to list sandbox sessions: ${response.statusText}`)
    return response.json()
  })

  ipcMain.handle(IPC_CHANNELS.SANDBOX_ENCRYPT_API_KEY, async (_event, workspaceId: string) => {
    const config = await getCloudConfig(workspaceId)
    const credManager = getCredentialManager()
    const anthropicCred = await credManager.get({ type: 'anthropic_api_key' })
    if (!anthropicCred?.value) {
      throw new Error('No Anthropic API key configured')
    }

    const encryptedKey = await encryptAnthropicApiKey(
      anthropicCred.value,
      config.apiKey,
      config.workspaceSlug
    )

    return { encryptedKey }
  })

  // ============================================================
  // Git Info (used by sandbox for repo detection)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.GET_GIT_INFO, (_event, dirPath: string) => {
    return getGitInfo(dirPath)
  })
}

/**
 * Seed default status icon SVGs to R2 for a new cloud workspace.
 */
async function seedDefaultAssetsToCloud(remoteUrl: string, workspaceSlug: string, apiKey: string): Promise<void> {
  const { CloudAssetStorage } = await import('@craft-agent/shared/storage/cloud/assets')
  const { DEFAULT_ICON_SVGS } = await import('@craft-agent/shared/statuses/default-icons')

  const assets = new CloudAssetStorage(remoteUrl, workspaceSlug, apiKey)

  await Promise.all(
    Object.entries(DEFAULT_ICON_SVGS).map(([statusId, svg]) =>
      assets.upload(`statuses/icons/${statusId}.svg`, svg, 'image/svg+xml')
    )
  )

  ipcLog.info(`Seeded ${Object.keys(DEFAULT_ICON_SVGS).length} default status icons for workspace "${workspaceSlug}"`)
}
