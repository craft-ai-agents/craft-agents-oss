/**
 * Global publish-to-knowledge dialog state.
 *
 * Hoisted out of SessionMenu so the dialog survives context-menu / dropdown close.
 * Rendered by <PublishSessionDialogHost /> mounted at AppShell level.
 */
import { atom } from 'jotai'

export type PublishSessionDialogState =
  | { open: false }
  | {
      open: true
      sessionId: string
      connectionId?: string
      runIds?: string[]
    }

export const publishSessionDialogAtom = atom<PublishSessionDialogState>({ open: false })
