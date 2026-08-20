import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { ensureLocalNotesSource, loadSourceConfig, loadWorkspaceSources, saveSourceConfig, saveSourceGuide, type FolderSourceConfig } from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { getDefaultWorkspacesDir, loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { KnowledgeConnectionsStore, credentialIdFromRef } from '../../knowledge'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.UPDATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
  RPC_CHANNELS.sources.REINDEX,
  RPC_CHANNELS.sources.SEARCH,
] as const

function ensureNotesSource(workspaceRoot: string, workspaceId: string): void {
  const wsConfig = loadWorkspaceConfig(workspaceRoot)
  const notesPath = wsConfig?.notesPath ?? join(getDefaultWorkspacesDir(), workspaceId, 'notes')
  ensureLocalNotesSource(workspaceRoot, notesPath)
}

export function registerSourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get all sources for a workspace
  server.handle(RPC_CHANNELS.sources.GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    ensureNotesSource(workspace.rootPath, workspace.id)
    return loadWorkspaceSources(workspace.rootPath)
  })

  // Create a new source
  server.handle(RPC_CHANNELS.sources.CREATE, async (_ctx, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createSource } = await import('@craft-agent/shared/sources')
    return createSource(workspace.rootPath, {
      name: config.name || 'New Source',
      provider: config.provider || 'custom',
      type: config.type || 'mcp',
      enabled: config.enabled ?? true,
      mcp: config.mcp,
      api: config.api,
      local: config.local,
    })
  })

  // Update an existing source's editable fields (name, enabled, url/path, tagline, guide)
  server.handle(RPC_CHANNELS.sources.UPDATE, async (
    _ctx,
    workspaceId: string,
    sourceSlug: string,
    updates: {
      name?: string
      enabled?: boolean
      tagline?: string
      /** URL or path depending on source type (mcp.url / api.baseUrl / local.path) */
      url?: string
      /** guide.md raw markdown */
      guide?: string
    },
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceSlug)) {
      throw new Error(`Invalid source slug: ${sourceSlug}`)
    }

    const existing = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!existing) throw new Error(`Source not found: ${sourceSlug}`)

    const next: FolderSourceConfig = {
      ...existing,
      updatedAt: Date.now(),
    }

    if (typeof updates.name === 'string' && updates.name.trim()) {
      next.name = updates.name.trim()
    }
    if (typeof updates.enabled === 'boolean') {
      next.enabled = updates.enabled
    }
    if (typeof updates.tagline === 'string') {
      next.tagline = updates.tagline
    }

    if (typeof updates.url === 'string') {
      const url = updates.url.trim()
      if (next.type === 'mcp') {
        next.mcp = { ...(next.mcp ?? {}), url: url || undefined }
      } else if (next.type === 'api') {
        if (!url) throw new Error('API base URL is required')
        next.api = { ...(next.api ?? { authType: 'none' }), baseUrl: url }
      } else if (next.type === 'local') {
        if (!url) throw new Error('Local path is required')
        next.local = { ...(next.local ?? {}), path: url }
      }
    }

    saveSourceConfig(workspace.rootPath, next)

    if (typeof updates.guide === 'string') {
      saveSourceGuide(workspace.rootPath, sourceSlug, { raw: updates.guide })
    }

    // Return fully loaded source for the UI
    const { loadSource } = await import('@craft-agent/shared/sources')
    const loaded = loadSource(workspace.rootPath, sourceSlug)
    if (!loaded) throw new Error(`Source not found after update: ${sourceSlug}`)

    // Notify subscribers (same shape as watcher broadcasts)
    const sources = loadWorkspaceSources(workspace.rootPath)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)

    return loaded
  })

  // Delete a source
  server.handle(RPC_CHANNELS.sources.DELETE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteSource } = await import('@craft-agent/shared/sources')
    deleteSource(workspace.rootPath, sourceSlug)

    // Clean up stale slug from workspace default sources
    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (config?.defaults?.enabledSourceSlugs?.includes(sourceSlug)) {
      config.defaults.enabledSourceSlugs = config.defaults.enabledSourceSlugs.filter(s => s !== sourceSlug)
      saveWorkspaceConfig(workspace.rootPath, config)
    }
  })

  // Start OAuth flow for a source (DEPRECATED — use oauth:start + performOAuth client-side)
  // Kept for backward compatibility with old IPC preload; WS clients use performOAuth().
  server.handle(RPC_CHANNELS.sources.START_OAUTH, async () => {
    return {
      success: false,
      error: 'Deprecated: use the client-side performOAuth() flow (oauth:start + oauth:complete) instead',
    }
  })

  // Save credentials for a source (bearer token or API key)
  server.handle(RPC_CHANNELS.sources.SAVE_CREDENTIALS, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      // Knowledge bridge (P1): knowledge connections are not sources, but their
      // bearer token is stored under the same key contract
      // source_bearer::{workspaceId}::{connectionId} (spec 04 §3.3.1). Only
      // accept the fallback when a knowledge connection with this id exists,
      // so mistyped source slugs still fail loudly.
      const record = new KnowledgeConnectionsStore().get(sourceSlug)
      if (record) {
        // The read side resolves the record's credentialRef verbatim — the
        // workspace segment of THAT key, not the active workspace from this
        // call. On multi-workspace installs the two differ and a key written
        // under the active workspace can never be read back (P2-12).
        const id = credentialIdFromRef(record.credentialRef)
        await getCredentialManager().set(
          { type: 'source_bearer', workspaceId: id?.workspaceId ?? workspaceId, sourceId: sourceSlug },
          { value: credential },
        )
        log.info(`Saved bearer credential for knowledge connection: ${sourceSlug}`)
        return
      }
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    // SourceCredentialManager handles credential type resolution
    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential })

    log.info(`Saved credentials for source: ${sourceSlug}`)
  })

  // Get permissions config for a source (raw format for UI display)
  server.handle(RPC_CHANNELS.sources.GET_PERMISSIONS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getSourcePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getSourcePermissionsPath(workspace.rootPath, sourceSlug)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading permissions config:', error)
      return null
    }
  })

  // Get permissions config for a workspace (raw format for UI display)
  server.handle(RPC_CHANNELS.workspace.GET_PERMISSIONS, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getWorkspacePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getWorkspacePermissionsPath(workspace.rootPath)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading workspace permissions config:', error)
      return null
    }
  })

  // Get default permissions from ~/.craft-agent/permissions/default.json
  server.handle(RPC_CHANNELS.permissions.GET_DEFAULTS, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@craft-agent/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: safeJsonParse(content), path: defaultPath }
    } catch (error) {
      log.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })

  // Get MCP tools for a source with permission status
  server.handle(RPC_CHANNELS.sources.GET_MCP_TOOLS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    try {
      const sources = await loadWorkspaceSources(workspace.rootPath)
      const source = sources.find(s => s.config.slug === sourceSlug)
      if (!source) return { success: false, error: 'Source not found' }
      if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
      if (!source.config.mcp) return { success: false, error: 'MCP config not found' }

      if (source.config.connectionStatus === 'needs_auth') {
        return { success: false, error: 'Source requires authentication' }
      }
      if (source.config.connectionStatus === 'failed') {
        return { success: false, error: source.config.connectionError || 'Connection failed' }
      }
      if (source.config.connectionStatus === 'untested') {
        return { success: false, error: 'Source has not been tested yet' }
      }

      const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
      let client: InstanceType<typeof CraftMcpClient>

      if (source.config.mcp.transport === 'stdio') {
        if (!source.config.mcp.command) {
          return { success: false, error: 'Stdio MCP source is missing required "command" field' }
        }
        log.info(`Fetching MCP tools via stdio: ${source.config.mcp.command}`)
        client = new CraftMcpClient({
          transport: 'stdio',
          command: source.config.mcp.command,
          args: source.config.mcp.args,
          env: source.config.mcp.env,
        })
      } else {
        if (!source.config.mcp.url) {
          return { success: false, error: 'MCP source URL is required for HTTP/SSE transport' }
        }

        let accessToken: string | undefined
        if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
          const credentialManager = getCredentialManager()
          const credentialId = source.config.mcp.authType === 'oauth'
            ? { type: 'source_oauth' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
            : { type: 'source_bearer' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
          const credential = await credentialManager.get(credentialId)
          accessToken = credential?.value
        }

        log.info(`Fetching MCP tools from ${source.config.mcp.url}`)
        const headers: Record<string, string> = {
          ...(source.config.mcp.headers || {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        }
        client = new CraftMcpClient({
          transport: 'http',
          url: source.config.mcp.url,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        })
      }

      const tools = await client.listTools()
      await client.close()

      const { loadSourcePermissionsConfig, permissionsConfigCache } = await import('@craft-agent/shared/agent')
      const permissionsConfig = loadSourcePermissionsConfig(workspace.rootPath, sourceSlug)

      const mergedConfig = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: workspace.rootPath,
        activeSourceSlugs: [sourceSlug],
      })

      const toolsWithPermission = tools.map(tool => {
        const allowed = mergedConfig.readOnlyMcpPatterns.some((pattern: RegExp) => pattern.test(tool.name))
        return {
          name: tool.name,
          description: tool.description,
          allowed,
        }
      })

      return { success: true, tools: toolsWithPermission }
    } catch (error) {
      log.error('Failed to get MCP tools:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
      if (errorMessage.includes('404')) {
        return { success: false, error: 'MCP server endpoint not found. The server may be offline or the URL may be incorrect.' }
      }
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return { success: false, error: 'Authentication failed. Please re-authenticate with this source.' }
      }
      return { success: false, error: errorMessage }
    }
  })

  // Rebuild local FTS/keyword index under {workspace}/.craft/source-index.sqlite
  server.handle(RPC_CHANNELS.sources.REINDEX, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const sources = loadWorkspaceSources(workspace.rootPath)
    const roots: Array<{ slug: string; path: string }> = []
    for (const src of sources) {
      if (src.config.type !== 'local') continue
      const p = src.config.local?.path
      if (!p) continue
      roots.push({ slug: src.config.slug, path: p })
    }

    const { reindexWorkspaceSources, countIndexedFiles } = await import('../../sources/source-index')
    const result = reindexWorkspaceSources(workspace.rootPath, roots)
    return {
      ...result,
      fileCount: countIndexedFiles(workspace.rootPath),
      rootCount: roots.length,
    }
  })

  // Keyword search over the local source index (FTS5 or LIKE)
  server.handle(
    RPC_CHANNELS.sources.SEARCH,
    async (_ctx, workspaceId: string, query: string, limit?: number) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
      const { searchSourceIndex } = await import('../../sources/source-index')
      return searchSourceIndex(workspace.rootPath, typeof query === 'string' ? query : '', {
        limit: typeof limit === 'number' ? limit : 20,
      })
    },
  )
}
