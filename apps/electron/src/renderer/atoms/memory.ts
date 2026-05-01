import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

export interface MemoryState {
  entries: MemoryEntry[]
  loading: boolean
  error: string | null
}

export const initialMemoryState: MemoryState = {
  entries: [],
  loading: true,
  error: null,
}

export const userMemoryStateAtom = atom<MemoryState>(initialMemoryState)

export const agentMemoryStateAtomFamily = atomFamily(
  (agentSlug: string) => atom<MemoryState>(initialMemoryState),
  (a, b) => a === b,
)
