/**
 * useAgentState - React hook for agent activation state management (Electron)
 *
 * Agent-scoped: One state per (workspaceId, agentId) pair.
 * This is the single source of truth for agent activation state.
 *
 * Usage:
 * ```tsx
 * const agentState = useAgentState(workspaceId, agentId);
 *
 * // Check status
 * if (agentState.isNeedsMcpAuth) {
 *   return <McpAuth servers={agentState.pendingMcpServers} ... />;
 * }
 *
 * // Trigger activation
 * await agentState.activate();
 * ```
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import type {
  AgentStatus,
  AgentActivateOptions,
} from '../../shared/types'
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
} from '@craft-agent/shared/agents/types'
import type { BannerState } from '../components/chat/SetupAuthBanner'

// Renderer-side cache for agent status to prevent banner flash on session switch
// When switching to a previously-active agent, we use cached status immediately
// while the IPC call validates/refreshes the actual state
const AGENT_STATUS_CACHE_MAX_SIZE = 100
const agentStatusCache = new Map<string, AgentStatus>()
const getCacheKey = (ws: string, agent: string) => `${ws}:${agent}`

/**
 * Set a value in the cache with LRU eviction.
 * Removes oldest entries when cache exceeds max size.
 */
function setCacheWithLRU(key: string, value: AgentStatus): void {
  // Delete and re-add to move to end (most recently used)
  agentStatusCache.delete(key)
  agentStatusCache.set(key, value)

  // Evict oldest entries if over limit
  while (agentStatusCache.size > AGENT_STATUS_CACHE_MAX_SIZE) {
    const oldestKey = agentStatusCache.keys().next().value
    if (oldestKey !== undefined) {
      agentStatusCache.delete(oldestKey)
    } else {
      break
    }
  }
}

export interface UseAgentStateResult {
  // Current status (discriminated union)
  status: AgentStatus

  // Convenience booleans for status checking
  isIdle: boolean
  isExtracting: boolean
  isNeedsMcpAuth: boolean
  isNeedsApiAuth: boolean
  isReady: boolean
  isActive: boolean
  isError: boolean

  // Idle state setup info (from centralized status)
  needsSetup: boolean
  needsAuth: boolean
  idleReason: string | null

  // Current data (derived from status, type-safe)
  activeDefinition: SubAgentDefinition | null
  agentId: string | null
  agentName: string | null
  extractionMessage: string | null
  errorMessage: string | null

  // Pending auth data (derived from status)
  pendingMcpServers: McpServerConfig[] | null
  pendingApis: ApiConfig[] | null

  // Actions (no agentId param needed - it's in the hook signature)
  activate: (options?: AgentActivateOptions) => Promise<AgentStatus>
  continueAfterMcpAuth: () => Promise<AgentStatus>
  continueAfterApiAuth: () => Promise<AgentStatus>
  deactivate: () => void
  reload: () => Promise<AgentStatus>
  reset: () => Promise<void>
  markActive: () => void

  // Loading state for async operations
  isLoading: boolean

  // Derived banner state (centralized mapping for all components)
  bannerState: BannerState
  bannerReason: string | null
}

/**
 * Hook for managing agent activation state.
 * Agent-scoped: keyed by (workspaceId, agentId).
 *
 * @param workspaceId - The workspace ID (or null if not selected)
 * @param agentId - The agent ID (or null if not selected)
 */
