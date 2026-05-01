import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { WorkflowRunDTO } from '../../shared/types'

export interface WorkflowRunsState {
  runs: WorkflowRunDTO[]
  loading: boolean
  error: string | null
}

export const initialWorkflowRunsState: WorkflowRunsState = {
  runs: [],
  loading: true,
  error: null,
}

export const workflowRunsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<WorkflowRunsState>(initialWorkflowRunsState),
  (a, b) => a === b,
)
