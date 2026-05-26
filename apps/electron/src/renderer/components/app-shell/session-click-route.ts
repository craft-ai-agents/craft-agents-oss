import { routes } from '@/lib/navigate'
import {
  isArchivedNavigation,
  type NavigationState,
} from '@/contexts/NavigationContext'
import type { ViewRoute } from '../../../shared/routes'

export function getSessionClickRoute({
  navState,
  sessionId,
}: {
  navState: NavigationState
  sessionId: string
}): ViewRoute {
  return isArchivedNavigation(navState)
    ? routes.view.archived(sessionId)
    : routes.view.allSessions(sessionId)
}
