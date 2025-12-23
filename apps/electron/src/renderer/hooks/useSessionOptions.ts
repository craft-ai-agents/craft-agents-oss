/**
 * Session Options Types
 *
 * Type definitions and helpers for session-scoped settings.
 * The actual hook is in ChatContext.tsx as useSessionOptionsFor().
 *
 * ADDING A NEW SESSION OPTION:
 * 1. Add field to SessionOptions interface below
 * 2. Update defaultSessionOptions
 * 3. Add UI control in FreeFormInput.tsx (or wherever needed)
 */

import type { Mode } from '../../shared/types'

/**
 * All session-scoped options in one place.
 */
export interface SessionOptions {
  /** Extended thinking mode (single-shot per message) */
  ultrathinkEnabled: boolean
  /** Auto-approve all permission requests */
  skipPermissions: boolean
  /** Active operational modes (e.g., 'safe' for read-only exploration) */
  activeModes: Mode[]
}

/** Default values for new sessions */
export const defaultSessionOptions: SessionOptions = {
  ultrathinkEnabled: false,
  skipPermissions: false,
  activeModes: [],
}

/** Type for partial updates to session options */
export type SessionOptionUpdates = Partial<SessionOptions>

/** Helper to merge session options with updates */
export function mergeSessionOptions(
  current: SessionOptions | undefined,
  updates: SessionOptionUpdates
): SessionOptions {
  return {
    ...defaultSessionOptions,
    ...current,
    ...updates,
  }
}