export function useAgentState(workspaceId: string | null, agentId: string | null): UseAgentStateResult {
  const [status, setStatus] = useState<AgentStatus>({ status: 'idle' })
  const [isLoading, setIsLoading] = useState(false)

  // Subscribe to agent status changes from main process
  useEffect(() => {
    if (!workspaceId || !agentId) {
      setStatus({ status: 'idle' })
      return
    }

    // Track if effect is still active to prevent stale updates
    let isActive = true
    const cacheKey = getCacheKey(workspaceId, agentId)

    // Check cache first - use immediately if agent was previously active/ready
    // This prevents the banner flash during IPC round-trip
    const cached = agentStatusCache.get(cacheKey)
    if (cached && (cached.status === 'active' || cached.status === 'ready')) {
      setStatus(cached)
    }

    // Still fetch fresh status (may have changed)
    window.electronAPI.getAgentStatus(workspaceId, agentId)
      .then(status => {
        if (isActive) {
          setStatus(status)
          // Only cache good statuses, clear for everything else
          if (status.status === 'active' || status.status === 'ready') {
            setCacheWithLRU(cacheKey, status)
          } else {
            agentStatusCache.delete(cacheKey)
          }
        }
      })
      .catch(console.error)

    // Listen for status updates via AGENT_STATUS_CHANGED broadcast
    const cleanup = window.electronAPI.onAgentStatusChanged((ws, agent, newStatus) => {
      if (isActive && ws === workspaceId && agent === agentId) {
        setStatus(newStatus)
        // Only cache good statuses, clear for everything else
        if (newStatus.status === 'active' || newStatus.status === 'ready') {
          setCacheWithLRU(cacheKey, newStatus)
        } else {
          // Clear cache for idle, error, extracting, needs_mcp_auth, needs_api_auth
          agentStatusCache.delete(cacheKey)
        }
      }
    })

    return () => {
      isActive = false
      cleanup()
    }
  }, [workspaceId, agentId])

  // Derive convenience booleans from status
  const isIdle = status.status === 'idle'
  const isExtracting = status.status === 'extracting'
  const isNeedsMcpAuth = status.status === 'needs_mcp_auth'
  const isNeedsApiAuth = status.status === 'needs_api_auth'
  const isReady = status.status === 'ready'
  const isActive = status.status === 'active'
  const isError = status.status === 'error'

  // Derive data from status (type-safe based on discriminated union)
  const activeDefinition =
    status.status === 'ready' || status.status === 'active' ? status.definition : null

  const derivedAgentId = 'agentId' in status ? status.agentId : null
  const derivedAgentName = 'agentName' in status ? status.agentName : null

  const extractionMessage = status.status === 'extracting' ? status.message : null
  const errorMessage = status.status === 'error' ? status.error : null

  const pendingMcpServers = status.status === 'needs_mcp_auth' ? status.servers : null
  const pendingApis = status.status === 'needs_api_auth' ? status.apis : null

  // Idle state setup info (from centralized status)
  const needsSetup = status.status === 'idle' && status.needsSetup === true
  const needsAuth = status.status === 'idle' && status.needsAuth === true
  const idleReason = status.status === 'idle' ? status.reason ?? null : null

  // Centralized banner state derivation (single source of truth for all components)
  // For folder-based agents, needsSetup is always false - they're ready immediately
  const bannerState = useMemo((): BannerState => {
    switch (status.status) {
      case 'idle':
        // Only show auth banner if sources need authentication
        if (status.needsAuth) {
          return 'mcp_auth'
        }
        // Folder-based agents are ready immediately - no activation needed
        return 'hidden'
      case 'extracting':
        // Legacy state - shouldn't happen with folder-based agents
        return 'hidden'
      case 'needs_mcp_auth':
        return 'mcp_auth'
      case 'needs_api_auth':
        return 'api_auth'
      case 'ready':
      case 'active':
        return 'hidden'
      case 'error':
        return 'error'
      default:
        return 'hidden'
    }
  }, [status])

  const bannerReason = useMemo((): string | null => {
    switch (status.status) {
      case 'idle':
        return status.reason ?? null
      case 'extracting':
        return extractionMessage
      case 'error':
        return errorMessage
      default:
        return null
    }
  }, [status, extractionMessage, errorMessage])

  // Helper to update cache based on status result
  const updateCache = useCallback((result: AgentStatus) => {
    if (!workspaceId || !agentId) return
    const cacheKey = getCacheKey(workspaceId, agentId)
    if (result.status === 'active' || result.status === 'ready') {
      setCacheWithLRU(cacheKey, result)
    } else {
      agentStatusCache.delete(cacheKey)
    }
  }, [workspaceId, agentId])

  // Actions - now use (workspaceId, agentId) from hook params
  const activate = useCallback(
    async (options?: AgentActivateOptions): Promise<AgentStatus> => {
      if (!workspaceId || !agentId) {
        return { status: 'idle' }
      }
      setIsLoading(true)
      try {
        const result = await window.electronAPI.activateAgent(workspaceId, agentId, options)
        setStatus(result)
        updateCache(result)
        return result
      } finally {
        setIsLoading(false)
      }
    },
    [workspaceId, agentId, updateCache]
  )

  const continueAfterMcpAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterMcpAuth(workspaceId, agentId)
      setStatus(result)
      updateCache(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status, updateCache])

  const continueAfterApiAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterApiAuth(workspaceId, agentId)
      setStatus(result)
      updateCache(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status, updateCache])

  const deactivate = useCallback((): void => {
    if (!workspaceId || !agentId) {
      return
    }
    // Clear cache to prevent stale state on next activation
    agentStatusCache.delete(getCacheKey(workspaceId, agentId))
    window.electronAPI.deactivateAgent(workspaceId, agentId)
    setStatus({ status: 'idle' })
  }, [workspaceId, agentId])

  const reload = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    // Clear cache first - reload will re-extract and may result in different state
    agentStatusCache.delete(getCacheKey(workspaceId, agentId))
    setIsLoading(true)
    try {
      const result = await window.electronAPI.reloadAgentState(workspaceId, agentId)
      setStatus(result)
      updateCache(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status, updateCache])

  const reset = useCallback(async (): Promise<void> => {
    if (!workspaceId || !agentId) {
      return
    }
    // Clear cache since reset clears definition and credentials
    agentStatusCache.delete(getCacheKey(workspaceId, agentId))
    await window.electronAPI.resetAgentState(workspaceId, agentId)
    setStatus({ status: 'idle' })
  }, [workspaceId, agentId])

  const markActive = useCallback((): void => {
    if (!workspaceId || !agentId) {
      return
    }
    window.electronAPI.markAgentActive(workspaceId, agentId)
  }, [workspaceId, agentId])

  return {
    status,
    isIdle,
    isExtracting,
    isNeedsMcpAuth,
    isNeedsApiAuth,
    isReady,
    isActive,
    isError,
    needsSetup,
    needsAuth,
    idleReason,
    activeDefinition,
    agentId: derivedAgentId,
    agentName: derivedAgentName,
    extractionMessage,
    errorMessage,
    pendingMcpServers,
    pendingApis,
    activate,
    continueAfterMcpAuth,
    continueAfterApiAuth,
    deactivate,
    reload,
    reset,
    markActive,
    isLoading,
    bannerState,
    bannerReason,
  }
}
