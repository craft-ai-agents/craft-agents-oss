/**
 * The seam SessionManager uses to hand a session its page catalog.
 *
 * Kept out of SessionManager so the gating and start-ordering are testable
 * without instantiating it, and so session creation has exactly one line of
 * pages-awareness.
 */

import type { PageCatalogInterface } from '@craft-agent/session-tools-core'
import type { PagesRuntime } from './runtime.ts'

/**
 * Resolve the page catalog for a session's workspace, starting the runtime if
 * needed.
 *
 * Returns undefined when the feature is off, no runtime is wired, or startup
 * failed. Never throws: session creation is the critical path, and a pages
 * failure must cost the user Craft Pages, not the ability to start a session.
 */
export async function resolvePageCatalogForSession(
  runtime: PagesRuntime | undefined,
  workspaceRootPath: string,
  logger?: { warn: (m: string) => void },
): Promise<PageCatalogInterface | undefined> {
  if (!runtime) return undefined
  try {
    // Start on demand — callers must not have to remember to do it first, and
    // the catalog does not exist until the runtime is up.
    const started = await runtime.ensureStarted(workspaceRootPath)
    if (!started) return undefined
    return runtime.catalogFor(workspaceRootPath)
  } catch (err) {
    logger?.warn(`[pages] disabled for this session: ${String(err)}`)
    return undefined
  }
}
