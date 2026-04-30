import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'
import type { AgentDefinitionDTO } from '../../shared/types'

export interface AgentsState {
  allAgents: AgentDefinitionDTO[]
  activeSlugs: string[]
  loading: boolean
  error: string | null
}

export const initialAgentsState: AgentsState = {
  allAgents: [],
  activeSlugs: [],
  loading: true,
  error: null,
}

export const agentsStateAtomFamily = atomFamily(
  (workspaceId: string) => atom<AgentsState>(initialAgentsState),
  (a, b) => a === b,
)
