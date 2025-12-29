/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Handles Craft OAuth, space selection, MCP setup, and billing configuration.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  OnboardingState,
  OnboardingStep,
  LoginStatus,
  CredentialStatus,
  BillingMethod,
  SpaceCategory,
  CraftSpace,
} from '@/components/onboarding'
import type { CraftMcpLink, AuthType, SetupNeeds, CraftSpace as ApiCraftSpace } from '../../shared/types'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
}

interface UseOnboardingReturn {
  // State
  state: OnboardingState
  spaceCategories: SpaceCategory[]
  isLoadingSpaces: boolean

  // Wizard actions
  handleContinue: () => void
  handleBack: () => void

  // Craft OAuth
  handleLogin: () => void
  handleOpenLoginManually: () => void
  handleRetryLogin: () => void

  // Space selection
  handleSelectSpace: (spaceId: string, spaceName: string, iconUrl?: string) => void

  // Billing
  handleSelectBillingMethod: (method: BillingMethod) => void

  // Credentials
  handleSubmitCredential: (credential: string) => void
  handleStartOAuth: () => void

  // Claude OAuth
  existingClaudeToken: string | null
  isClaudeCliInstalled: boolean
  handleUseExistingClaudeToken: () => void

  // Completion
  handleFinish: () => void
  handleCancel: () => void

  // Reset
  reset: () => void
}

