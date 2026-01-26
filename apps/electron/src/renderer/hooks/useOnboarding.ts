/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Flow:
 * 1. Welcome
 * 2. Git Bash (Windows only, if not found)
 * 3. API Setup (API Key / Claude OAuth)
 * 4. Credentials (API Key or Claude OAuth)
 * 5. Complete
 */
import { useState, useCallback, useEffect } from 'react'
import type {
  OnboardingState,
  OnboardingStep,
  LoginStatus,
  CredentialStatus,
  ApiSetupMethod,
} from '@/components/onboarding'
import type { ApiKeySubmitData } from '@/components/apisetup'
import type { AuthType, SetupNeeds, GitBashStatus } from '../../shared/types'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
  /** Start the wizard at a specific step (default: 'welcome') */
  initialStep?: OnboardingStep
  /** Called when user goes back from the initial step (dismisses the wizard) */
  onDismiss?: () => void
  /** Called immediately after config is saved to disk (before wizard closes).
   *  Use this to propagate billing/model changes to the UI without waiting for onComplete. */
  onConfigSaved?: () => void
}

interface UseOnboardingReturn {
  // State
  state: OnboardingState

  // Wizard actions
  handleContinue: () => void
  handleBack: () => void

  // API Setup
  handleSelectApiSetupMethod: (method: ApiSetupMethod) => void

  // Credentials
  handleSubmitCredential: (data: ApiKeySubmitData) => void
  handleStartOAuth: () => void

  // Claude OAuth (two-step flow)
  isWaitingForCode: boolean
  handleSubmitAuthCode: (code: string) => void
  handleCancelOAuth: () => void

  // Git Bash (Windows)
  handleBrowseGitBash: () => Promise<string | null>
  handleUseGitBashPath: (path: string) => void
  handleRecheckGitBash: () => void
  handleClearError: () => void

  // Completion
  handleFinish: () => void
  handleCancel: () => void

  // Reset
  reset: () => void
}

