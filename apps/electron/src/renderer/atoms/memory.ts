import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { MemoryEntry, MemoryEvent, MemoryReviewItem } from '@craft-agent/shared/memory/types'

export interface MemoryState {
  entries: MemoryEntry[]
  loading: boolean
  error: string | null
  warning: string | null
}

export const initialMemoryState: MemoryState = {
  entries: [],
  loading: true,
  error: null,
  warning: null,
}

export const userMemoryStateAtom = atom<MemoryState>(initialMemoryState)

export const agentMemoryStateAtomFamily = atomFamily(
  (agentSlug: string) => atom<MemoryState>(initialMemoryState),
  (a, b) => a === b,
)

export interface MemoryEventsState {
  events: MemoryEvent[]
  loading: boolean
  error: string | null
}

export const initialMemoryEventsState: MemoryEventsState = {
  events: [],
  loading: true,
  error: null,
}

export const memoryEventsStateAtomFamily = atomFamily(
  (key: string) => atom<MemoryEventsState>(initialMemoryEventsState),
  (a, b) => a === b,
)

export interface MemoryReviewQueueState {
  items: MemoryReviewItem[]
  loading: boolean
  error: string | null
}

export const initialMemoryReviewQueueState: MemoryReviewQueueState = {
  items: [],
  loading: true,
  error: null,
}

export const memoryReviewQueueStateAtom = atom<MemoryReviewQueueState>(initialMemoryReviewQueueState)
