import { atom } from 'jotai'

export type SessionProjectDialogState =
  | { kind: 'closed' }
  | { kind: 'new_project'; sessionId: string }
  | { kind: 'rename_project'; projectSlug: string; projectLabel: string }
  | { kind: 'delete_project'; projectSlug: string; projectLabel: string }

export const sessionProjectDialogAtom = atom<SessionProjectDialogState>({ kind: 'closed' })