// Map BillingMethod to AuthType
function billingMethodToAuthType(method: BillingMethod): AuthType {
  switch (method) {
    case 'craft_credits': return 'craft_credits'
    case 'api_key': return 'api_key'
    case 'claude_oauth': return 'oauth_token'
  }
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
}: UseOnboardingOptions): UseOnboardingReturn {
  // Determine initial step based on setup needs
  const getInitialStep = (): OnboardingStep => {
    if (!initialSetupNeeds) return 'welcome'
    if (initialSetupNeeds.needsCraftAuth) return 'welcome'
    if (initialSetupNeeds.needsBillingConfig) return 'welcome'
    if (initialSetupNeeds.needsCredentials) return 'welcome'
    return 'welcome'
  }

  // Main wizard state
  const [state, setState] = useState<OnboardingState>({
    step: getInitialStep(),
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    selectedSpaceId: null,
    selectedSpaceName: null,
    selectedSpaceIconUrl: null,
    billingMethod: null,
    isExistingUser: !initialSetupNeeds?.needsCraftAuth, // Has Craft auth + workspace, just needs billing
  })

  // Space categories for selection
  const [spaceCategories, setSpaceCategories] = useState<SpaceCategory[]>([])
  const [isLoadingSpaces, setIsLoadingSpaces] = useState(false)

  // Craft token and profile (temporary, saved on completion)
  const [craftToken, setCraftToken] = useState<string | null>(null)
  const [craftProfile, setCraftProfile] = useState<{
    userId: string
    firstName: string
    lastName: string
    spaces: ApiCraftSpace[]
    teams: Array<{ id: string; name: string; isPrivate: boolean; role: string; tier?: string | null }>
  } | null>(null)

  // Selected MCP link
  const [selectedMcpLink, setSelectedMcpLink] = useState<CraftMcpLink | null>(null)
  // Ref to keep latest value for use in callbacks (avoids stale closure issues)
  // Updated synchronously during render, not in useEffect, to ensure it's available immediately
  const selectedMcpLinkRef = useRef<CraftMcpLink | null>(null)
  selectedMcpLinkRef.current = selectedMcpLink

  // MCP OAuth credentials
  const [mcpCredentials, setMcpCredentials] = useState<{
    accessToken: string
    clientId?: string
  } | null>(null)

  // Categorize spaces into groups (converts from API spaces to UI spaces with type)
  const categorizeSpaces = useCallback((spaces: ApiCraftSpace[], teams: Array<{ id: string; name: string; isPrivate: boolean; role: string }>, userId: string) => {
    const personalSpace = spaces.find(s => s.id === userId)
    const teamSpaces = spaces.filter(s => s.id !== userId && s.teamId)
    const otherSpaces = spaces.filter(s => s.id !== userId && !s.teamId)

    // Sort helper - alphabetical by name
    const sortByName = <T extends { name: string }>(arr: T[]) =>
      [...arr].sort((a, b) => a.name.localeCompare(b.name))

    const categories: SpaceCategory[] = []

    if (personalSpace) {
      categories.push({
        name: 'Recommended',
        spaces: [{
          id: personalSpace.id,
          name: personalSpace.name,
          type: 'personal',
          iconUrl: personalSpace.iconUrl ?? undefined,
        }],
      })
    }

    if (teamSpaces.length > 0) {
      categories.push({
        name: 'Your Spaces',
        spaces: sortByName(teamSpaces).map(s => ({
          id: s.id,
          name: s.name,
          type: 'team' as const,
          iconUrl: s.iconUrl ?? undefined,
        })),
      })
    }

    if (otherSpaces.length > 0) {
      categories.push({
        name: 'Other Spaces',
        spaces: sortByName(otherSpaces).map(s => ({
          id: s.id,
          name: s.name,
          type: 'shared' as const,
          iconUrl: s.iconUrl ?? undefined,
        })),
      })
    }

    return categories
  }, [])

  // Save configuration - MUST be defined before handleContinue to avoid stale closure
  const handleSaveConfig = useCallback(async (credential?: string) => {
    const callId = Math.random().toString(36).slice(2, 8)
    console.log(`[Onboarding:Renderer] handleSaveConfig called (${callId})`, {
      hasCredential: !!credential,
      credentialLength: credential?.length,
      billingMethod: state.billingMethod,
      isExistingUser: state.isExistingUser,
      selectedSpaceName: state.selectedSpaceName,
      selectedSpaceIconUrl: state.selectedSpaceIconUrl,
      hasMcpLink: !!selectedMcpLink,
      mcpUrl: selectedMcpLink?.mcpUrl,
      hasMcpCredentials: !!mcpCredentials,
    })

    if (!state.billingMethod) {
      console.log('[Onboarding:Renderer] No billing method, returning early')
      return
    }

    setState(s => ({ ...s, completionStatus: 'saving' }))
    console.log('[Onboarding:Renderer] Set completionStatus to saving')

    try {
      // For existing users (updating billing only), don't create a new workspace
      if (state.isExistingUser && !state.selectedSpaceName) {
        console.log('[Onboarding:Renderer] Existing user path - updating billing only')
        const authType = billingMethodToAuthType(state.billingMethod)
        console.log('[Onboarding:Renderer] Calling saveOnboardingConfig (billing only)', { authType })

        const result = await window.electronAPI.saveOnboardingConfig({
          authType,
          credential,
          // No workspace - tells backend to only update billing
        })
        console.log('[Onboarding:Renderer] saveOnboardingConfig result:', result)

        if (result.success) {
          console.log('[Onboarding:Renderer] Save successful, setting completionStatus to complete')
          setState(s => ({ ...s, completionStatus: 'complete' }))
        } else {
          console.error('[Onboarding:Renderer] Save failed:', result.error)
          setState(s => ({
            ...s,
            completionStatus: 'saving',
            errorMessage: result.error || 'Failed to save configuration',
          }))
        }
        return
      }

      // Creating a new workspace - space name is required
      if (!state.selectedSpaceName) {
        console.error('[Onboarding:Renderer] Cannot save config: space name is missing')
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: 'Space name is required. Please restart onboarding.',
        }))
        return
      }
      const workspaceName = state.selectedSpaceName
      // Use ref to get latest value (avoids stale closure from handleContinue)
      console.log(`[Onboarding:Renderer] (${callId}) selectedMcpLinkRef.current:`, selectedMcpLinkRef.current)
      console.log(`[Onboarding:Renderer] (${callId}) selectedMcpLink state:`, selectedMcpLink)
      const mcpUrl = selectedMcpLinkRef.current?.mcpUrl || ''
      console.log(`[Onboarding:Renderer] (${callId}) New workspace path`, { workspaceName, mcpUrl })

      // Track MCP credentials - use OAuth result directly, not state (avoids stale closure)
      let mcpCredsToSave: { accessToken: string; clientId?: string } | undefined = mcpCredentials || undefined

      // If MCP server requires OAuth and we don't have credentials, run OAuth
      if (mcpUrl && !mcpCredentials) {
        console.log('[Onboarding:Renderer] Attempting MCP OAuth for:', mcpUrl)
        // Try to start MCP OAuth if the server requires it
        try {
          console.log('[Onboarding:Renderer] Calling startWorkspaceMcpOAuth...')
          const mcpResult = await window.electronAPI.startWorkspaceMcpOAuth(mcpUrl)
          console.log('[Onboarding:Renderer] MCP OAuth result:', mcpResult)
          if (mcpResult.success && mcpResult.accessToken) {
            // Use result directly for saving, not state
            mcpCredsToSave = {
              accessToken: mcpResult.accessToken,
              clientId: mcpResult.clientId,
            }
            setMcpCredentials(mcpCredsToSave)
            console.log('[Onboarding:Renderer] MCP credentials saved')
          }
        } catch (mcpError) {
          // MCP OAuth failed or not required, continue without MCP credentials
          console.log('[Onboarding:Renderer] MCP OAuth not required or failed:', mcpError)
        }
      } else {
        console.log('[Onboarding:Renderer] Skipping MCP OAuth', { mcpUrl: !!mcpUrl, hasMcpCredentials: !!mcpCredentials })
      }

      const authType = billingMethodToAuthType(state.billingMethod)
      console.log(`[Onboarding:Renderer] Calling saveOnboardingConfig (${callId})`, {
        authType,
        workspaceName,
        mcpUrl,
        hasCredential: !!credential,
        hasMcpCredentials: !!mcpCredsToSave,
      })

      const result = await window.electronAPI.saveOnboardingConfig({
        authType,
        workspace: {
          name: workspaceName,
          iconUrl: state.selectedSpaceIconUrl ?? undefined,
          mcpUrl: mcpUrl || undefined,
        },
        credential,
        mcpCredentials: mcpCredsToSave,
      })
      console.log('[Onboarding:Renderer] saveOnboardingConfig result:', result)

      if (result.success) {
        console.log('[Onboarding:Renderer] Save successful, setting completionStatus to complete')
        setState(s => ({ ...s, completionStatus: 'complete' }))
      } else {
        console.error('[Onboarding:Renderer] Save failed:', result.error)
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: result.error || 'Failed to save configuration',
        }))
      }
    } catch (error) {
      console.error('[Onboarding:Renderer] handleSaveConfig error:', error)
      setState(s => ({
        ...s,
        errorMessage: error instanceof Error ? error.message : 'Failed to save configuration',
      }))
    }
  }, [state.billingMethod, state.selectedSpaceName, state.selectedSpaceIconUrl, state.isExistingUser, selectedMcpLink, mcpCredentials])

  // Continue to next step
  const handleContinue = useCallback(async () => {
    switch (state.step) {
      case 'welcome':
        if (state.isExistingUser) {
          // Skip to billing method for existing users
          setState(s => ({ ...s, step: 'billing-method' }))
        } else {
          setState(s => ({ ...s, step: 'craft-login' }))
        }
        break

      case 'craft-login':
        // Auto-continues on successful login
        break

      case 'select-space':
        if (state.selectedSpaceId && craftToken) {
          // Fetch or create MCP link for the selected space
          setIsLoadingSpaces(true)
          try {
            const links = await window.electronAPI.getMcpLinks(state.selectedSpaceId, craftToken)
            const existingLink = links.find(l => l.mcpUrl)

            let mcpLink: typeof existingLink
            if (existingLink) {
              mcpLink = existingLink
              setSelectedMcpLink(existingLink)
            } else {
              // Create new MCP link
              const newLink = await window.electronAPI.createMcpLink(state.selectedSpaceId, craftToken)
              mcpLink = newLink
              setSelectedMcpLink(newLink)
            }

            // Go to billing method selection
            setState(s => ({ ...s, step: 'billing-method' }))
          } catch (error) {
            console.error('Failed to setup MCP link:', error)
            setState(s => ({
              ...s,
              errorMessage: 'Failed to setup workspace source',
            }))
          } finally {
            setIsLoadingSpaces(false)
          }
        }
        break

      case 'billing-method':
        if (state.billingMethod === 'craft_credits') {
          // No credentials needed, go to completion
          setState(s => ({ ...s, step: 'complete' }))
          // Trigger save
          handleSaveConfig()
        } else {
          setState(s => ({ ...s, step: 'credentials' }))
        }
        break

      case 'credentials':
        // Handled by handleSubmitCredential
        break

      case 'complete':
        onComplete()
        break
    }
  }, [state, craftToken, onComplete, handleSaveConfig])

  // Go back to previous step
  const handleBack = useCallback(() => {
    switch (state.step) {
      case 'craft-login':
        setState(s => ({ ...s, step: 'welcome', loginStatus: 'idle', errorMessage: undefined }))
        break
      case 'select-space':
        setState(s => ({ ...s, step: 'craft-login', selectedSpaceId: null, selectedSpaceName: null }))
        break
      case 'billing-method':
        if (state.isExistingUser) {
          setState(s => ({ ...s, step: 'welcome' }))
        } else {
          setState(s => ({ ...s, step: 'select-space' }))
        }
        break
      case 'credentials':
        setState(s => ({ ...s, step: 'billing-method', credentialStatus: 'idle', errorMessage: undefined }))
        break
    }
  }, [state.step, state.isExistingUser])

  // Start Craft OAuth
  const handleLogin = useCallback(async () => {
    setState(s => ({ ...s, loginStatus: 'waiting', errorMessage: undefined }))

    try {
      const result = await window.electronAPI.startCraftOAuth()

      if (result.success && result.token && result.profile) {
        setCraftToken(result.token)
        setCraftProfile(result.profile)

        // Categorize and set spaces
        const categories = categorizeSpaces(
          result.profile.spaces,
          result.profile.teams,
          result.profile.userId
        )
        setSpaceCategories(categories)

        setState(s => ({
          ...s,
          loginStatus: 'success',
        }))

        // Auto-advance to space selection after brief success state
        setTimeout(() => {
          setState(s => ({ ...s, step: 'select-space' }))
        }, 1000)
      } else {
        setState(s => ({
          ...s,
          loginStatus: 'error',
          errorMessage: result.error || 'Authentication failed',
        }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        loginStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Authentication failed',
      }))
    }
  }, [categorizeSpaces])

  // Open login page manually (if auto-open failed)
  const handleOpenLoginManually = useCallback(() => {
    // Re-trigger the OAuth flow
    handleLogin()
  }, [handleLogin])

  // Retry login after error
  const handleRetryLogin = useCallback(() => {
    setState(s => ({ ...s, loginStatus: 'idle', errorMessage: undefined }))
    handleLogin()
  }, [handleLogin])

  // Select a space
  const handleSelectSpace = useCallback((spaceId: string, spaceName: string, iconUrl?: string) => {
    setState(s => ({
      ...s,
      selectedSpaceId: spaceId,
      selectedSpaceName: spaceName,
      selectedSpaceIconUrl: iconUrl ?? null,
    }))
  }, [])

  // Select billing method
  const handleSelectBillingMethod = useCallback((method: BillingMethod) => {
    setState(s => ({ ...s, billingMethod: method }))
  }, [])

  // Submit credential (API key)
  const handleSubmitCredential = useCallback(async (credential: string) => {
    console.log('[Onboarding:Renderer] handleSubmitCredential called', {
      credentialLength: credential?.length,
      billingMethod: state.billingMethod,
    })
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // For API key, we just validate it's not empty
      // TODO: Could add actual API key validation here
      if (!credential.trim()) {
        console.log('[Onboarding:Renderer] Credential is empty, returning error')
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'Please enter a valid API key',
        }))
        return
      }

      // Save config and complete
      console.log('[Onboarding:Renderer] Calling handleSaveConfig...')
      await handleSaveConfig(credential)
      console.log('[Onboarding:Renderer] handleSaveConfig completed successfully')

      setState(s => ({
        ...s,
        credentialStatus: 'success',
        step: 'complete',
      }))
      console.log('[Onboarding:Renderer] Set step to complete')
    } catch (error) {
      console.error('[Onboarding:Renderer] handleSubmitCredential error:', error)
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Validation failed',
      }))
    }
  }, [state.billingMethod, handleSaveConfig])

  // Claude OAuth state
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null)
  const [isClaudeCliInstalled, setIsClaudeCliInstalled] = useState(false)
  const [claudeOAuthChecked, setClaudeOAuthChecked] = useState(false)

  // Check for existing Claude token when reaching credentials step with oauth billing
  useEffect(() => {
    if (state.step === 'credentials' && state.billingMethod === 'claude_oauth' && !claudeOAuthChecked) {
      const checkClaudeAuth = async () => {
        try {
          const [token, cliInstalled] = await Promise.all([
            window.electronAPI.getExistingClaudeToken(),
            window.electronAPI.isClaudeCliInstalled(),
          ])
          setExistingClaudeToken(token)
          setIsClaudeCliInstalled(cliInstalled)
          setClaudeOAuthChecked(true)
        } catch (error) {
          console.error('Failed to check Claude auth:', error)
          setClaudeOAuthChecked(true)
        }
      }
      checkClaudeAuth()
    }
  }, [state.step, state.billingMethod, claudeOAuthChecked])

  // Use existing Claude token (from keychain)
  const handleUseExistingClaudeToken = useCallback(async () => {
    if (!existingClaudeToken) return

    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // Save config with the existing token
      await handleSaveConfig(existingClaudeToken)

      setState(s => ({
        ...s,
        credentialStatus: 'success',
        step: 'complete',
      }))
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to save token',
      }))
    }
  }, [existingClaudeToken, handleSaveConfig])

  // Start Claude OAuth (run claude setup-token)
  const handleStartOAuth = useCallback(async () => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      if (!isClaudeCliInstalled) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'Claude CLI is not installed. Please install it first: npm install -g @anthropic-ai/claude-code',
        }))
        return
      }

      // Run claude setup-token (opens browser for OAuth)
      const result = await window.electronAPI.runClaudeSetupToken()

      if (result.success && result.token) {
        setExistingClaudeToken(result.token)
        // Save config with the token
        await handleSaveConfig(result.token)

        setState(s => ({
          ...s,
          credentialStatus: 'success',
          step: 'complete',
        }))
      } else {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: result.error || 'OAuth failed - token not found after setup',
        }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'OAuth failed',
      }))
    }
  }, [isClaudeCliInstalled, handleSaveConfig])

  // Finish onboarding
  const handleFinish = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Cancel onboarding
  const handleCancel = useCallback(() => {
    // Could show a confirmation dialog here
    // For now, just go back to welcome
    setState(s => ({ ...s, step: 'welcome' }))
  }, [])

  // Reset onboarding to initial state (used after logout)
  const reset = useCallback(() => {
    setState({
      step: 'welcome',
      loginStatus: 'idle',
      credentialStatus: 'idle',
      completionStatus: 'saving',
      selectedSpaceId: null,
      selectedSpaceName: null,
      selectedSpaceIconUrl: null,
      billingMethod: null,
      isExistingUser: false,
      errorMessage: undefined,
    })
    setSpaceCategories([])
    setCraftToken(null)
    setCraftProfile(null)
    setSelectedMcpLink(null)
    setMcpCredentials(null)
    setExistingClaudeToken(null)
    setIsClaudeCliInstalled(false)
    setClaudeOAuthChecked(false)
  }, [])

  return {
    state,
    spaceCategories,
    isLoadingSpaces,
    handleContinue,
    handleBack,
    handleLogin,
    handleOpenLoginManually,
    handleRetryLogin,
    handleSelectSpace,
    handleSelectBillingMethod,
    handleSubmitCredential,
    handleStartOAuth,
    existingClaudeToken,
    isClaudeCliInstalled,
    handleUseExistingClaudeToken,
    handleFinish,
    handleCancel,
    reset,
  }
}
