import { atom } from 'jotai'

export type SessionProjectDialogState =
  | { kind: 'closed' }
  | { kind: 'new_project'; sessionId: string }

export const sessionProjectDialogAtom = atom<SessionProjectDialogState>({ kind: 'closed' })
