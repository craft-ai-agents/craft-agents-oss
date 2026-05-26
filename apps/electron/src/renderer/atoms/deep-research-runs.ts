import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { DeepResearchRunDTO } from '../../shared/types'

export interface DeepResearchRunsState {
  runs: DeepResearchRunDTO[]
  loading: boolean
  error: string | null
}

export const initialDeepResearchRunsState: DeepResearchRunsState = {
  runs: [],
  loading: true,
  error: null,
}

export const deepResearchRunsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<DeepResearchRunsState>(initialDeepResearchRunsState),
  (a, b) => a === b,
)
