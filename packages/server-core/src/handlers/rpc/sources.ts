import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getDefaultLlmConnection, getLlmConnection, getMiniModel, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { createBackendFromConnection } from '@craft-agent/shared/agent/backend'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { buildBackendHostRuntimeContext } from '../utils'
import type { Workspace } from '@craft-agent/shared/config'
import type { AgentBackend } from '@craft-agent/shared/agent/backend'
import type { McpImportCandidate, McpSourceGuideGenerationContext, McpSourceGuideGenerator } from '@craft-agent/shared/sources'
import type { FolderSourceConfig, LoadedSource, SourceConnectionStatus, SourceGuide } from '@craft-agent/shared/sources/types'
import type { McpToolsResult } from '@craft-agent/shared/protocol'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.UPDATE,
  RPC_CHANNELS.sources.PARSE_MCP_JSON_IMPORT,
  RPC_CHANNELS.sources.IMPORT_MCP_JSON_CANDIDATES,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.CHECK_ADMIN,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.permissions.MDP_LIST,
  RPC_CHANNELS.permissions.MDP_SAVE_OR_UPDATE,
  RPC_CHANNELS.permissions.MDP_DELETE,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
  RPC_CHANNELS.sources.REFRESH_MCP_TOOLS,
  RPC_CHANNELS.sources.GENERATE_GUIDE,
] as const

