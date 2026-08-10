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
import { isCraftPagesEnabled } from '@craft-agent/shared/feature-flags'
import { PageCatalogService } from './catalog.ts'
import { startPagesServer, type RunningPagesServer } from './server.ts'

interface WorkspaceEntry {
  catalog: PageCatalogService
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

      const server = await startPagesServer({
        catalog,
        workspaceRootPath,
        port: 0,
        logger: this.logger,
      })
      this.entries.set(workspaceRootPath, { catalog, server })
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
    await entry.server.close().catch(() => undefined)
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map(k => this.dispose(k)))
  }
}
