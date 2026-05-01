import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { WorkflowDTO } from '../../shared/types'

export interface WorkflowsState {
  allWorkflows: WorkflowDTO[]
  activeSlugs: string[]
  loading: boolean
  error: string | null
}

export const initialWorkflowsState: WorkflowsState = {
  allWorkflows: [],
  activeSlugs: [],
  loading: true,
  error: null,
}

export const workflowsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<WorkflowsState>(initialWorkflowsState),
  (a, b) => a === b,
)
