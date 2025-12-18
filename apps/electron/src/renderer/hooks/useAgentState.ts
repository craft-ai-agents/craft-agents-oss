/**
 * useAgentState - React hook for agent activation state management (Electron)
 *
 * Provides the same interface as the TUI useAgentState hook but communicates
 * via IPC with the main process where AgentStateManager lives.
 *
 * Usage:
 * ```tsx
 * const agentState = useAgentState(sessionId);
 *
 * // Check status
 * if (agentState.isNeedsMcpAuth) {
 *   return <McpAuth servers={agentState.pendingMcpServers} ... />;
 * }
 *
 * // Trigger activation
 * await agentState.activate(agentId);
 * ```
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  AgentStatus,
  AgentActivateOptions,
} from '../../shared/types'
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  Concern,
} from '@craft-agent/shared/agents'

export interface UseAgentStateResult {
  // Current status (discriminated union)
  status: AgentStatus

  // Convenience booleans for status checking
  isIdle: boolean
  isExtracting: boolean
  isNeedsReview: boolean
  isNeedsMcpAuth: boolean
  isNeedsApiAuth: boolean
  isReady: boolean
  isActive: boolean
  isError: boolean

  // Current data (derived from status, type-safe)
  activeDefinition: SubAgentDefinition | null
  agentId: string | null
  agentName: string | null
  extractionMessage: string | null
  errorMessage: string | null

  // Pending auth/review data (derived from status)
  pendingConcerns: Concern[] | null
  pendingMcpServers: McpServerConfig[] | null
  pendingApis: ApiConfig[] | null

  // Actions
  activate: (agentId: string, options?: AgentActivateOptions) => Promise<AgentStatus>
  continueAfterReview: (answers: Record<string, string>) => Promise<AgentStatus>
  skipReview: () => Promise<AgentStatus>
  continueAfterMcpAuth: () => Promise<AgentStatus>
  continueAfterApiAuth: () => Promise<AgentStatus>
  deactivate: () => Promise<void>
  reload: () => Promise<AgentStatus>
  reset: () => Promise<void>
  markActive: () => Promise<void>

  // Loading state for async operations
  isLoading: boolean
}

export function useAgentState(sessionId: string | null): UseAgentStateResult {
  const [status, setStatus] = useState<AgentStatus>({ status: 'idle' })
  const [isLoading, setIsLoading] = useState(false)

  // Subscribe to agent_status events from main process
  useEffect(() => {
    if (!sessionId) {
      setStatus({ status: 'idle' })
      return
    }

    // Get initial status
    window.electronAPI.getAgentStatus(sessionId).then(setStatus).catch(console.error)

    // Listen for status updates via session events
    const cleanup = window.electronAPI.onSessionEvent((event) => {
      if (event.type === 'agent_status' && event.sessionId === sessionId) {
        setStatus(event.status)
      }
    })

    return cleanup
  }, [sessionId])

  // Derive convenience booleans from status
  const isIdle = status.status === 'idle'
  const isExtracting = status.status === 'extracting'
  const isNeedsReview = status.status === 'needs_review'
  const isNeedsMcpAuth = status.status === 'needs_mcp_auth'
  const isNeedsApiAuth = status.status === 'needs_api_auth'
  const isReady = status.status === 'ready'
  const isActive = status.status === 'active'
  const isError = status.status === 'error'

  // Derive data from status (type-safe based on discriminated union)
  const activeDefinition =
    status.status === 'ready' || status.status === 'active' ? status.definition : null

  const agentId = 'agentId' in status ? status.agentId : null
  const agentName = 'agentName' in status ? status.agentName : null

  const extractionMessage = status.status === 'extracting' ? status.message : null
  const errorMessage = status.status === 'error' ? status.error : null

  const pendingConcerns = status.status === 'needs_review' ? status.concerns : null
  const pendingMcpServers = status.status === 'needs_mcp_auth' ? status.servers : null
  const pendingApis = status.status === 'needs_api_auth' ? status.apis : null

  // Actions
  const activate = useCallback(
    async (agentIdToActivate: string, options?: AgentActivateOptions): Promise<AgentStatus> => {
      if (!sessionId) {
        return { status: 'idle' }
      }
      setIsLoading(true)
      try {
        const result = await window.electronAPI.activateAgent(sessionId, agentIdToActivate, options)
        setStatus(result)
        return result
      } finally {
        setIsLoading(false)
      }
    },
    [sessionId]
  )

  const continueAfterReview = useCallback(
    async (answers: Record<string, string>): Promise<AgentStatus> => {
      if (!sessionId) {
        return status
      }
      setIsLoading(true)
      try {
        const result = await window.electronAPI.continueAfterReview(sessionId, answers)
        setStatus(result)
        return result
      } finally {
        setIsLoading(false)
      }
    },
    [sessionId, status]
  )

  const skipReview = useCallback(async (): Promise<AgentStatus> => {
    return continueAfterReview({})
  }, [continueAfterReview])

  const continueAfterMcpAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!sessionId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterMcpAuth(sessionId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, status])

  const continueAfterApiAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!sessionId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterApiAuth(sessionId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, status])

  const deactivate = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      return
    }
    await window.electronAPI.deactivateAgent(sessionId)
    setStatus({ status: 'idle' })
  }, [sessionId])

  const reload = useCallback(async (): Promise<AgentStatus> => {
    if (!sessionId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.reloadAgentState(sessionId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, status])

  const reset = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      return
    }
    await window.electronAPI.resetAgentState(sessionId)
    setStatus({ status: 'idle' })
  }, [sessionId])

  const markActive = useCallback(async (): Promise<void> => {
    if (!sessionId) {
      return
    }
    await window.electronAPI.markAgentActive(sessionId)
  }, [sessionId])

  return {
    status,
    isIdle,
    isExtracting,
    isNeedsReview,
    isNeedsMcpAuth,
    isNeedsApiAuth,
    isReady,
    isActive,
    isError,
    activeDefinition,
    agentId,
    agentName,
    extractionMessage,
    errorMessage,
    pendingConcerns,
    pendingMcpServers,
    pendingApis,
    activate,
    continueAfterReview,
    skipReview,
    continueAfterMcpAuth,
    continueAfterApiAuth,
    deactivate,
    reload,
    reset,
    markActive,
    isLoading,
  }
}
