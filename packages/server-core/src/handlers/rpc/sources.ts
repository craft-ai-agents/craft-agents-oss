import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { SourceCredentialScopeResult } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import {
  loadGlobalSources,
  readGlobalSourcesManifest,
  activateGlobalSourceInWorkspace,
  deactivateGlobalSourceInWorkspace,
  mirrorSourceToGlobal,
  loadAllSources,
  getSourcesBySlugs,
  loadGlobalSource,
  GLOBAL_WORKSPACE_ID,
  isOAuthSource,
  readGoogleAdsCredentialValue,
  type LoadedSource,
  type MirrorSourceOptions,
} from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { syncGoogleAdsCredentialCache } from './google-ads-credential-cache'
import { syncYouTubeResearchCredentialCache } from './youtube-research-credential-cache'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.GET_CREDENTIAL_SCOPE,
  RPC_CHANNELS.sources.SAVE_CREDENTIAL_OVERRIDE,
  RPC_CHANNELS.sources.SAVE_GLOBAL_CREDENTIALS,
  RPC_CHANNELS.sources.WRITE_CREDENTIAL_OVERRIDE,
  RPC_CHANNELS.sources.CLEAR_CREDENTIAL_OVERRIDE,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
  RPC_CHANNELS.sources.LIST_GLOBAL,
  RPC_CHANNELS.sources.GET_ENABLED_GLOBAL,
  RPC_CHANNELS.sources.SET_GLOBAL_ENABLED,
  RPC_CHANNELS.sources.PROMOTE_TO_GLOBAL,
] as const

/**
 * Push the global-sources changed event. Mirrors `broadcastAgentDefinitionsChanged` —
 * we go through the wsServer push surface when available and fall back to
 * silent no-op for hosts (e.g. tests) without one.
 */
export function broadcastSourcesChangedGlobal(
  deps: HandlerDeps,
  workspaceId: string | null
): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.sources.CHANGED_GLOBAL, { to: 'all' }, workspaceId)
}

function broadcastSourcesChanged(
  deps: HandlerDeps,
  workspaceId: string,
  workspaceRootPath: string,
): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  // Mirror SessionManager.broadcastSourcesChanged — sends the workspace's
  // current source list so renderer atoms refresh without a refetch round-trip.
  const sources = loadAllSources(workspaceRootPath)
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, sources)
}

async function reloadAndBroadcastGlobalCredentialChange(
  deps: HandlerDeps,
  sourceSlug: string,
  originWorkspaceId: string,
  log: HandlerDeps['platform']['logger'],
): Promise<void> {
  broadcastSourcesChangedGlobal(deps, null)

  for (const workspace of getWorkspaces()) {
    const activatedSlugs = readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
    if (!activatedSlugs.includes(sourceSlug)) continue

    await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'GLOBAL_CREDENTIALS_CHANGED')
    broadcastSourcesChanged(deps, workspace.id, workspace.rootPath)
  }

  const originWorkspace = getWorkspaceByNameOrId(originWorkspaceId)
  if (originWorkspace) {
    const activatedSlugs = readGlobalSourcesManifest(originWorkspace.rootPath).activatedSlugs
    if (!activatedSlugs.includes(sourceSlug)) {
      broadcastSourcesChanged(deps, originWorkspaceId, originWorkspace.rootPath)
    }
  }
}

async function reloadSourcesForWorkspace(deps: HandlerDeps, workspaceRootPath: string, log: HandlerDeps['platform']['logger'], label: string): Promise<void> {
  try {
    const reload = (deps.sessionManager as unknown as {
      reloadSourcesForWorkspace?: (rootPath: string) => Promise<void>
    }).reloadSourcesForWorkspace
    if (typeof reload === 'function') {
      await reload.call(deps.sessionManager, workspaceRootPath)
    }
  } catch (err) {
    log.error(`${label}: reloadSourcesForWorkspace failed:`, err)
  }
}

function resolveWorkspaceSource(workspaceId: string, sourceSlug: string): { workspace: NonNullable<ReturnType<typeof getWorkspaceByNameOrId>>; source: LoadedSource } {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const [source] = getSourcesBySlugs(workspace.rootPath, [sourceSlug])
  if (!source) {
    throw new Error(`Source not found: ${sourceSlug}`)
  }

  return { workspace, source }
}

function sourceNeedsCredentials(source: LoadedSource): boolean {
  const { type, mcp, api } = source.config

  if (source.config.slug === 'google-ads') return true
  if (source.config.slug === 'youtube-research') return true
  if (type === 'local') return false
  if (type === 'mcp') {
    if (mcp?.transport === 'stdio') return false
    return mcp?.authType === 'oauth'
      || mcp?.authType === 'bearer'
      || Boolean(mcp?.headerNames?.length)
  }
  if (type === 'api') {
    return Boolean(api?.authType && api.authType !== 'none')
  }

  return false
}

