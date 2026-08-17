import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { countPagesInSession } from '../../pages/session-deletion'
import { readPage } from '@craft-agent/session-tools-core'
import { sessionPagesRoot } from '../../pages/catalog'
import { isTrustedReadOnlyTool } from '../../pages/grants/allowlist'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.pages.GET_URL,
  RPC_CHANNELS.pages.LIST,
  RPC_CHANNELS.pages.COUNT_FOR_SESSION,
  RPC_CHANNELS.pages.LIST_QUERY_REQUESTS,
  RPC_CHANNELS.pages.LIST_GRANTS,
  RPC_CHANNELS.pages.APPROVE_GRANTS,
  RPC_CHANNELS.pages.REVOKE_GRANTS,
] as const

export interface PageUrlResult {
  /** Always the WRAPPER (/w/…). */
  url: string
  /**
   * Whether this page may be loaded as a TOP-LEVEL document — "open in your
   * own browser", or the in-app browser pane.
   *
   * False for a page holding connector grants: frame-src, the control that
   * blocks a page navigating itself off-origin, does not apply to a top-level
   * document, and nothing replaces it in a third-party browser (ADR 0001 D6).
   * A grantless page holds nothing worth exfiltrating.
   *
   * Grants land in WS7; until then every page is grantless and this is always
   * true. The gate exists now so the live-data work cannot forget it.
   */
  canOpenExternally: boolean
}

export interface PageListItem {
  pageId: string
  slug: string
  title: string
  url: string
}

/**
 * Craft Pages RPC.
 *
 * The renderer never builds a page URL itself: the port is chosen at runtime
 * and can move when the preferred one is taken, so a client-side URL would go
 * stale silently. These handlers are the only sanctioned source.
 *
 * Every handler degrades to null / [] rather than throwing when the feature is
 * off or no runtime is wired (headless, thin client). A UI that asks for a page
 * URL on a host that cannot serve one should render nothing, not an error
 * dialog.
 */
