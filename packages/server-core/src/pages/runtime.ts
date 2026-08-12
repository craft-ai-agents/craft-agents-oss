/**
 * Craft Pages — per-workspace runtime.
 *
 * Owns the catalog and the HTTP listener for one workspace, so SessionManager
 * does not grow another responsibility and the lifecycle can be tested without
 * standing up a session.
 *
 * Gating is enforced HERE rather than at the call site: `ensureStarted` returns
 * null when the flag is off, so no listener is ever bound. A flag checked only
 * where the prompt text is assembled would leave a live server behind.
 */

import { existsSync } from 'node:fs'
import { isCraftPagesEnabled, isCraftPagesLiveDataEnabled } from '@craft-agent/shared/feature-flags'
import { PageCatalogService } from './catalog.ts'
import { GrantStore } from './grants/store.ts'
import { WorkspaceSourcePool } from './grants/source-pool.ts'
import { createBridgeHandler } from './grants/bridge.ts'
import { startPagesServer, type RunningPagesServer } from './server.ts'

interface WorkspaceEntry {
  catalog: PageCatalogService
  /** Absent when live data is disabled — nothing can then hold a grant. */
  grants?: GrantStore
  sourcePool?: WorkspaceSourcePool
  server: RunningPagesServer
}

export class PagesRuntime {
  private entries = new Map<string, WorkspaceEntry>()
  /**
   * In-flight starts, keyed by workspace. Two sessions in one workspace can
   * call ensureStarted() simultaneously; without this both await a bind and one
   * listener leaks with no reference held.
   */
  private starting = new Map<string, Promise<RunningPagesServer | null>>()

  constructor(
    private readonly logger?: { info: (m: string) => void; warn: (m: string) => void },
    /**
     * Builds the workspace connector pool. Injected so the runtime can be used
     * without standing up real MCP subprocesses; the Electron host supplies the
     * real implementation.
     */
    private readonly buildSourcePool: (workspaceRootPath: string) => Promise<
      import('./grants/source-pool.ts').PoolLike
    > = async () => { throw new Error('no connector pool configured for Craft Pages') },
  ) {}

  isRunning(workspaceRootPath: string): boolean {
    return this.entries.has(workspaceRootPath)
  }

  /** Catalog for a started workspace, or undefined when not running. */
  catalogFor(workspaceRootPath: string): PageCatalogService | undefined {
    return this.entries.get(workspaceRootPath)?.catalog
  }

  serverFor(workspaceRootPath: string): RunningPagesServer | undefined {
    return this.entries.get(workspaceRootPath)?.server
  }

  /** Grant store for a started workspace. */
  grantsFor(workspaceRootPath: string): GrantStore | undefined {
    return this.entries.get(workspaceRootPath)?.grants
  }

  /**
   * Start the listener for a workspace if the feature is enabled.
   * Idempotent and concurrency-safe. Returns null when the flag is off.
   */
  async ensureStarted(workspaceRootPath: string): Promise<RunningPagesServer | null> {
    if (!isCraftPagesEnabled()) return null

    // Fail closed for a workspace that is not on disk. Binding a listener for a
    // path that does not exist wastes a port and produces a catalog that can
    // never resolve anything — a page URL that 404s forever looks like a bug in
    // the feature rather than a bad workspace.
    if (!existsSync(workspaceRootPath)) {
      this.logger?.warn(`[pages] not starting: workspace path does not exist (${workspaceRootPath})`)
      return null
    }

    const existing = this.entries.get(workspaceRootPath)
    if (existing) return existing.server

    const inFlight = this.starting.get(workspaceRootPath)
    if (inFlight) return inFlight

    const start = (async (): Promise<RunningPagesServer | null> => {
      const catalog = new PageCatalogService(workspaceRootPath)

      // Rebuild the index from per-page manifests before serving. The manifests
      // are the source of truth; a missing or stale catalog must cost the user
      // nothing. Fail-soft — a broken index is not a reason to refuse to serve.
      try {
        const r = await catalog.reconcile()
        if (r.recovered > 0 || r.dropped > 0) {
          this.logger?.info(
            `[pages] catalog reconciled: ${r.kept} kept, ${r.recovered} recovered, ${r.dropped} dropped`,
          )
        }
      } catch (err) {
        this.logger?.warn(`[pages] catalog reconcile failed: ${String(err)}`)
      }

      // Live data is a separate decision from serving pages at all. With it
      // off there is no grant store, no connector pool and no bridge — the
      // endpoint is absent rather than merely unauthorised, and every page is
      // grantless, so none becomes framed-only.
      const live = isCraftPagesLiveDataEnabled()

      const grants = live ? new GrantStore(workspaceRootPath) : undefined
      const sourcePool = live
        ? new WorkspaceSourcePool({
          workspaceRootPath,
          buildPool: this.buildSourcePool,
          logger: this.logger,
        })
        : undefined

      const server = await startPagesServer({
        catalog,
        workspaceRootPath,
        port: 0,
        logger: this.logger,
        pageHasGrants: grants ? (pageId) => grants.pageHasGrants(pageId) : undefined,
        grantedSources: grants
          ? async (pageId) =>
            [...new Set((await grants.listForPage(pageId)).map(g => g.sourceSlug))].sort()
          : undefined,
        bridge: grants && sourcePool
          ? createBridgeHandler({
            grantStore: grants,
            pagesOrigin: () => this.entries.get(workspaceRootPath)?.server.origin ?? null,
            execute: (slug, tool, args) => sourcePool.callTool(slug, tool, args),
            logger: this.logger,
          })
          : undefined,
      })
      this.entries.set(workspaceRootPath, { catalog, grants, sourcePool, server })
      return server
    })()

    this.starting.set(workspaceRootPath, start)
    try {
      return await start
    } finally {
      this.starting.delete(workspaceRootPath)
    }
  }

  async dispose(workspaceRootPath: string): Promise<void> {
    const entry = this.entries.get(workspaceRootPath)
    if (!entry) return
    this.entries.delete(workspaceRootPath)
    await entry.sourcePool?.dispose().catch(() => undefined)
    await entry.server.close().catch(() => undefined)
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map(k => this.dispose(k)))
  }
}
