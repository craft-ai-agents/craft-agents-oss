import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { ContextDocDTO } from '../../shared/types'

export interface WorkspaceContextState {
  docs: ContextDocDTO[]
  loading: boolean
  error: string | null
}

export const initialWorkspaceContextState: WorkspaceContextState = {
  docs: [],
  loading: true,
  error: null,
}

export const workspaceContextStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<WorkspaceContextState>(initialWorkspaceContextState),
  (a, b) => a === b,
)
