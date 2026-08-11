/**
 * Workspace-scoped connector pool (ADR 0001, WS7).
 *
 * `McpClientPool` is constructed per SESSION (SessionManager.ts:3404) and torn
 * down on close, so nothing is connected when a user simply opens a saved page.
 * A page outlives every session, so it needs a pool whose lifetime is the
 * workspace.
 *
 * Lazily built and idle-shutdown: stdio MCP sources spawn `npx`/`uvx` child
 * processes, and holding those open for a workspace nobody is looking at is
 * both wasteful and, on Windows, a per-user-install spawn we would rather not
 * keep alive.
 */

import { proxyToolName } from '@craft-agent/shared/mcp'

/** The slice of McpClientPool this needs. Narrow, so tests need no real MCP. */
export interface PoolLike {
  callTool: (proxyName: string, args: Record<string, unknown>) => Promise<unknown>
  disconnectAll: () => Promise<void>
}

export interface WorkspaceSourcePoolOptions {
  workspaceRootPath: string
  /** Builds and connects a pool for this workspace. */
  buildPool: (workspaceRootPath: string) => Promise<PoolLike>
  /** Torn down after this long with no queries. */
  idleTimeoutMs?: number
  logger?: { info: (m: string) => void; warn: (m: string) => void }
}

const DEFAULT_IDLE_MS = 5 * 60_000

export class WorkspaceSourcePool {
  private pool: PoolLike | null = null
  /** In-flight build. Without it, concurrent first calls each spawn a full set
   *  of subprocesses and all but one leak with no reference held. */
  private building: Promise<PoolLike> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: WorkspaceSourcePoolOptions) {}

  private get idleMs(): number {
    return this.opts.idleTimeoutMs ?? DEFAULT_IDLE_MS
  }

  private touchIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { void this.dispose() }, this.idleMs)
    // Never hold the process open just to expire a cache.
    this.idleTimer.unref?.()
  }

  private async ensurePool(): Promise<PoolLike> {
    if (this.pool) return this.pool
    if (this.building) return this.building

    this.building = (async () => {
      const p = await this.opts.buildPool(this.opts.workspaceRootPath)
      this.pool = p
      this.opts.logger?.info(`[pages] connector pool started for ${this.opts.workspaceRootPath}`)
      return p
    })()

    try {
      return await this.building
    } finally {
      this.building = null
    }
  }

  /**
   * Run a granted tool. Errors propagate unchanged — redaction is the bridge's
   * job, and it needs the detail to log before discarding it.
   */
  async callTool(
    sourceSlug: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const pool = await this.ensurePool()
    this.touchIdleTimer()
    // Built with the one canonical builder — the proxy name is an opaque
    // exact-match key, and a second implementation drifts (see packages/shared
    // CLAUDE.md on #864).
    return pool.callTool(proxyToolName(sourceSlug, toolName), args)
  }

  async dispose(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    const p = this.pool
    this.pool = null
    if (!p) return
    try {
      await p.disconnectAll()
      this.opts.logger?.info(`[pages] connector pool stopped for ${this.opts.workspaceRootPath}`)
    } catch (err) {
      this.opts.logger?.warn(`[pages] pool teardown failed: ${String(err)}`)
    }
  }
}
