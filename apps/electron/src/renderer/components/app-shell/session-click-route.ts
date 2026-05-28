import { routes } from '@/lib/navigate'
import {
  isArchivedNavigation,
  type NavigationState,
} from '@/contexts/NavigationContext'
import type { ViewRoute } from '../../../shared/routes'

/** Returns the canonical in-place route for a clicked session list item. */
export function getSessionClickRoute({
  navState,
  sessionId,
  isArchived,
}: {
  navState: NavigationState
  sessionId: string
  isArchived?: boolean
}): ViewRoute {
  return isArchivedNavigation(navState) && isArchived
    ? routes.view.archived(sessionId)
    : routes.view.allSessions(sessionId)
}
