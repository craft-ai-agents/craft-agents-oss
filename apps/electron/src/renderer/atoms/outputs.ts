import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'

export interface OutputsState {
  outputs: OutputSummaryDTO[]
  loading: boolean
  error: string | null
}

export const initialOutputsState: OutputsState = {
  outputs: [],
  loading: true,
  error: null,
}

export const outputsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<OutputsState>(initialOutputsState),
  (a, b) => a === b,
)