export function registerSourcesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get all sources for a workspace
  server.handle(RPC_CHANNELS.sources.GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    return loadWorkspaceSources(workspace.rootPath)
  })

  // Create a new source
  server.handle(RPC_CHANNELS.sources.CREATE, async (_ctx, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput> & Partial<import('@craft-agent/shared/sources').McpManualSourceInput>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createMcpSourceFromManualInput, createSource, defaultMcpPostCreateConnectionTester, stdioCommandFingerprint } = await import('@craft-agent/shared/sources')
    const enableInWorkspace = config.enableInWorkspace ?? true
    if ((config.type ?? 'mcp') === 'mcp' && config.mcp) {
      // Auto-confirm stdio commands — user confirmed by submitting the form.
      let confirmedStdioCommands: Record<string, true> | undefined;
      if (config.mcp.transport === 'stdio' && config.mcp.command) {
        const fingerprint = stdioCommandFingerprint(config.mcp.command, config.mcp.args);
        confirmedStdioCommands = { [fingerprint]: true };
      }
      const created = await createMcpSourceFromManualInput(workspace.rootPath, {
        name: config.name || 'New Source',
        provider: config.provider || 'custom',
        enabled: config.enabled ?? true,
        icon: config.icon,
        mcp: config.mcp,
        authCredential: config.authCredential,
      }, {
        connectionTester: defaultMcpPostCreateConnectionTester,
        confirmedStdioCommands,
        guideGenerator: createMcpSourceGuideGenerator(deps, workspace),
      })
      if (enableInWorkspace) {
        addSlugToWorkspaceDefaults(workspace.rootPath, created.slug)
      }
      const poolRefresh = await deps.sessionManager.refreshWorkspaceMcpSource(workspace.rootPath, created.slug)
      if (!poolRefresh.success) {
        log.warn(`SOURCES_CREATE: MCP source pool refresh failed for ${created.slug}: ${poolRefresh.error}`)
      }
      pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
      return created
    }
    const created = createSource(workspace.rootPath, {
      name: config.name || 'New Source',
      provider: config.provider || 'custom',
      type: config.type || 'mcp',
      enabled: config.enabled ?? true,
      mcp: config.mcp,
      api: config.api,
      local: config.local,
    })
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
    return created
  })

  // Update an existing source with full overwrite semantics
  server.handle(RPC_CHANNELS.sources.UPDATE, async (_ctx, workspaceId: string, sourceSlug: string, config: Partial<import('@craft-agent/shared/sources/types').FolderSourceConfig> & { authCredential?: string }) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig, saveSourceConfig, loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')

    const existing = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!existing) throw new Error(`Source not found: ${sourceSlug}`)

    // Build updated config preserving identity fields, overwriting editable fields
    const updated: import('@craft-agent/shared/sources/types').FolderSourceConfig = {
      ...existing,
      ...config,
      slug: existing.slug,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    }

    // Save auth credential if provided
    if (config.authCredential) {
      const source = loadSource(workspace.rootPath, sourceSlug)
      if (source) {
        const credManager = getSourceCredentialManager()
        await credManager.save(source, { value: config.authCredential })
      }
    }

    saveSourceConfig(workspace.rootPath, updated)

    if (updated.type === 'mcp') {
      const connectionRefresh = await refreshMcpSourceConnection(workspace.rootPath, sourceSlug)
      if (!connectionRefresh.success) {
        await deps.sessionManager.removeWorkspaceMcpSource(workspace.rootPath, sourceSlug)
      } else {
        const poolRefresh = await deps.sessionManager.refreshWorkspaceMcpSource(workspace.rootPath, sourceSlug)
        if (!poolRefresh.success) {
          log.warn(`SOURCES_UPDATE: MCP source pool refresh failed for ${sourceSlug}: ${poolRefresh.error}`)
        }
      }
    }

    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
    return loadSourceConfig(workspace.rootPath, sourceSlug) ?? updated
  })

  server.handle(RPC_CHANNELS.sources.PARSE_MCP_JSON_IMPORT, async (_ctx, workspaceId: string, json: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { detectDuplicateMcpImportCandidates, parseMcpJsonImportCandidates } = await import('@craft-agent/shared/sources')
    const parsed = parseMcpJsonImportCandidates(json)
    return {
      ...parsed,
      candidates: detectDuplicateMcpImportCandidates(workspace.rootPath, parsed.candidates),
    }
  })

  server.handle(RPC_CHANNELS.sources.IMPORT_MCP_JSON_CANDIDATES, async (_ctx, workspaceId: string, candidates: McpImportCandidate[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createMcpSourcesFromCandidates, defaultMcpPostCreateConnectionTester, stdioCommandFingerprint } = await import('@craft-agent/shared/sources')
    // Auto-confirm stdio commands — user confirmed by selecting and importing in the preview.
    const confirmedStdioCommands: Record<string, true> = {};
    for (const candidate of candidates) {
      if (candidate.input.mcp?.transport === 'stdio' && candidate.input.mcp.command) {
        const fingerprint = stdioCommandFingerprint(candidate.input.mcp.command, candidate.input.mcp.args);
        confirmedStdioCommands[fingerprint] = true;
      }
    }
    const result = await createMcpSourcesFromCandidates(workspace.rootPath, candidates, {
      connectionTester: defaultMcpPostCreateConnectionTester,
      confirmedStdioCommands: Object.keys(confirmedStdioCommands).length > 0 ? confirmedStdioCommands : undefined,
      guideGenerator: createMcpSourceGuideGenerator(deps, workspace),
    })
    // Add successfully created sources with enableInWorkspace to workspace defaults
    for (const r of result.results) {
      if (!r.success || 'skipped' in r) continue
      const candidate = candidates.find((c) => c.key === r.key)
      if (candidate?.enableInWorkspace ?? true) {
        addSlugToWorkspaceDefaults(workspace.rootPath, r.sourceSlug)
      }
      const poolRefresh = await deps.sessionManager.refreshWorkspaceMcpSource(workspace.rootPath, r.sourceSlug)
      if (!poolRefresh.success) {
        log.warn(`SOURCES_IMPORT: MCP source pool refresh failed for ${r.sourceSlug}: ${poolRefresh.error}`)
      }
    }
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
    return result
  })

  // Delete a source
  server.handle(RPC_CHANNELS.sources.DELETE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteSource } = await import('@craft-agent/shared/sources')
    deleteSource(workspace.rootPath, sourceSlug)
    await deps.sessionManager.removeWorkspaceMcpSource(workspace.rootPath, sourceSlug)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))

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

  server.handle(RPC_CHANNELS.permissions.CHECK_ADMIN, async () => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const session = await new SsoCredentialStore().load()
    if (!session) return false

    const baseUrl =
      process.env.VITE_PERMISSION_API_URL ||
      process.env.MDP_API_URL ||
      ''

    if (!baseUrl) return false

    const url = `${baseUrl.replace(/\/+$/, '')}/api/mdp/permission/checkAdmin?employeeId=${encodeURIComponent(session.employeeId)}`
    const res = await fetch(url, {
      headers: { authorization: session.token },
    })
    if (!res.ok) return false

    const json = await res.json() as { body?: boolean }
    return json.body === true
  })

  server.handle(RPC_CHANNELS.permissions.MDP_LIST, async () => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('Not authenticated')

    const baseUrl = (process.env.VITE_PERMISSION_API_URL || process.env.MDP_API_URL || '').replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/api/mdp/permission/list`, {
      headers: { authorization: session.token },
    })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    const json = await res.json() as { body: unknown }
    return json.body
  })

  server.handle(RPC_CHANNELS.permissions.MDP_SAVE_OR_UPDATE, async (_ctx, payload: { employeeId: string; userType: string }) => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('Not authenticated')

    const baseUrl = (process.env.VITE_PERMISSION_API_URL || process.env.MDP_API_URL || '').replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/api/mdp/permission/saveOrUpdate`, {
      method: 'POST',
      headers: { authorization: session.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: payload.employeeId, userType: payload.userType }),
    })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    const json = await res.json() as { body: unknown }
    return json.body
  })

  server.handle(RPC_CHANNELS.permissions.MDP_DELETE, async (_ctx, payload: { employeeId: string }) => {
    const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
    const session = await new SsoCredentialStore().load()
    if (!session) throw new Error('Not authenticated')

    const baseUrl = (process.env.VITE_PERMISSION_API_URL || process.env.MDP_API_URL || '').replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/api/mdp/permission/delete?employeeId=${encodeURIComponent(payload.employeeId)}`, {
      method: 'POST',
      headers: { authorization: session.token },
    })
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  })

  // Get default permissions from ~/.mdp-agent/permissions/default.json
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

      return await listMcpToolsForSource(workspace.rootPath, source)
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

  server.handle(RPC_CHANNELS.sources.REFRESH_MCP_TOOLS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    const refreshResult = await refreshMcpSourceConnection(workspace.rootPath, sourceSlug)
    if (!refreshResult.success) {
      await deps.sessionManager.removeWorkspaceMcpSource(workspace.rootPath, sourceSlug)
      pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
      return { success: false, error: refreshResult.error }
    }

    const poolRefresh = await deps.sessionManager.refreshWorkspaceMcpSource(workspace.rootPath, sourceSlug)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
    if (!poolRefresh.success) {
      return { success: false, error: poolRefresh.error }
    }

    const source = loadWorkspaceSources(workspace.rootPath).find(s => s.config.slug === sourceSlug)
    if (!source) return { success: false, error: 'Source not found after refresh' }
    return listMcpToolsForSource(workspace.rootPath, source)
  })

  server.handle(RPC_CHANNELS.sources.GENERATE_GUIDE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    const { generateMcpSourceGuide, loadSource, saveSourceGuide } = await import('@craft-agent/shared/sources')
    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) return { success: false, error: 'Source not found' }
    if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }

    const existingContext = source.guide?.context?.split(/\n\n?Transport:/)[0]?.trim()
    const fallbackGuide = generateMcpSourceGuide(source.config, existingContext || source.config.tagline)
    const tools = await getMcpToolNamesForGuide(workspace.rootPath, source)
    const generatedGuide = await createMcpSourceGuideGenerator(deps, workspace)({
      config: source.config,
      description: existingContext || source.config.tagline,
      ...(tools.length ? { tools } : {}),
      fallbackGuide,
    })
    const guide = generatedGuide ?? fallbackGuide
    saveSourceGuide(workspace.rootPath, sourceSlug, guide)
    pushTyped(server, RPC_CHANNELS.sources.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadWorkspaceSources(workspace.rootPath))
    return { success: true, guide }
  })
}

export function createMcpSourceGuideGenerator(deps: HandlerDeps, workspace: Workspace): McpSourceGuideGenerator {
  return async (context) => {
    const prompt = buildMcpSourceGuidePrompt(context)
    const text = await runMcpGuideMiniCompletion(deps, workspace, prompt)
    return normalizeAiSourceGuide(text, context.fallbackGuide)
  }
}

function buildMcpSourceGuidePrompt(context: McpSourceGuideGenerationContext): string {
  const { config, description, tools } = context
  const mcp = config.mcp
  const endpoint = mcp?.transport === 'stdio'
    ? [mcp.command, ...(mcp.args ?? [])].filter(Boolean).join(' ')
    : mcp?.url
  const auth = mcp?.transport === 'stdio'
    ? 'local command environment'
    : mcp?.headerNames?.length
      ? `header credential names: ${mcp.headerNames.join(', ')}`
      : mcp?.authType ?? 'not specified'

  return `Generate a useful source guide for an agent that can use this MCP server.

Return only Markdown. Do not wrap it in code fences. Do not invent secrets, credentials, or unsupported endpoints.
The guide must have exactly these sections:
# ${config.name}
## Guidelines
## Context
## API Notes

Make it concrete and operational:
- Explain when the agent should choose this MCP source.
- Infer likely workflows from the source name, provider, description, endpoint, and discovered tools.
- Mention useful tool categories or exact tool names when provided.
- Include retry/auth/refresh guidance only when relevant.
- Keep it concise: 6-10 bullets total plus a short context paragraph.

Source:
- Name: ${config.name}
- Slug: ${config.slug}
- Provider: ${config.provider}
- Description: ${description?.trim() || config.tagline || 'Not provided'}
- Transport: ${mcp?.transport ?? 'not configured'}
- Endpoint or command: ${endpoint || 'not configured'}
- Authentication: ${auth}
- Discovered tools: ${tools?.length ? tools.slice(0, 80).join(', ') : 'Not available yet'}

Fallback guide for safety:
${context.fallbackGuide.raw}`
}

async function runMcpGuideMiniCompletion(deps: HandlerDeps, workspace: Workspace, prompt: string): Promise<string | null> {
  const connectionSlug = getDefaultLlmConnection()
  if (!connectionSlug) return null
  const connection = getLlmConnection(connectionSlug)
  if (!connection) return null

  let agent: AgentBackend | null = null
  try {
    agent = createBackendFromConnection(connectionSlug, {
      workspace,
      miniModel: getMiniModel(connection) ?? connection.defaultModel,
      session: {
        id: `source-guide-${Date.now()}`,
        workspaceRootPath: workspace.rootPath,
        llmConnection: connectionSlug,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      },
      isHeadless: true,
    }, buildBackendHostRuntimeContext(deps.platform))
    await agent.postInit()
    return await agent.runMiniCompletion(prompt)
  } catch (error) {
    deps.platform.logger.warn('Failed to generate MCP source guide with AI:', error)
    return null
  } finally {
    agent?.destroy()
  }
}

function normalizeAiSourceGuide(text: string | null | undefined, fallbackGuide: SourceGuide): SourceGuide | null {
  if (!text?.trim()) return null
  let raw = text.trim()
  const fenced = raw.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1]) raw = fenced[1].trim()
  if (!/^#\s+.+/m.test(raw)) raw = `${fallbackGuide.raw.split('\n')[0]}\n\n${raw}`
  const hasRequiredSections = ['## Guidelines', '## Context', '## API Notes'].every(section => raw.includes(section))
  if (!hasRequiredSections) return null
  if (/\b(sk-[A-Za-z0-9]|api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,})/i.test(raw)) return null
  return { raw: `${raw.replace(/\s+$/g, '')}\n` }
}

async function getMcpToolNamesForGuide(workspaceRootPath: string, source: LoadedSource): Promise<string[]> {
  try {
    if (source.config.connectionStatus && source.config.connectionStatus !== 'connected') return []
    const result = await listMcpToolsForSource(workspaceRootPath, source)
    if (!result.success) return []
    return (result.tools ?? []).map(tool => tool.name)
  } catch {
    return []
  }
}

async function refreshMcpSourceConnection(workspaceRootPath: string, sourceSlug: string): Promise<{ success: boolean; error?: string }> {
  const { defaultMcpPostCreateConnectionTester, getSourceCredentialManager, loadSource, loadSourceConfig, saveSourceConfig } = await import('@craft-agent/shared/sources')
  const source = loadSource(workspaceRootPath, sourceSlug)
  if (!source) return { success: false, error: 'Source not found' }
  if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }

  const startedAt = Date.now()
  try {
    const credential = await getSourceCredentialManager().load(source)
    const result = await defaultMcpPostCreateConnectionTester({
      source,
      ...(credential?.value ? { credentialValue: credential.value } : {}),
    })
    const config = loadSourceConfig(workspaceRootPath, sourceSlug)
    if (config) {
      config.lastTestedAt = startedAt
      if (result.success) {
        config.isAuthenticated = true
        config.connectionStatus = 'connected'
        config.connectionError = undefined
      } else {
        config.isAuthenticated = false
        config.connectionStatus = getFailedConnectionStatus(result.errorType)
        config.connectionError = result.error || 'Connection test failed'
      }
      saveSourceConfig(workspaceRootPath, config)
    }
    return result.success
      ? { success: true }
      : { success: false, error: result.error || 'Connection test failed' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const config = loadSourceConfig(workspaceRootPath, sourceSlug)
    if (config) {
      config.lastTestedAt = startedAt
      config.isAuthenticated = false
      config.connectionStatus = 'failed'
      config.connectionError = message
      saveSourceConfig(workspaceRootPath, config)
    }
    return { success: false, error: message }
  }
}

function getFailedConnectionStatus(errorType: 'failed' | 'needs-auth' | 'pending' | 'invalid-schema' | 'disabled' | 'unknown' | undefined): SourceConnectionStatus {
  return errorType === 'needs-auth' ? 'needs_auth' : 'failed'
}

async function listMcpToolsForSource(workspaceRootPath: string, source: LoadedSource): Promise<McpToolsResult> {
  if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
  if (!source.config.mcp) return { success: false, error: 'MCP config not found' }

  const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
  let client: InstanceType<typeof CraftMcpClient>

  if (source.config.mcp.transport === 'stdio') {
    if (!source.config.mcp.command) {
      return { success: false, error: 'Stdio MCP source is missing required "command" field' }
    }
    client = new CraftMcpClient({
      transport: 'stdio',
      command: source.config.mcp.command,
      args: source.config.mcp.args,
      env: source.config.mcp.env,
    })
  } else {
    if (!source.config.mcp.url) {
      return { success: false, error: 'MCP source URL is required for Streamable HTTP transport' }
    }

    const headers: Record<string, string> = { ...(source.config.mcp.headers ?? {}) }
    const { getSourceCredentialManager } = await import('@craft-agent/shared/sources')
    const credential = await getSourceCredentialManager().load(source)
    if (credential?.value) {
      try {
        Object.assign(headers, JSON.parse(credential.value))
      } catch {
        if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
          headers.Authorization = `Bearer ${credential.value}`
        }
      }
    }
    if (source.config.mcp.authType === 'bearer') {
      const { SsoCredentialStore } = await import('@craft-agent/shared/auth')
      const idToken = (await new SsoCredentialStore().load().catch(() => null))?.idToken
      if (idToken) {
        headers.Authorization = `Bearer ${idToken}`
      }
    }

    client = new CraftMcpClient({
      transport: 'streamable_http',
      url: source.config.mcp.url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })
  }

  try {
    const tools = await client.listTools()
    const { permissionsConfigCache } = await import('@craft-agent/shared/agent')
    const mergedConfig = permissionsConfigCache.getMergedConfig({
      workspaceRootPath,
      activeSourceSlugs: [source.config.slug],
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
  } finally {
    await client.close()
  }
}

async function addSlugToWorkspaceDefaults(workspaceRootPath: string, slug: string): Promise<void> {
  const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
  const wsConfig = loadWorkspaceConfig(workspaceRootPath)
  if (!wsConfig) return
  wsConfig.defaults ??= {}
  wsConfig.defaults.enabledSourceSlugs ??= []
  if (!wsConfig.defaults.enabledSourceSlugs.includes(slug)) {
    wsConfig.defaults.enabledSourceSlugs.push(slug)
    saveWorkspaceConfig(workspaceRootPath, wsConfig)
  }
}
