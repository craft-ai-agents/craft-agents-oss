import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { countPagesInSession } from '../../pages/session-deletion'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.pages.GET_URL,
  RPC_CHANNELS.pages.LIST,
  RPC_CHANNELS.pages.COUNT_FOR_SESSION,
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
    return {
      url: running.urlForPage(pageId),
      // WS7 replaces this with a grant-store lookup.
      canOpenExternally: true,
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
}
