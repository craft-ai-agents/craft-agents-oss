import { atom } from 'jotai'
import type { ConnectionListRow } from '@/pages/connections-list'

/** Focused Connections list row for InspectorHost (metadata only). */
export const selectedConnectionAtom = atom<ConnectionListRow | null>(null)
