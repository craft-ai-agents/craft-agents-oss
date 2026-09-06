/**
 * Shared helpers for grant rows (approval dialog + management surfaces):
 * kind icon, human-readable action label, lifecycle status, and the removal
 * hook. Keeping the phrasing in one place means "what was approved" reads
 * identically in the approval prompt, the Approved-actions list, and the
 * Share dialog's publish-blocked notice.
 */

import * as React from 'react'
import { Globe2, ShieldAlert, TerminalSquare, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { PageActionDescriptor, PageActionGrant } from '@craft-agent/shared/pages/types'
import { isPageGrantUsable } from '@craft-agent/shared/pages/types'
import { relativeTime } from './page-visuals'

type Translate = (key: string, opts?: Record<string, unknown>) => string

export function grantKindIcon(kind: PageActionDescriptor['kind']): LucideIcon {
  if (kind === 'script') return ShieldAlert
  if (kind === 'mcp') return TerminalSquare
  return Globe2
}

/** One phrasing for "what this approval allows", shared by every grant surface. */
export function describeGrantAction(action: PageActionDescriptor, t: Translate): string {
  if (action.kind === 'mcp') {
    return t('pages.grants.mcpAction', { tool: action.toolName, source: action.sourceSlug })
  }
  if (action.kind === 'script') {
    return t('pages.grants.scriptAction', { script: action.script })
  }
  return t('pages.grants.apiAction', {
    method: action.method,
    path: action.pathPattern,
    source: action.sourceSlug,
  })
}

/** Lifecycle status of a persisted grant relative to the page's current content. */
export function describeGrantStatus(
  grant: Pick<PageActionGrant, 'contentDigest' | 'expiresAt'>,
  contentDigest: string | undefined,
  t: Translate,
): { label: string; usable: boolean } {
  const now = Date.now()
  if (isPageGrantUsable(grant, contentDigest, now)) {
    return { label: t('pages.grants.statusExpires', { when: relativeTime(grant.expiresAt) }), usable: true }
  }
  if (grant.expiresAt <= now) {
    return { label: t('pages.grants.statusExpired'), usable: false }
  }
  return { label: t('pages.grants.statusStale'), usable: false }
}

/**
 * Grant removal with per-row busy state. The caller does NOT update any list
 * itself — revocation rewrites page.json, and the pages:changed broadcast
 * refreshes the pages atom, which flows back down as props.
 */
export function useGrantRemoval(workspaceId: string, pageSlug: string): {
  busyGrantId: string | null
  removeGrant: (grantId: string) => Promise<void>
} {
  const { t } = useTranslation()
  const [busyGrantId, setBusyGrantId] = React.useState<string | null>(null)

  const removeGrant = React.useCallback(async (grantId: string) => {
    setBusyGrantId(grantId)
    try {
      await window.electronAPI.revokePageGrant(workspaceId, pageSlug, grantId)
    } catch (err) {
      toast.error(t('toast.pageGrantRemoveFailed'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusyGrantId(null)
    }
  }, [workspaceId, pageSlug, t])

  return { busyGrantId, removeGrant }
}
