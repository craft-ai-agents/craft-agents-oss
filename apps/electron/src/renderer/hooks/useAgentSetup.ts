/**
 * useAgentSetup - React hook for agent setup flow (agent-scoped, not session-scoped)
 *
 * Manages the multi-step wizard for configuring an agent:
 * 1. Extract definition from Craft document
 * 2. Review concerns (if any)
 * 3. Authenticate MCP servers (if any)
 * 4. Configure API credentials (if any)
 * 5. Ready to start chat
 *
 * Unlike useAgentState (session-based), this hook works independently of sessions.
 * A session is only created when the user clicks "Start Chat".
 */

import { useState, useCallback, useMemo } from 'react'
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  Concern,
} from '@craft-agent/shared/agents'

export type SetupStep = 'idle' | 'extracting' | 'review' | 'mcp-auth' | 'api-auth' | 'ready' | 'error'
export type McpServerAuthStatus = 'pending' | 'authenticating' | 'authenticated' | 'skipped' | 'bearer-input'
export type ApiAuthStatus = 'pending' | 'configured' | 'skipped'

export interface UseAgentSetupResult {
  // Current step
  step: SetupStep

  // Data
  definition: SubAgentDefinition | null
  concerns: Concern[]
  mcpServers: McpServerConfig[]
  apis: ApiConfig[]
  errorMessage: string | null
  extractionMessage: string | null

  // Per-item status tracking
  mcpServerStatus: Record<string, McpServerAuthStatus>
  apiStatus: Record<string, ApiAuthStatus>

  // Actions
  startSetup: () => Promise<void>
  submitReview: (answers: Record<number, string>) => Promise<void>
  startMcpOAuth: (serverName: string) => Promise<void>
  submitMcpBearer: (serverName: string, token: string) => Promise<void>
  skipMcpServer: (serverName: string) => void
  setMcpBearerInput: (serverName: string) => void
  completeMcpAuth: () => void
  submitApiCredentials: (apiName: string, credentials: string | { username: string; password: string }) => Promise<void>
  skipApi: (apiName: string) => void
  completeApiAuth: () => void
  retry: () => Promise<void>
  reset: () => void

  // Loading state
  isLoading: boolean
}

