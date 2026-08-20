import { existsSync } from 'node:fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  addWorkspace,
  createAndActivateLocalWorkspace,
  getActiveWorkspace,
  getWorkspaceByNameOrId,
  setActiveWorkspace,
  updateWorkspaceRemoteServer,
} from '@craft-agent/shared/config'
import { CONFIG_DIR } from '@craft-agent/shared/config/paths'
import { perf } from '@craft-agent/shared/utils'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { isValidWorkspaceRootPath } from '../../utils/path-validation'
import type { RemoteServerConfig, Workspace } from '@craft-agent/core/types'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.CHECK_SLUG,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,
  RPC_CHANNELS.window.GET_WORKSPACE,
  RPC_CHANNELS.window.GET_MODE,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.workspace.READ_IMAGE,
  RPC_CHANNELS.workspace.WRITE_IMAGE,
  RPC_CHANNELS.theme.GET_APP,
  RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.LOAD_PRESET,
  RPC_CHANNELS.theme.GET_COLOR_THEME,
  RPC_CHANNELS.theme.SET_COLOR_THEME,
  RPC_CHANNELS.theme.BROADCAST_PREFERENCES,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME,
  RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME,
  RPC_CHANNELS.views.LIST,
  RPC_CHANNELS.views.SAVE,
  RPC_CHANNELS.toolIcons.GET_MAPPINGS,
  RPC_CHANNELS.logo.GET_URL,
] as const

interface WorkspaceAuthorityInput {
  kind?: 'personal' | 'team'
  orgId?: string
}

function activationPayload(activation: {
  activeWorkspaceId: string
  workspace: Workspace
  session: {
    id: string
    name?: string
    createdAt: number
    lastUsedAt: number
  }
}) {
  return {
    workspaceId: activation.workspace.id,
    activeWorkspaceId: activation.activeWorkspaceId,
    session: {
      id: activation.session.id,
      name: activation.session.name,
      createdAt: activation.session.createdAt,
      lastUsedAt: activation.session.lastUsedAt,
    },
  }
}