function getSourceAuthType(source: LoadedSource): string | null {
  if (source.config.slug === 'google-ads') return 'oauth'
  if (source.config.slug === 'youtube-research') return 'header'
  if (source.config.type === 'mcp') {
    if (source.config.mcp?.headerNames?.length) return 'headers'
    return source.config.mcp?.authType ?? null
  }
  if (source.config.type === 'api') return source.config.api?.authType ?? null
  return null
}

async function buildCredentialScopeResult(source: LoadedSource): Promise<SourceCredentialScopeResult> {
  const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
  const credManager = getSourceCredentialManager()
  const needsCredentials = sourceNeedsCredentials(source)

  if (source.tier === 'global-dormant') {
    return {
      scope: 'inactive',
      authType: getSourceAuthType(source),
      hasWorkspaceCredential: false,
      hasGlobalCredential: false,
      hasEffectiveCredential: false,
      canOverride: false,
      canRevert: false,
      canAuthenticate: false,
      usesOAuth: isOAuthSource(source),
    }
  }

  if (!needsCredentials) {
    return {
      scope: 'no-auth',
      authType: getSourceAuthType(source),
      hasWorkspaceCredential: false,
      hasGlobalCredential: false,
      hasEffectiveCredential: true,
      canOverride: false,
      canRevert: false,
      canAuthenticate: false,
      usesOAuth: false,
    }
  }

  const workspaceCredential = await credManager.load(source)
  const globalCredential = source.tier === 'global'
    ? await credManager.load({ ...source, workspaceId: GLOBAL_WORKSPACE_ID })
    : null
  const effectiveCredential = await credManager.loadEffective(source)
  const hasWorkspaceCredential = Boolean(workspaceCredential?.value)
  const hasGlobalCredential = Boolean(globalCredential?.value)
  const hasEffectiveCredential = Boolean(effectiveCredential?.value)
  const googleAdsCredential = source.config.slug === 'google-ads'
    ? readGoogleAdsCredentialValue(effectiveCredential?.value)
    : null

  let scope: SourceCredentialScopeResult['scope'] = 'none'
  if (source.tier === 'global' && workspaceCredential?.override === true && !workspaceCredential.value) {
    scope = 'workspace-override-empty'
  } else if (source.tier === 'global' && workspaceCredential) {
    scope = 'workspace-override'
  } else if (source.tier === 'global' && hasGlobalCredential) {
    scope = 'global'
  } else if (hasWorkspaceCredential) {
    scope = 'workspace'
  }

  return {
    scope,
    authType: getSourceAuthType(source),
    hasWorkspaceCredential,
    hasGlobalCredential,
    hasEffectiveCredential,
    canOverride: source.tier === 'global',
    canRevert: source.tier === 'global' && Boolean(workspaceCredential),
    canAuthenticate: true,
    usesOAuth: isOAuthSource(source),
    metadata: googleAdsCredential
      ? {
        googleAdsDeveloperTokenConfigured: Boolean(googleAdsCredential.developerToken?.trim()),
        googleAdsLoginCustomerIdConfigured: Boolean(googleAdsCredential.loginCustomerId?.trim()),
      }
      : undefined,
  }
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
    return loadAllSources(workspace.rootPath)
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
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const { workspace, source } = resolveWorkspaceSource(workspaceId, sourceSlug)

    // SourceCredentialManager handles credential type resolution
    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential })
    await syncGoogleAdsCredentialCache(source)
    await syncYouTubeResearchCredentialCache(source)
    await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'SAVE_CREDENTIALS')
    broadcastSourcesChanged(deps, workspaceId, workspace.rootPath)

    log.info(`Saved credentials for source: ${sourceSlug}`)
  })

  server.handle(RPC_CHANNELS.sources.GET_CREDENTIAL_SCOPE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const { source } = resolveWorkspaceSource(workspaceId, sourceSlug)
    return buildCredentialScopeResult(source)
  })

  server.handle(RPC_CHANNELS.sources.SAVE_CREDENTIAL_OVERRIDE, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const { workspace, source } = resolveWorkspaceSource(workspaceId, sourceSlug)
    if (source.tier !== 'global') {
      throw new Error('Credential override only applies to active global sources.')
    }

    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential, override: true })
    await syncGoogleAdsCredentialCache(source)
    await syncYouTubeResearchCredentialCache(source)
    await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'SAVE_CREDENTIAL_OVERRIDE')
    broadcastSourcesChanged(deps, workspaceId, workspace.rootPath)
    log.info(`Saved workspace credential override for global source: ${sourceSlug}`)
  })

  server.handle(RPC_CHANNELS.sources.SAVE_GLOBAL_CREDENTIALS, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    const source = loadGlobalSource(sourceSlug)
    if (!source) {
      throw new Error(`Global source not found: ${sourceSlug}`)
    }

    await getSourceCredentialManager().save(source, { value: credential })
    await syncGoogleAdsCredentialCache(source)
    await syncYouTubeResearchCredentialCache(source)
    await reloadAndBroadcastGlobalCredentialChange(deps, sourceSlug, workspaceId, log)
    log.info(`Saved global credentials for source: ${sourceSlug}`)
  })

  server.handle(RPC_CHANNELS.sources.WRITE_CREDENTIAL_OVERRIDE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const { source } = resolveWorkspaceSource(workspaceId, sourceSlug)
    if (source.tier !== 'global') {
      throw new Error('Credential override only applies to active global sources.')
    }

    await getSourceCredentialManager().writeOverrideMarker(source)
    // Do not reload sessions here. OAuth/manual save will install the real
    // credential next; reloading on the empty marker can temporarily suppress
    // an otherwise working global credential.
    log.info(`Started workspace credential override for global source: ${sourceSlug}`)
  })

  server.handle(RPC_CHANNELS.sources.CLEAR_CREDENTIAL_OVERRIDE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const { workspace, source } = resolveWorkspaceSource(workspaceId, sourceSlug)
    if (source.tier !== 'global') {
      throw new Error('Credential override only applies to active global sources.')
    }

    await getSourceCredentialManager().clearOverride(source)
    await syncGoogleAdsCredentialCache(source)
    await syncYouTubeResearchCredentialCache(source)
    await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'CLEAR_CREDENTIAL_OVERRIDE')
    broadcastSourcesChanged(deps, workspaceId, workspace.rootPath)
    log.info(`Cleared workspace credential override for global source: ${sourceSlug}`)
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
      const [source] = getSourcesBySlugs(workspace.rootPath, [sourceSlug])
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
          const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
          accessToken = await getSourceCredentialManager().getToken(source) ?? undefined
        }

        log.info(`Fetching MCP tools from ${source.config.mcp.url}`)
        client = new CraftMcpClient({
          transport: 'http',
          url: source.config.mcp.url,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
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

  // ------------------------------------------------------------------------
  // Global sources (Phase 2 — Lane B)
  // ------------------------------------------------------------------------

  // List every source defined globally at ~/.agents/sources/.
  server.handle(RPC_CHANNELS.sources.LIST_GLOBAL, async () => {
    return loadGlobalSources()
  })

  // Return the activatedSlugs array for a workspace's manifest.
  server.handle(RPC_CHANNELS.sources.GET_ENABLED_GLOBAL, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return [] as string[]
    return readGlobalSourcesManifest(workspace.rootPath).activatedSlugs
  })

  // Toggle a global source's activation in a workspace.
  server.handle(
    RPC_CHANNELS.sources.SET_GLOBAL_ENABLED,
    async (_ctx, workspaceId: string, slug: string, enabled: boolean) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const next = enabled
        ? activateGlobalSourceInWorkspace(workspace.rootPath, slug)
        : deactivateGlobalSourceInWorkspace(workspace.rootPath, slug)

      // Active sessions in this workspace need to re-resolve their source list.
      await reloadSourcesForWorkspace(deps, workspace.rootPath, log, 'SET_GLOBAL_ENABLED')

      broadcastSourcesChangedGlobal(deps, workspaceId)
      broadcastSourcesChanged(deps, workspaceId, workspace.rootPath)
      log.info(`Global source '${slug}' ${enabled ? 'activated' : 'deactivated'} in ${workspaceId}`)
      return next
    }
  )

  // Promote a workspace source into the global library.
  server.handle(
    RPC_CHANNELS.sources.PROMOTE_TO_GLOBAL,
    async (_ctx, workspaceId: string, slug: string, opts?: MirrorSourceOptions) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

      const result = mirrorSourceToGlobal(workspace.rootPath, slug, opts ?? {})

      broadcastSourcesChangedGlobal(deps, workspaceId)
      broadcastSourcesChanged(deps, workspaceId, workspace.rootPath)
      log.info(`Promoted source '${slug}' to global from ${workspaceId} (mirrored=${result.mirrored})`)
      return result
    }
  )
}
