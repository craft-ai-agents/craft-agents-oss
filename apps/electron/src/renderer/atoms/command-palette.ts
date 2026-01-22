import { atom } from 'jotai'

/**
 * Tracks whether the command palette is open.
 * Used by AppShell to toggle and CommandPalette to render.
 */
export const commandPaletteOpenAtom = atom(false)
