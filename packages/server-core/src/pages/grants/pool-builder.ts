/**
 * Builds the workspace connector pool for Craft Pages (ADR 0001, WS7).
 *
 * Deliberately narrower than the session pool: a page can only ever call tools
 * on the curated read-only allowlist, so anything without such a tool is never
 * connected. That avoids spawning stdio MCP subprocesses and refreshing OAuth
 * tokens for capability a page cannot reach, and it shrinks the blast radius —
 * a source that is never connected cannot be called by mistake.
 */

import { sourcesWithTrustedTools } from './allowlist.ts'
import type { PoolLike } from './source-pool.ts'

/** Minimal shape needed for eligibility. Keeps this testable without real sources. */
export interface SourceLike {
  config: { slug: string; type?: string }
}

/**
 * Filter sources down to those a page could actually use.
 *
 * @param isUsable the caller's usability predicate (credentials present, config
 *                 valid) — injected rather than imported so this stays pure.
 */
export function eligibleSourcesForPages<T extends SourceLike>(
  sources: T[],
  isUsable: (source: T) => boolean,
): T[] {
  const allowed = new Set(sourcesWithTrustedTools())
  return sources.filter(s => allowed.has(s.config.slug) && isUsable(s))
}

/**
 * Construct and connect a real pool for a workspace.
 *
 * Kept as a factory the host installs, rather than something PagesRuntime
 * imports, so server-core does not take a hard dependency on the session
 * machinery and tests need no MCP subprocesses.
 */
export function createWorkspacePoolBuilder(deps: {
  loadAllSources: (workspaceRootPath: string) => unknown[]
  isSourceUsable: (source: unknown) => boolean
  buildServers: (sources: unknown[]) => Promise<{
    mcpServers: Record<string, unknown>
    apiServers: Record<string, unknown>
  }>
  createPool: (workspaceRootPath: string) => PoolLike & {
    sync: (servers: Record<string, unknown>) => Promise<void>
    connectInProcess: (slug: string, server: unknown) => Promise<void>
  }
  logger?: { info: (m: string) => void; warn: (m: string) => void }
}) {
  return async function buildPool(workspaceRootPath: string): Promise<PoolLike> {
    const all = deps.loadAllSources(workspaceRootPath) as SourceLike[]
    const eligible = eligibleSourcesForPages(all, s => deps.isSourceUsable(s))

    if (eligible.length === 0) {
      deps.logger?.info('[pages] no page-eligible sources in this workspace')
    }

    const { mcpServers, apiServers } = await deps.buildServers(eligible)
    const pool = deps.createPool(workspaceRootPath)

    await pool.sync(mcpServers)
    for (const [slug, server] of Object.entries(apiServers)) {
      // One failing source must not take the whole pool down — the page simply
      // cannot use that connector.
      await pool.connectInProcess(slug, server).catch((err: unknown) => {
        deps.logger?.warn(`[pages] could not connect source ${slug}: ${String(err)}`)
      })
    }

    deps.logger?.info(
      `[pages] connector pool ready (${eligible.length} source(s)) for ${workspaceRootPath}`,
    )
    return pool
  }
}
