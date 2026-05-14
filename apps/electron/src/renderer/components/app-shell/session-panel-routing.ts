import { isArchivedNavigation, type NavigationState } from '../../../shared/types'
import type { PanelStackEntry } from '@/atoms/panel-stack'
import { parseSessionIdFromRoute } from '@/atoms/panel-stack'
import { routes } from '@/lib/navigate'
import type { ViewRoute } from '../../../shared/routes'

export type SessionPanelNavigation =
  | { type: 'focus'; panelId: string }
  | { type: 'navigate-route'; route: ViewRoute }
  | { type: 'navigate-current-filter' }

/**
 * Resolves whether a session click should focus an existing panel or navigate
 * the focused panel while preserving navigator-specific session routes.
 */
export function resolveSessionPanelNavigation({
  navState,
  panelStack,
  sessionId,
}: {
  navState: NavigationState
  panelStack: PanelStackEntry[]
  sessionId: string
}): SessionPanelNavigation {
  if (isArchivedNavigation(navState)) {
    return { type: 'navigate-route', route: routes.view.archived(sessionId) }
  }

  for (const entry of panelStack) {
    if (parseSessionIdFromRoute(entry.route) === sessionId) {
      return { type: 'focus', panelId: entry.id }
    }
  }

  return { type: 'navigate-current-filter' }
}