export function useAgentSetup(workspaceId: string, agentId: string): UseAgentSetupResult {
  const [step, setStep] = useState<SetupStep>('idle')
  const [definition, setDefinition] = useState<SubAgentDefinition | null>(null)
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([])
  const [apis, setApis] = useState<ApiConfig[]>([])
  const [mcpServerStatus, setMcpServerStatus] = useState<Record<string, McpServerAuthStatus>>({})
  const [apiStatus, setApiStatus] = useState<Record<string, ApiAuthStatus>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  /**
   * Determine next step after extraction or auth
   */
  const determineNextStep = useCallback((
    def: SubAgentDefinition,
    currentMcpStatus: Record<string, McpServerAuthStatus>,
    currentApiStatus: Record<string, ApiAuthStatus>
  ): SetupStep => {
    // Check concerns first
    if (def.concerns && def.concerns.length > 0) {
      return 'review'
    }

    // Check MCP servers needing auth
    const serversNeedingAuth = (def.mcpServers || []).filter(s => s.requiresAuth)
    const allServersHandled = serversNeedingAuth.every(
      s => currentMcpStatus[s.name] === 'authenticated' || currentMcpStatus[s.name] === 'skipped'
    )
    if (serversNeedingAuth.length > 0 && !allServersHandled) {
      return 'mcp-auth'
    }

    // Check APIs needing auth
    const apisNeedingAuth = (def.apis || []).filter(a => a.auth?.type && a.auth.type !== 'none')
    const allApisHandled = apisNeedingAuth.every(
      a => currentApiStatus[a.name] === 'configured' || currentApiStatus[a.name] === 'skipped'
    )
    if (apisNeedingAuth.length > 0 && !allApisHandled) {
      return 'api-auth'
    }

    return 'ready'
  }, [])

  /**
   * Start the setup flow - extract definition and check what's needed
   */
  const startSetup = useCallback(async () => {
    setStep('extracting')
    setExtractionMessage('Reading agent configuration...')
    setIsLoading(true)
    setErrorMessage(null)

    try {
      // First, get or extract the definition
      setExtractionMessage('Parsing agent document...')
      const def = await window.electronAPI.getAgentDefinition(workspaceId, agentId)

      if (!def) {
        // Try forcing extraction via reload
        setExtractionMessage('Extracting agent configuration...')
        const reloaded = await window.electronAPI.reloadAgent(workspaceId, agentId)
        if (!reloaded) {
          throw new Error('Failed to extract agent definition')
        }
        // Fetch the definition again
        const freshDef = await window.electronAPI.getAgentDefinition(workspaceId, agentId)
        if (!freshDef) {
          throw new Error('Failed to load agent definition after extraction')
        }
        setDefinition(freshDef)
        setConcerns(freshDef.concerns || [])
        setMcpServers(freshDef.mcpServers || [])
        setApis(freshDef.apis || [])
      } else {
        setDefinition(def)
        setConcerns(def.concerns || [])
        setMcpServers(def.mcpServers || [])
        setApis(def.apis || [])
      }

      // Get current auth status
      setExtractionMessage('Checking authentication status...')
      const authStatus = await window.electronAPI.getAgentAuthStatus(workspaceId, agentId)

      // Initialize status from auth check
      const initialMcpStatus: Record<string, McpServerAuthStatus> = {}
      for (const server of authStatus.mcpServers) {
        if (server.requiresAuth) {
          initialMcpStatus[server.name] = server.hasAuth ? 'authenticated' : 'pending'
        }
      }
      setMcpServerStatus(initialMcpStatus)

      const initialApiStatus: Record<string, ApiAuthStatus> = {}
      for (const api of authStatus.apis) {
        if (api.auth?.type && api.auth.type !== 'none') {
          initialApiStatus[api.name] = api.hasAuth ? 'configured' : 'pending'
        }
      }
      setApiStatus(initialApiStatus)

      // Use the fetched definition for next step determination
      const finalDef = def || await window.electronAPI.getAgentDefinition(workspaceId, agentId)
      if (finalDef) {
        const nextStep = determineNextStep(finalDef, initialMcpStatus, initialApiStatus)
        setStep(nextStep)
      } else {
        setStep('ready')
      }
    } catch (error) {
      console.error('[useAgentSetup] Error:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Setup failed')
      setStep('error')
    } finally {
      setIsLoading(false)
      setExtractionMessage(null)
    }
  }, [workspaceId, agentId, determineNextStep])

  /**
   * Submit answers for concerns and proceed
   */
  const submitReview = useCallback(async (_answers: Record<number, string>) => {
    if (!definition) return

    setIsLoading(true)
    try {
      // For now, we just acknowledge the concerns and proceed
      // In the future, this could send answers back to the agent
      setConcerns([])

      // Check MCP and API auth status
      const authStatus = await window.electronAPI.getAgentAuthStatus(workspaceId, agentId)

      // Update status from auth check
      const newMcpStatus: Record<string, McpServerAuthStatus> = {}
      for (const server of authStatus.mcpServers) {
        if (server.requiresAuth) {
          newMcpStatus[server.name] = server.hasAuth ? 'authenticated' : 'pending'
        }
      }
      setMcpServerStatus(newMcpStatus)

      const newApiStatus: Record<string, ApiAuthStatus> = {}
      for (const api of authStatus.apis) {
        if (api.auth?.type && api.auth.type !== 'none') {
          newApiStatus[api.name] = api.hasAuth ? 'configured' : 'pending'
        }
      }
      setApiStatus(newApiStatus)

      // Clear concerns from definition for next step check
      const defWithoutConcerns = { ...definition, concerns: [] }
      const nextStep = determineNextStep(defWithoutConcerns, newMcpStatus, newApiStatus)
      setStep(nextStep)
    } catch (error) {
      console.error('[useAgentSetup] Review error:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to process review')
      setStep('error')
    } finally {
      setIsLoading(false)
    }
  }, [definition, workspaceId, agentId, determineNextStep])

  /**
   * Start OAuth flow for an MCP server
   */
  const startMcpOAuth = useCallback(async (serverName: string) => {
    const server = mcpServers.find(s => s.name === serverName)
    if (!server) return

    setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticating' }))

    try {
      const result = await window.electronAPI.startMcpOAuth(workspaceId, agentId, server.url, serverName)
      if (result.success) {
        setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticated' }))
      } else {
        // Fall back to bearer input on failure
        setMcpServerStatus(prev => ({ ...prev, [serverName]: 'bearer-input' }))
        console.warn('[useAgentSetup] OAuth failed, falling back to bearer:', result.error)
      }
    } catch (error) {
      console.error('[useAgentSetup] OAuth error:', error)
      setMcpServerStatus(prev => ({ ...prev, [serverName]: 'bearer-input' }))
    }
  }, [workspaceId, agentId, mcpServers])

  /**
   * Submit bearer token for an MCP server
   */
  const submitMcpBearer = useCallback(async (serverName: string, token: string) => {
    setIsLoading(true)
    try {
      await window.electronAPI.saveMcpBearer(workspaceId, agentId, serverName, token)
      setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticated' }))
    } catch (error) {
      console.error('[useAgentSetup] Bearer save error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId])

  /**
   * Skip an MCP server (optional auth)
   */
  const skipMcpServer = useCallback((serverName: string) => {
    setMcpServerStatus(prev => ({ ...prev, [serverName]: 'skipped' }))
  }, [])

  /**
   * Switch to bearer input mode for an MCP server
   */
  const setMcpBearerInput = useCallback((serverName: string) => {
    setMcpServerStatus(prev => ({ ...prev, [serverName]: 'bearer-input' }))
  }, [])

  /**
   * Complete MCP auth and move to next step
   */
  const completeMcpAuth = useCallback(() => {
    if (!definition) return

    // Check if we need API auth
    const apisNeedingAuth = apis.filter(a => a.auth?.type && a.auth.type !== 'none')
    const allApisHandled = apisNeedingAuth.every(
      a => apiStatus[a.name] === 'configured' || apiStatus[a.name] === 'skipped'
    )

    if (apisNeedingAuth.length > 0 && !allApisHandled) {
      setStep('api-auth')
    } else {
      setStep('ready')
    }
  }, [definition, apis, apiStatus])

  /**
   * Submit API credentials
   */
  const submitApiCredentials = useCallback(async (
    apiName: string,
    credentials: string | { username: string; password: string }
  ) => {
    setIsLoading(true)
    try {
      // Convert credentials to string format expected by IPC
      const credString = typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      await window.electronAPI.saveApiCredentials(workspaceId, agentId, apiName, credString)
      setApiStatus(prev => ({ ...prev, [apiName]: 'configured' }))
    } catch (error) {
      console.error('[useAgentSetup] API credentials save error:', error)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId])

  /**
   * Skip an API (optional auth)
   */
  const skipApi = useCallback((apiName: string) => {
    setApiStatus(prev => ({ ...prev, [apiName]: 'skipped' }))
  }, [])

  /**
   * Complete API auth and move to ready
   */
  const completeApiAuth = useCallback(() => {
    setStep('ready')
  }, [])

  /**
   * Retry setup from the beginning
   */
  const retry = useCallback(async () => {
    setErrorMessage(null)
    await startSetup()
  }, [startSetup])

  /**
   * Reset everything
   */
  const reset = useCallback(() => {
    setStep('idle')
    setDefinition(null)
    setConcerns([])
    setMcpServers([])
    setApis([])
    setMcpServerStatus({})
    setApiStatus({})
    setErrorMessage(null)
    setExtractionMessage(null)
    setIsLoading(false)
  }, [])

  // Memoize the return value to avoid unnecessary re-renders
  return useMemo(() => ({
    step,
    definition,
    concerns,
    mcpServers,
    apis,
    mcpServerStatus,
    apiStatus,
    errorMessage,
    extractionMessage,
    isLoading,
    startSetup,
    submitReview,
    startMcpOAuth,
    submitMcpBearer,
    skipMcpServer,
    setMcpBearerInput,
    completeMcpAuth,
    submitApiCredentials,
    skipApi,
    completeApiAuth,
    retry,
    reset,
  }), [
    step,
    definition,
    concerns,
    mcpServers,
    apis,
    mcpServerStatus,
    apiStatus,
    errorMessage,
    extractionMessage,
    isLoading,
    startSetup,
    submitReview,
    startMcpOAuth,
    submitMcpBearer,
    skipMcpServer,
    setMcpBearerInput,
    completeMcpAuth,
    submitApiCredentials,
    skipApi,
    completeApiAuth,
    retry,
    reset,
  ])
}