export function registerWorkspaceCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  const windowManager = deps.windowManager

  // Get workspaces (LOCAL_ONLY — includes rootPath for local Electron renderer)
  server.handle(RPC_CHANNELS.workspaces.GET, async () => {
    return sessionManager.getWorkspaces()
  })

  // Create a workspace at a folder path (Obsidian-style: folder IS the
  // workspace). Local creation uses the durable create/bind/activate lifecycle.
  server.handle(
    RPC_CHANNELS.workspaces.CREATE,
    async (
      _ctx,
      folderPath: string,
      name: string,
      remoteServer?: RemoteServerConfig,
      authority?: WorkspaceAuthorityInput,
    ) => {
      const rootPath = typeof folderPath === 'string' ? folderPath.trim() : ''
      const trimmedName = typeof name === 'string' ? name.trim() : ''
      const validation = isValidWorkspaceRootPath(rootPath)
      if (!validation.valid) {
        throw new Error(validation.reason!)
      }
      if (!trimmedName) throw new Error('Workspace name is required')
      if (
        authority?.kind !== undefined &&
        authority.kind !== 'personal' &&
        authority.kind !== 'team'
      ) {
        throw new Error('Workspace kind must be personal or team')
      }
      if (authority?.orgId !== undefined && typeof authority.orgId !== 'string') {
        throw new Error('orgId must be a string when provided')
      }

      // Remote workspaces do not have a real remote prepare/commit/abort
      // endpoint in this protocol. Preserve the existing personal path only;
      // never pretend a local transaction made a remote TeamSpace atomic.
      if (remoteServer) {
        if (authority?.kind === 'team' || authority?.orgId?.trim()) {
          throw new Error(
            'Remote TeamSpace creation requires a remote prepare/commit/abort endpoint',
          )
        }
        const workspace = addWorkspace({
          name: trimmedName,
          rootPath,
          remoteServer,
        })
        setActiveWorkspace(workspace.id)
        deps.platform.logger.info(
          `Created workspace "${trimmedName}" at ${rootPath} (remote: ${remoteServer.url})`,
        )
        return workspace
      }

      const activation = await createAndActivateLocalWorkspace({
        name: trimmedName,
        rootPath,
        kind: authority?.kind,
        orgId: authority?.orgId,
      })
      sessionManager.setupConfigWatcher(
        activation.workspace.rootPath,
        activation.workspace.id,
      )
      deps.platform.logger.info(
        `Created and activated ${activation.workspace.kind} workspace "${trimmedName}" at ${rootPath}`,
      )
      return {
        ...activation.workspace,
        activation: activationPayload(activation),
      }
    },
  )

  // Check if a workspace slug already exists (for validation before creation)
  server.handle(RPC_CHANNELS.workspaces.CHECK_SLUG, async (_ctx, slug: string) => {
    const defaultWorkspacesDir = join(CONFIG_DIR, 'workspaces')
    const workspacePath = join(defaultWorkspacesDir, slug)
    const exists = existsSync(workspacePath)
    return { exists, path: workspacePath }
  })

  // Update remote server config for an existing workspace (reconnect flow)
  server.handle(RPC_CHANNELS.workspaces.UPDATE_REMOTE, async (_ctx, workspaceId: string, remoteServer: RemoteServerConfig) => {
    updateWorkspaceRemoteServer(workspaceId, remoteServer)
    deps.platform.logger.info(`Updated remote server for workspace ${workspaceId}: ${remoteServer.url}`)
    return { success: true }
  })

  // Get workspace ID for the calling window. Fresh local installs may have a
  // usable active workspace before a window mapping exists; select it locally
  // rather than forcing the renderer into a picker.
  server.handle(RPC_CHANNELS.window.GET_WORKSPACE, (ctx) => {
    const requestedWorkspaceId =
      ctx.workspaceId ??
      (ctx.webContentsId !== null
        ? windowManager?.getWorkspaceForWindow(ctx.webContentsId)
        : undefined)
    const requestedWorkspace = requestedWorkspaceId
      ? getWorkspaceByNameOrId(requestedWorkspaceId)
      : null
    const activeWorkspace = getActiveWorkspace()
    const localFallback =
      activeWorkspace && !activeWorkspace.remoteServer
        ? activeWorkspace
        : sessionManager.getWorkspaces().find((candidate) => !candidate.remoteServer)
    const workspace = requestedWorkspace ?? localFallback ?? activeWorkspace
    if (!workspace) return null

    // Validate/setup before mutating the client or window routing state.
    sessionManager.setupConfigWatcher(workspace.rootPath, workspace.id)

    if (windowManager && ctx.webContentsId !== null) {
      const current = windowManager.getWorkspaceForWindow(ctx.webContentsId)
      if (current !== workspace.id) {
        const updated = windowManager.updateWindowWorkspace(
          ctx.webContentsId,
          workspace.id,
        )
        if (!updated) {
          const win = windowManager.getWindowByWebContentsId(ctx.webContentsId)
          if (win) windowManager.registerWindow(win, workspace.id)
        }
      }
    }
    server.updateClientWorkspace?.(ctx.clientId, workspace.id)
    return workspace.id
  })

  // Get mode for the calling window (always 'main' now)
  server.handle(RPC_CHANNELS.window.GET_MODE, () => {
    return 'main'
  })

  // Switch workspace in current window (in-window switching)
  server.handle(RPC_CHANNELS.window.SWITCH_WORKSPACE, async (ctx, workspaceId: string) => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('Workspace id is required')
    }

    // Resolve membership and all persistence-facing validation before changing
    // client/window routing. On failure the prior visible workspace remains.
    const workspace = getWorkspaceByNameOrId(workspaceId.trim())
    if (!workspace) throw new Error('Workspace not found or not authorized')
    sessionManager.setupConfigWatcher(workspace.rootPath, workspace.id)

    const end = perf.start('ipc.switchWorkspace', { workspaceId: workspace.id })
    if (windowManager && ctx.webContentsId !== null) {
      const wcId = ctx.webContentsId
      const oldWorkspaceId = windowManager.getWorkspaceForWindow(wcId)
      const updated = windowManager.updateWindowWorkspace(wcId, workspace.id)
      if (!updated) {
        const win = windowManager.getWindowByWebContentsId(wcId)
        if (win) {
          windowManager.registerWindow(win, workspace.id)
          deps.platform.logger.info(`Re-registered window ${wcId} for workspace ${workspace.id}`)
        }
      }

      if (oldWorkspaceId && oldWorkspaceId !== workspace.id) {
        const otherWindows = windowManager.getAllWindowsForWorkspace(oldWorkspaceId)
        if (otherWindows.length === 0) {
          sessionManager.clearActiveViewingSession(oldWorkspaceId)
        }
      }
    }

    // Routing changes occur only after all validation/setup steps passed.
    server.updateClientWorkspace?.(ctx.clientId, workspace.id)
    end()
    return {
      workspaceId: workspace.id,
      remoteServer: workspace.remoteServer ?? null,
    }
  })

  // ============================================================
  // Workspace Image Read/Write
  // ============================================================

  // Generic workspace image loading (for source icons, status icons, etc.)
  server.handle(RPC_CHANNELS.workspace.READ_IMAGE, async (_ctx, workspaceId: string, relativePath: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { readFileSync, existsSync } = await import('fs')
    const { join, normalize } = await import('path')

    // Security: validate path
    // - Must not contain .. (path traversal)
    // - Must be a valid image extension
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    if (!existsSync(absolutePath)) {
      return null  // Missing optional files - silent fallback to default icons
    }

    // Read file as buffer
    const buffer = readFileSync(absolutePath)

    // If SVG, return as UTF-8 string (caller will use as innerHTML)
    if (ext === '.svg') {
      return buffer.toString('utf-8')
    }

    // For binary images, return as data URL
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
    }
    const mimeType = mimeTypes[ext] || 'image/png'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  })

  // Generic workspace image writing (for workspace icon, etc.)
  // Resizes images to max 256x256 to keep file sizes small
  server.handle(RPC_CHANNELS.workspace.WRITE_IMAGE, async (_ctx, workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { writeFileSync, existsSync, unlinkSync, readdirSync } = await import('fs')
    const { join, normalize, basename } = await import('path')

    // Security: validate path
    const ALLOWED_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif']

    if (relativePath.includes('..')) {
      throw new Error('Invalid path: directory traversal not allowed')
    }

    const ext = relativePath.toLowerCase().slice(relativePath.lastIndexOf('.'))
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Resolve path relative to workspace root
    const absolutePath = normalize(join(workspace.rootPath, relativePath))

    // Double-check the resolved path is still within workspace
    if (!absolutePath.startsWith(workspace.rootPath)) {
      throw new Error('Invalid path: outside workspace directory')
    }

    // If this is an icon file (icon.*), delete any existing icon files with different extensions
    const fileName = basename(relativePath)
    if (fileName.startsWith('icon.')) {
      const files = readdirSync(workspace.rootPath)
      for (const file of files) {
        if (file.startsWith('icon.') && file !== fileName) {
          const oldPath = join(workspace.rootPath, file)
          try {
            unlinkSync(oldPath)
          } catch {
            // Ignore errors deleting old icon
          }
        }
      }
    }

    // Decode base64 to buffer
    const buffer = Buffer.from(base64, 'base64')

    // For SVGs, just write directly (no resizing needed)
    if (mimeType === 'image/svg+xml' || ext === '.svg') {
      writeFileSync(absolutePath, buffer)
      return
    }

    // For raster images, resize to max 256x256
    const metadata = await deps.platform.imageProcessor.getMetadata(buffer)
    const width = metadata?.width ?? 0
    const height = metadata?.height ?? 0

    // Only resize if larger than 256px
    if (width > 256 || height > 256) {
      const resized = await deps.platform.imageProcessor.process(buffer, {
        resize: { width: 256, height: 256 },
        format: 'png',
      })
      writeFileSync(absolutePath, resized)
    } else {
      // Small enough, write as-is
      writeFileSync(absolutePath, buffer)
    }
  })

  // ============================================================
  // Theme (app-level only)
  // ============================================================

  server.handle(RPC_CHANNELS.theme.GET_APP, async () => {
    const { loadAppTheme } = await import('@craft-agent/shared/config/storage')
    return loadAppTheme()
  })

  // Preset themes (app-level)
  server.handle(RPC_CHANNELS.theme.GET_PRESETS, async () => {
    const { loadPresetThemes } = await import('@craft-agent/shared/config/storage')
    return loadPresetThemes()
  })

  server.handle(RPC_CHANNELS.theme.LOAD_PRESET, async (_ctx, themeId: string) => {
    const { loadPresetTheme } = await import('@craft-agent/shared/config/storage')
    return loadPresetTheme(themeId)
  })

  server.handle(RPC_CHANNELS.theme.GET_COLOR_THEME, async () => {
    const { getColorTheme } = await import('@craft-agent/shared/config/storage')
    return getColorTheme()
  })

  server.handle(RPC_CHANNELS.theme.SET_COLOR_THEME, async (_ctx, themeId: string) => {
    const { setColorTheme } = await import('@craft-agent/shared/config/storage')
    setColorTheme(themeId)
  })

  // Broadcast theme preferences to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_PREFERENCES, async (ctx, preferences: { mode: string; colorTheme: string; font: string }) => {
    pushTyped(server, RPC_CHANNELS.theme.PREFERENCES_CHANGED, { to: 'all' }, preferences)
  })

  // Workspace-level theme overrides
  server.handle(RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string) => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return null
    return getWorkspaceColorTheme(workspace.rootPath) ?? null
  })

  server.handle(RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, async (_ctx, workspaceId: string, themeId: string | null) => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { setWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const workspace = workspaces.find(w => w.id === workspaceId)
    if (!workspace) return
    setWorkspaceColorTheme(workspace.rootPath, themeId ?? undefined)
  })

  server.handle(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES, async () => {
    const { getWorkspaces } = await import('@craft-agent/shared/config/storage')
    const { getWorkspaceColorTheme } = await import('@craft-agent/shared/workspaces/storage')
    const workspaces = getWorkspaces()
    const themes: Record<string, string | undefined> = {}
    for (const ws of workspaces) {
      themes[ws.id] = getWorkspaceColorTheme(ws.rootPath)
    }
    return themes
  })

  // Broadcast workspace theme change to all other windows (for cross-window sync)
  server.handle(RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME, async (ctx, workspaceId: string, themeId: string | null) => {
    pushTyped(server, RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, { to: 'all' }, { workspaceId, themeId })
  })

  // ============================================================
  // Views
  // ============================================================

  // List views for a workspace (dynamic expression-based filters stored in views.json)
  server.handle(RPC_CHANNELS.views.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listViews } = await import('@craft-agent/shared/views/storage')
    return listViews(workspace.rootPath)
  })

  // Save views (replaces full array)
  server.handle(RPC_CHANNELS.views.SAVE, async (_ctx, workspaceId: string, views: import('@craft-agent/shared/views').ViewConfig[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { saveViews } = await import('@craft-agent/shared/views/storage')
    saveViews(workspace.rootPath, views)
    // Broadcast labels changed since views are used alongside labels in sidebar
    pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
  })

  // ============================================================
  // Tool Icons and Logo
  // ============================================================

  // Tool icon mappings — loads tool-icons.json and resolves each entry's icon to a data URL
  // for display in the Appearance settings page
  server.handle(RPC_CHANNELS.toolIcons.GET_MAPPINGS, async () => {
    const { getToolIconsDir } = await import('@craft-agent/shared/config/storage')
    const { loadToolIconConfig } = await import('@craft-agent/shared/utils/cli-icon-resolver')
    const { encodeIconToDataUrl } = await import('@craft-agent/shared/utils/icon-encoder')
    const { join } = await import('path')

    const toolIconsDir = getToolIconsDir()
    const config = loadToolIconConfig(toolIconsDir)
    if (!config) return []

    return config.tools
      .map(tool => {
        const iconPath = join(toolIconsDir, tool.icon)
        const iconDataUrl = encodeIconToDataUrl(iconPath)
        if (!iconDataUrl) return null
        return {
          id: tool.id,
          displayName: tool.displayName,
          iconDataUrl,
          commands: tool.commands,
        }
      })
      .filter(Boolean)
  })

  // Logo URL resolution (uses Node.js filesystem cache for provider domains)
  server.handle(RPC_CHANNELS.logo.GET_URL, async (_ctx, serviceUrl: string, provider?: string) => {
    const { getLogoUrl } = await import('@craft-agent/shared/utils/logo')
    const result = getLogoUrl(serviceUrl, provider)
    return result
  })
}
