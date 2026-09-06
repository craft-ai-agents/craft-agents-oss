/**
 * Pages MCP action executor.
 *
 * Backs PageActionBroker.executors.executeMcp for mcp-kind grants: resolves
 * the source fresh on every call (so credential updates and OAuth refreshes
 * are picked up), builds its server config through the SAME path sessions use
 * (../sources/build-servers.ts), connects it into a workspace-scoped
 * McpClientPool, and executes the tool. The broker has already validated the
 * lease, nonce, replay cache, and grant before this runs — and enforces the
 * per-action timeout by aborting `signal`.
 *
 * Thrown errors become `{ok: false, error}` action results in the page;
 * returned strings become `{ok: true, body}`.
 */

import {
  loadWorkspaceSources,
  isSourceUsable,
  isRefreshableSource,
  getSourceCredentialManager,
  TokenRefreshManager,
  type LoadedSource,
} from '@craft-agent/shared/sources'
import { McpClientPool, proxyToolName } from '@craft-agent/shared/mcp'
import type { Logger } from '@craft-agent/server-core/runtime'
import { buildServersFromSources } from '../sources/build-servers'
import { assertPageSourceUsable } from './source-gate'

/** Cap on tool-result text returned to a page (mirrors the api-kind cap in rpc/pages.ts). */
export const MCP_ACTION_BODY_MAX_CHARS = 512 * 1024

export interface PagesMcpExecutorDeps {
  workspaceRootPath: string
  /** Workspace-scoped pool, shared across all pages of the workspace */
  pool: McpClientPool
  log: Logger
  /** Test seams — default to the real implementations */
  loadSources?: (workspaceRootPath: string) => LoadedSource[]
  buildServers?: typeof buildServersFromSources
  refreshManager?: Pick<TokenRefreshManager, 'ensureFreshToken'>
}

export function createPagesMcpExecutor(deps: PagesMcpExecutorDeps) {
  const loadSources = deps.loadSources ?? loadWorkspaceSources
  const buildServers = deps.buildServers ?? buildServersFromSources
  // One manager per workspace executor so refresh-failure cooldowns persist
  // across calls (the instance-scoped rate limit is the whole point).
  const refreshManager =
    deps.refreshManager ??
    new TokenRefreshManager(getSourceCredentialManager(), {
      log: msg => deps.log.debug(msg),
    })

  return async (
    invocation: { sourceSlug: string; toolName: string; args: Record<string, unknown> },
    options: { signal: AbortSignal },
  ): Promise<unknown> => {
    const { sourceSlug, toolName, args } = invocation

    const sources = loadSources(deps.workspaceRootPath)
    const source = sources.find(s => s.config.slug === sourceSlug)
    if (!source) {
      throw new Error(`Source "${sourceSlug}" not found in this workspace`)
    }
    // Sessions heal expired-but-refreshable tokens in their own refresh
    // cycle; pages have none, so heal here before the build — otherwise an
    // expired OAuth token dead-ends as "not connectable: Token expired"
    // forever. A failed refresh marks the source needs_auth (disk +
    // in-memory), which the gate below turns into the stable auth error.
    if (isSourceUsable(source) && isRefreshableSource(source)) {
      await refreshManager.ensureFreshToken(source)
    }
    assertPageSourceUsable(source)

    // Fresh build per call: picks up rotated credentials; ensureConnected
    // below only reconnects when the config actually changed.
    const built = await buildServers([source], undefined, undefined, undefined, deps.log)
    const config = built.mcpServers[sourceSlug]
    if (!config) {
      if (built.apiServers[sourceSlug]) {
        throw new Error(`Source "${sourceSlug}" is an API source — use an api-kind grant instead of mcp`)
      }
      const buildError = built.errors.find(e => e.sourceSlug === sourceSlug)
      if (buildError) {
        // The build may have just marked the source needs_auth (e.g. an
        // expired token with no refresh path) — prefer the stable auth
        // error over generic connect prose so the page and the reconnect
        // banner tell one story.
        const fresh = loadSources(deps.workspaceRootPath).find(s => s.config.slug === sourceSlug)
        if (fresh) assertPageSourceUsable(fresh)
        throw new Error(`Source "${sourceSlug}" is not connectable: ${buildError.error}`)
      }
      throw new Error(`Source "${sourceSlug}" did not produce an MCP server config`)
    }

    await deps.pool.ensureConnected(sourceSlug, config)

    const result = await deps.pool.callTool(proxyToolName(sourceSlug, toolName), args, {
      signal: options.signal,
    })
    if (result.isError) {
      throw new Error(result.content || `Tool ${toolName} on ${sourceSlug} failed`)
    }
    if (result.content.length > MCP_ACTION_BODY_MAX_CHARS) {
      const marker = `\n…[truncated — full result was ${result.content.length} chars]`
      return result.content.slice(0, MCP_ACTION_BODY_MAX_CHARS - marker.length) + marker
    }
    return result.content
  }
}
