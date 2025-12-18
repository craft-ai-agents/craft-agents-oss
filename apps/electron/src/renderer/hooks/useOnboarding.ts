/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Handles Craft OAuth, space selection, MCP setup, and billing configuration.
 */
import { useState, useCallback, useEffect } from 'react'
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
  handleSelectSpace: (spaceId: string, spaceName: string) => void

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

    const categories: SpaceCategory[] = []

    if (personalSpace) {
      categories.push({
        name: 'Recommended',
        spaces: [{
          id: personalSpace.id,
          name: personalSpace.name,
          type: 'personal',
        }],
      })
    }

    if (teamSpaces.length > 0) {
      categories.push({
        name: 'Your Spaces',
        spaces: teamSpaces.map(s => ({
          id: s.id,
          name: s.name,
          type: 'team' as const,
        })),
      })
    }

    if (otherSpaces.length > 0) {
      categories.push({
        name: 'Other Spaces',
        spaces: otherSpaces.map(s => ({
          id: s.id,
          name: s.name,
          type: 'shared' as const,
        })),
      })
    }

    return categories
  }, [])

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
              errorMessage: 'Failed to setup workspace connection',
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
  }, [state, craftToken, onComplete])

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
  const handleSelectSpace = useCallback((spaceId: string, spaceName: string) => {
    setState(s => ({
      ...s,
      selectedSpaceId: spaceId,
      selectedSpaceName: spaceName,
    }))
  }, [])

  // Select billing method
  const handleSelectBillingMethod = useCallback((method: BillingMethod) => {
    setState(s => ({ ...s, billingMethod: method }))
  }, [])

  // Submit credential (API key)
  const handleSubmitCredential = useCallback(async (credential: string) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // For API key, we just validate it's not empty
      // TODO: Could add actual API key validation here
      if (!credential.trim()) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'Please enter a valid API key',
        }))
        return
      }

      // Save config and complete
      await handleSaveConfig(credential)

      setState(s => ({
        ...s,
        credentialStatus: 'success',
        step: 'complete',
      }))
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Validation failed',
      }))
    }
  }, [])

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
  }, [existingClaudeToken])

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
  }, [isClaudeCliInstalled])

  // Save configuration
  const handleSaveConfig = useCallback(async (credential?: string) => {
    if (!state.billingMethod) return

    setState(s => ({ ...s, completionStatus: 'saving' }))

    try {
      // For existing users (updating billing only), don't create a new workspace
      if (state.isExistingUser && !state.selectedSpaceName) {
        // Just update billing config, no workspace changes
        const result = await window.electronAPI.saveOnboardingConfig({
          authType: billingMethodToAuthType(state.billingMethod),
          credential,
          // No workspace - tells backend to only update billing
        })

        if (result.success) {
          setState(s => ({ ...s, completionStatus: 'complete' }))
        } else {
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
        console.error('[Onboarding] Cannot save config: space name is missing')
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: 'Space name is required. Please restart onboarding.',
        }))
        return
      }
      const workspaceName = state.selectedSpaceName
      const mcpUrl = selectedMcpLink?.mcpUrl || ''

      // If MCP server requires OAuth and we don't have credentials, run OAuth
      if (mcpUrl && !mcpCredentials) {
        // Try to start MCP OAuth if the server requires it
        try {
          const mcpResult = await window.electronAPI.startWorkspaceMcpOAuth(mcpUrl)
          if (mcpResult.success && mcpResult.accessToken) {
            setMcpCredentials({
              accessToken: mcpResult.accessToken,
              clientId: mcpResult.clientId,
            })
          }
        } catch {
          // MCP OAuth failed or not required, continue without MCP credentials
          console.log('MCP OAuth not required or failed')
        }
      }

      const result = await window.electronAPI.saveOnboardingConfig({
        authType: billingMethodToAuthType(state.billingMethod),
        workspace: {
          name: workspaceName,
          mcpUrl,
        },
        credential,
        mcpCredentials: mcpCredentials || undefined,
      })

      if (result.success) {
        setState(s => ({ ...s, completionStatus: 'complete' }))
      } else {
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: result.error || 'Failed to save configuration',
        }))
      }
    } catch (error) {
      console.error('Failed to save config:', error)
      setState(s => ({
        ...s,
        errorMessage: error instanceof Error ? error.message : 'Failed to save configuration',
      }))
    }
  }, [state.billingMethod, state.selectedSpaceName, state.isExistingUser, selectedMcpLink, mcpCredentials])

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