// Map ApiSetupMethod to AuthType for backend persistence
function apiSetupMethodToAuthType(method: ApiSetupMethod): AuthType {
  switch (method) {
    case 'api_key': return 'api_key'
    case 'claude_oauth': return 'oauth_token'
  }
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
  initialStep = 'welcome',
  onDismiss,
  onConfigSaved,
}: UseOnboardingOptions): UseOnboardingReturn {
  // Main wizard state
  const [state, setState] = useState<OnboardingState>({
    step: initialStep,
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    apiSetupMethod: null,
    isExistingUser: initialSetupNeeds?.needsBillingConfig ?? false,
    gitBashStatus: undefined,
    isRecheckingGitBash: false,
    isCheckingGitBash: true, // Start as true until check completes
  })

  // Check Git Bash on Windows when starting from welcome
  useEffect(() => {
    const checkGitBash = async () => {
      try {
        const status = await window.electronAPI.checkGitBash()
        setState(s => ({ ...s, gitBashStatus: status, isCheckingGitBash: false }))
      } catch (error) {
        console.error('[Onboarding] Failed to check Git Bash:', error)
        // Even on error, allow continuing (will skip git-bash step)
        setState(s => ({ ...s, isCheckingGitBash: false }))
      }
    }
    checkGitBash()
  }, [])

  // Save configuration
  const handleSaveConfig = useCallback(async (credential?: string, options?: { baseUrl?: string; customModel?: string }) => {
    if (!state.apiSetupMethod) {
      console.log('[Onboarding] No API setup method selected, returning early')
      return
    }

    setState(s => ({ ...s, completionStatus: 'saving' }))

    try {
      const authType = apiSetupMethodToAuthType(state.apiSetupMethod)
      console.log('[Onboarding] Saving config with authType:', authType)

      const result = await window.electronAPI.saveOnboardingConfig({
        authType,
        credential,
        anthropicBaseUrl: options?.baseUrl || null,
        customModel: options?.customModel || null,
      })

      if (result.success) {
        console.log('[Onboarding] Save successful')
        setState(s => ({ ...s, completionStatus: 'complete' }))
        // Notify caller immediately so UI can reflect billing/model changes
        onConfigSaved?.()
      } else {
        console.error('[Onboarding] Save failed:', result.error)
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: result.error || 'Failed to save configuration',
        }))
      }
    } catch (error) {
      console.error('[Onboarding] handleSaveConfig error:', error)
      setState(s => ({
        ...s,
        errorMessage: error instanceof Error ? error.message : 'Failed to save configuration',
      }))
    }
  }, [state.apiSetupMethod, onConfigSaved])

  // Continue to next step
  const handleContinue = useCallback(async () => {
    switch (state.step) {
      case 'welcome':
        // On Windows, check if Git Bash is needed
        if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'api-setup' }))
        }
        break

      case 'git-bash':
        setState(s => ({ ...s, step: 'api-setup' }))
        break

      case 'api-setup':
        setState(s => ({ ...s, step: 'credentials' }))
        break

      case 'credentials':
        // Handled by handleSubmitCredential
        break

      case 'complete':
        onComplete()
        break
    }
  }, [state.step, state.gitBashStatus, state.apiSetupMethod, onComplete])

  // Go back to previous step. If at the initial step, call onDismiss instead.
  const handleBack = useCallback(() => {
    if (state.step === initialStep && onDismiss) {
      onDismiss()
      return
    }
    switch (state.step) {
      case 'git-bash':
        setState(s => ({ ...s, step: 'welcome' }))
        break
      case 'api-setup':
        // If on Windows and Git Bash was needed, go back to git-bash step
        if (state.gitBashStatus?.platform === 'win32' && state.gitBashStatus?.found === false) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'welcome' }))
        }
        break
      case 'credentials':
        setState(s => ({ ...s, step: 'api-setup', credentialStatus: 'idle', errorMessage: undefined }))
        break
    }
  }, [state.step, state.gitBashStatus, initialStep, onDismiss])

  // Select API setup method
  const handleSelectApiSetupMethod = useCallback((method: ApiSetupMethod) => {
    setState(s => ({ ...s, apiSetupMethod: method }))
  }, [])

  // Submit credential (API key + optional endpoint config)
  // Tests the connection first via /v1/messages before saving to catch issues early
  const handleSubmitCredential = useCallback(async (data: ApiKeySubmitData) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // API key is required for hosted providers (Anthropic, OpenRouter, etc.)
      // but optional for custom endpoints (Ollama, local models)
      if (!data.apiKey.trim() && !data.baseUrl) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'Please enter a valid API key',
        }))
        return
      }

      // Validate connection before saving — tests auth, endpoint reachability,
      // model existence, and tool support in one call
      const testResult = await window.electronAPI.testApiConnection(
        data.apiKey,
        data.baseUrl,
        data.customModel,
      )

      if (!testResult.success) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: testResult.error || 'Connection test failed',
        }))
        return
      }

      await handleSaveConfig(data.apiKey, { baseUrl: data.baseUrl, customModel: data.customModel })

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
  }, [handleSaveConfig])

  // Two-step OAuth flow state
  const [isWaitingForCode, setIsWaitingForCode] = useState(false)

  // Start Claude OAuth (native browser-based OAuth with PKCE - two-step flow)
  const handleStartOAuth = useCallback(async () => {
    setState(s => ({ ...s, errorMessage: undefined }))

    try {
      // Start OAuth flow - this opens the browser
      const result = await window.electronAPI.startClaudeOAuth()

      if (result.success) {
        // Browser opened successfully, now waiting for user to copy the code
        setIsWaitingForCode(true)
      } else {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: result.error || 'Failed to start OAuth',
        }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'OAuth failed',
      }))
    }
  }, [])

  // Submit authorization code (second step of OAuth flow)
  const handleSubmitAuthCode = useCallback(async (code: string) => {
    if (!code.trim()) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: 'Please enter the authorization code',
      }))
      return
    }

    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      const result = await window.electronAPI.exchangeClaudeCode(code.trim())

      if (result.success && result.token) {
        setIsWaitingForCode(false)
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
          errorMessage: result.error || 'Failed to exchange code',
        }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to exchange code',
      }))
    }
  }, [handleSaveConfig])

  // Cancel OAuth flow
  const handleCancelOAuth = useCallback(async () => {
    setIsWaitingForCode(false)
    setState(s => ({ ...s, credentialStatus: 'idle', errorMessage: undefined }))
    // Clear OAuth state on backend
    await window.electronAPI.clearClaudeOAuthState()
  }, [])

  // Git Bash handlers (Windows only)
  const handleBrowseGitBash = useCallback(async () => {
    return window.electronAPI.browseForGitBash()
  }, [])

  const handleUseGitBashPath = useCallback(async (path: string) => {
    const result = await window.electronAPI.setGitBashPath(path)
    if (result.success) {
      // Update state to mark Git Bash as found and continue
      setState(s => ({
        ...s,
        gitBashStatus: { ...s.gitBashStatus!, found: true, path },
        step: 'api-setup',
      }))
    } else {
      setState(s => ({
        ...s,
        errorMessage: result.error || 'Invalid path',
      }))
    }
  }, [])

  const handleRecheckGitBash = useCallback(async () => {
    setState(s => ({ ...s, isRecheckingGitBash: true }))
    try {
      const status = await window.electronAPI.checkGitBash()
      setState(s => ({
        ...s,
        gitBashStatus: status,
        isRecheckingGitBash: false,
        // If found, automatically continue to next step
        step: status.found ? 'api-setup' : s.step,
      }))
    } catch (error) {
      console.error('[Onboarding] Failed to recheck Git Bash:', error)
      setState(s => ({ ...s, isRecheckingGitBash: false }))
    }
  }, [])

  const handleClearError = useCallback(() => {
    setState(s => ({ ...s, errorMessage: undefined }))
  }, [])

  // Finish onboarding
  const handleFinish = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Cancel onboarding
  const handleCancel = useCallback(() => {
    setState(s => ({ ...s, step: 'welcome' }))
  }, [])

  // Reset onboarding to initial state (used after logout)
  const reset = useCallback(() => {
    setState({
      step: initialStep,
      loginStatus: 'idle',
      credentialStatus: 'idle',
      completionStatus: 'saving',
      apiSetupMethod: null,
      isExistingUser: false,
      errorMessage: undefined,
    })
    setIsWaitingForCode(false)
  }, [])

  return {
    state,
    handleContinue,
    handleBack,
    handleSelectApiSetupMethod,
    handleSubmitCredential,
    handleStartOAuth,
    // Two-step OAuth flow
    isWaitingForCode,
    handleSubmitAuthCode,
    handleCancelOAuth,
    // Git Bash (Windows)
    handleBrowseGitBash,
    handleUseGitBashPath,
    handleRecheckGitBash,
    handleClearError,
    handleFinish,
    handleCancel,
    reset,
  }
}
