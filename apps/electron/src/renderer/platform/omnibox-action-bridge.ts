/**
 * Narrow ActionRegistry surface the Omnibox host needs — avoids circular
 * imports between actions/registry and platform/omnibox-bootstrap.
 */
import type { ActionId } from '@/actions/definitions'

export interface ActionRegistryContextType {
  execute: (actionId: ActionId) => void
  getHotkeyDisplay: (actionId: ActionId) => string | null
}
