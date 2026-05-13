/**
 * Navigation helpers
 *
 * Small pure helpers over `NavigationState`. Keep these stateless and free of
 * React/Jotai imports — they're consumed both inside hooks (PanelStackContainer)
 * and in synchronous callbacks (CompactBackButton).
 */

import type { NavigationState } from '../../shared/types'

/**
 * Returns true when the focused panel's nav state is in "detail" mode —
 * i.e. the user has drilled past the navigator into a specific item.
 *
 * Used by compact-mode logic to flip the layout from navigator-only to
 * content-only with a back-button overlay.
 *
 * Per-navigator semantics:
 * - sessions: a session is selected
 * - settings: a subpage is selected (bare `settings` route → false)
 * - sources / local skills / automations / archived: a detail item is selected
 * - skill marketplace: no detail state
 */
export function isDetailNavState(navState: NavigationState | null): boolean {
  if (!navState) return false
  switch (navState.navigator) {
    case 'sessions':
      return navState.details !== null
    case 'settings':
      return navState.subpage !== null
    case 'sources':
    case 'local-skills':
    case 'automations':
    case 'archived':
      return navState.details !== null
    case 'skill-marketplace':
      return false
  }
}
