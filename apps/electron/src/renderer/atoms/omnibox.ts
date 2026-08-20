/**
 * Omnibox open state (W3 / S-04).
 * Host reads/writes this atom; app.omnibox action sets it true.
 */
import { atom } from 'jotai'

/** Whether the unified ⌘K palette is open. */
export const omniboxOpenAtom = atom(false)
