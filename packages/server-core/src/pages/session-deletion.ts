/**
 * Craft Pages side of session deletion.
 *
 * Page CONTENT is session-scoped — it lives in the session data dir — so it
 * cannot survive the session. Two obligations follow:
 *
 * 1. The user is told BEFORE it happens. `countPagesInSession` feeds a dialog
 *    that must be phrased "Delete chat and 2 pages" / "Cancel", never Yes/No:
 *    declining cannot mean "delete the chat but keep the pages", because that
 *    outcome does not exist.
 * 2. The catalog stops pointing at directories that are about to vanish.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PageCatalogInterface } from '@craft-agent/session-tools-core'
import { sessionPagesRoot } from './catalog.ts'

/**
 * How many pages a session owns. Used only to phrase the confirmation, so it
 * counts directories carrying a manifest rather than consulting the catalog —
 * a page whose catalog entry was lost is still about to be deleted, and the
 * user should be told about it.
 */
export function countPagesInSession(workspaceRootPath: string, sessionId: string): number {
  const root = sessionPagesRoot(workspaceRootPath, sessionId)
  if (!existsSync(root)) return 0
  try {
    return readdirSync(root).filter(
      slug => !slug.startsWith('.') && existsSync(join(root, slug, 'page.json')),
    ).length
  } catch {
    return 0
  }
}

/**
 * Drop catalog entries for a session being deleted.
 *
 * Does NOT remove files: the caller deletes the session directory wholesale,
 * and two owners of the same destructive operation is how partial deletions
 * happen.
 *
 * Never throws. Deletion is already underway by the time this runs, and a
 * catalog problem must not leave the user unable to delete a session.
 */
export async function purgeSessionPages(
  catalog: Pick<PageCatalogInterface, 'listForSession' | 'unregister'> | undefined,
  _workspaceRootPath: string,
  sessionId: string,
  logger?: { warn: (m: string) => void },
): Promise<void> {
  if (!catalog) return
  try {
    const entries = await catalog.listForSession(sessionId)
    for (const entry of entries) {
      await catalog.unregister(entry.pageId)
    }
  } catch (err) {
    logger?.warn(`[pages] could not purge catalog entries for ${sessionId}: ${String(err)}`)
  }
}