export function registerPagesHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.pages.GET_URL, async (
    _ctx,
    workspaceRootPath: string,
    pageId: string,
  ): Promise<PageUrlResult | null> => {
    const runtime = deps.pagesRuntime
    if (!runtime) return null

    const running = await runtime.ensureStarted(workspaceRootPath)
    if (!running) return null

    const entry = await runtime.catalogFor(workspaceRootPath)?.resolve(pageId)
    if (!entry) return null

    // Always the wrapper. A page loaded top-level loses the frame-src
    // protection that blocks self-navigation exfiltration (ADR 0001 D6).
    // Real lookup now. A page holding grants must stay framed — frame-src does
    // not protect a top-level document and nothing replaces it in a
    // third-party browser (ADR 0001 D6). Fail CLOSED if the grant store cannot
    // be consulted: refusing to offer "open in browser" costs a convenience,
    // wrongly offering it costs the guarantee.
    let hasGrants = true
    try {
      hasGrants = (await runtime.grantsFor(workspaceRootPath)?.pageHasGrants(pageId)) ?? false
    } catch {
      hasGrants = true
    }

    return {
      url: running.urlForPage(pageId),
      canOpenExternally: !hasGrants,
    }
  })

  server.handle(RPC_CHANNELS.pages.LIST, async (
    _ctx,
    workspaceRootPath: string,
    sessionId: string,
  ): Promise<PageListItem[]> => {
    const runtime = deps.pagesRuntime
    if (!runtime) return []

    const running = await runtime.ensureStarted(workspaceRootPath)
    if (!running) return []

    const catalog = runtime.catalogFor(workspaceRootPath)
    if (!catalog) return []

    const entries = await catalog.listForSession(sessionId)
    return entries.map(e => ({
      pageId: e.pageId,
      slug: e.slug,
      title: e.title,
      url: running.urlForPage(e.pageId),
    }))
  })

  // Counted from disk, not the catalog: a page whose catalog entry was lost is
  // still about to be deleted, and the user should be warned about it. Works
  // even when the pages runtime is not started.
  server.handle(RPC_CHANNELS.pages.COUNT_FOR_SESSION, async (
    _ctx,
    workspaceRootPath: string,
    sessionId: string,
  ): Promise<number> => {
    try {
      return countPagesInSession(workspaceRootPath, sessionId)
    } catch {
      return 0
    }
  })

  // ── Consent ──
  //
  // Approval is a USER action routed through the app, never something a page or
  // an agent can perform. The agent's request lives in page.json; this is where
  // the user's decision is recorded.

  /**
   * What the PAGE asked for, paired with what the user has already decided.
   *
   * The request lives in the agent-writable manifest, so it is re-validated
   * here rather than trusted: a hand-edited page.json must not be able to put
   * arbitrary text in front of the user inside a consent dialog.
   */
  server.handle(RPC_CHANNELS.pages.LIST_QUERY_REQUESTS, async (
    _ctx, workspaceRootPath: string, pageId: string,
  ) => {
    const grants = deps.pagesRuntime?.grantsFor(workspaceRootPath)
    // No grant store means live data is off: there is nothing to approve into,
    // so the dialog must not offer to.
    if (!grants) return []

    const entry = await deps.pagesRuntime?.catalogFor(workspaceRootPath)?.resolve(pageId)
    if (!entry) return []

    let requested: Array<{
      name: string; sourceSlug: string; toolName: string
      fixedArgs: Record<string, unknown>; paramSchema: Record<string, unknown>
    }> = []
    try {
      const page = readPage(sessionPagesRoot(workspaceRootPath, entry.sessionId), entry.slug)
      requested = page.manifest.requestedQueries
    } catch {
      // A page whose manifest cannot be read requests nothing.
      return []
    }

    const approved = await grants.nameMapForPage(pageId)
    return requested.map(q => ({
      name: q.name,
      sourceSlug: q.sourceSlug,
      toolName: q.toolName,
      fixedArgs: q.fixedArgs,
      paramSchema: q.paramSchema,
      /** Whether this tool is even approvable — the dialog shows why not. */
      allowed: isTrustedReadOnlyTool(q.sourceSlug, q.toolName),
      approved: Object.prototype.hasOwnProperty.call(approved, q.name),
    }))
  })

  server.handle(RPC_CHANNELS.pages.LIST_GRANTS, async (
    _ctx, workspaceRootPath: string, pageId: string,
  ) => {
    const grants = deps.pagesRuntime?.grantsFor(workspaceRootPath)
    if (!grants) return []
    return (await grants.listForPage(pageId)).map(g => ({
      grantId: g.grantId,
      name: g.name,
      sourceSlug: g.sourceSlug,
      toolName: g.toolName,
      approvedAt: g.approvedAt,
    }))
  })

  server.handle(RPC_CHANNELS.pages.APPROVE_GRANTS, async (
    _ctx,
    workspaceRootPath: string,
    pageId: string,
    queries: Array<{
      name: string
      sourceSlug: string
      toolName: string
      fixedArgs: Record<string, unknown>
      paramSchema: Record<string, unknown>
    }>,
  ): Promise<{ approved: number; rejected: Array<{ query: string; reason: string }> }> => {
    const grants = deps.pagesRuntime?.grantsFor(workspaceRootPath)
    if (!grants) return { approved: 0, rejected: [{ query: '*', reason: 'Craft Pages is not running' }] }

    let approved = 0
    const rejected: Array<{ query: string; reason: string }> = []
    // Per-query, so one bad request does not silently drop the rest — and so
    // the UI can say which was refused and why.
    for (const q of queries) {
      try {
        await grants.approve({
          pageId,
          // Without the name the page's craftQuery('unread') resolves to
          // nothing, and the approval the user just gave does nothing at all.
          name: q.name,
          sourceSlug: q.sourceSlug,
          toolName: q.toolName,
          fixedArgs: q.fixedArgs ?? {},
          paramSchema: q.paramSchema as never,
        })
        approved++
      } catch (err) {
        rejected.push({
          query: q.name ? `${q.name} (${q.sourceSlug}.${q.toolName})` : `${q.sourceSlug}.${q.toolName}`,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { approved, rejected }
  })

  server.handle(RPC_CHANNELS.pages.REVOKE_GRANTS, async (
    _ctx, workspaceRootPath: string, pageId: string,
  ): Promise<void> => {
    await deps.pagesRuntime?.grantsFor(workspaceRootPath)?.revokeForPage(pageId)
  })
}
