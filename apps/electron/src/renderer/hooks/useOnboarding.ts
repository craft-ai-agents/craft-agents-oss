/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Simplified billing-only flow:
 * 1. Welcome
 * 2. Billing Method (API Key / Claude OAuth)
 * 3. Credentials (API Key or Claude OAuth)
 * 4. Complete
 */
import { useState, useCallback, useEffect } from 'react'
import type {
  OnboardingState,
  OnboardingStep,
  LoginStatus,
  CredentialStatus,
  BillingMethod,
} from '@/components/onboarding'
import type { AuthType, SetupNeeds } from '../../shared/types'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
}

interface UseOnboardingReturn {
  // State
  state: OnboardingState

  // Wizard actions
  handleContinue: () => void
  handleBack: () => void

  // Billing
  handleSelectBillingMethod: (method: BillingMethod) => void

  // Credentials
  handleSubmitCredential: (credential: string) => void
  handleStartOAuth: () => void

  // Claude OAuth
  existingClaudeToken: string | null
  isClaudeCliInstalled: boolean
  handleUseExistingClaudeToken: () => void
  // Two-step OAuth flow
  isWaitingForCode: boolean
  handleSubmitAuthCode: (code: string) => void
  handleCancelOAuth: () => void

  // Completion
  handleFinish: () => void
  handleCancel: () => void

  // Reset
  reset: () => void
}

// Map BillingMethod to AuthType
function billingMethodToAuthType(method: BillingMethod): AuthType {
  switch (method) {
    case 'api_key': return 'api_key'
    case 'claude_oauth': return 'oauth_token'
  }
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
}: UseOnboardingOptions): UseOnboardingReturn {
  // Main wizard state
  const [state, setState] = useState<OnboardingState>({
    step: 'welcome',
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    billingMethod: null,
    isExistingUser: (initialSetupNeeds?.needsBillingConfig && !initialSetupNeeds?.needsCraftAuth) ?? false,
  })

  // Save configuration
  const handleSaveConfig = useCallback(async (credential?: string) => {
    if (!state.billingMethod) {
      console.log('[Onboarding] No billing method, returning early')
      return
    }

    setState(s => ({ ...s, completionStatus: 'saving' }))

    try {
      const authType = billingMethodToAuthType(state.billingMethod)
      console.log('[Onboarding] Saving config with authType:', authType)

      const result = await window.electronAPI.saveOnboardingConfig({
        authType,
        credential,
      })

      if (result.success) {
        console.log('[Onboarding] Save successful')
        setState(s => ({ ...s, completionStatus: 'complete' }))
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
  }, [state.billingMethod])

  // Continue to next step
  const handleContinue = useCallback(async () => {
    switch (state.step) {
      case 'welcome':
        setState(s => ({ ...s, step: 'billing-method' }))
        break

      case 'billing-method':
        // Go to credentials step for API Key or Claude OAuth
        setState(s => ({ ...s, step: 'credentials' }))
        break

      case 'credentials':
        // Handled by handleSubmitCredential
        break

      case 'complete':
        onComplete()
        break
    }
  }, [state.step, state.billingMethod, onComplete])

  // Go back to previous step
  const handleBack = useCallback(() => {
    switch (state.step) {
      case 'billing-method':
        setState(s => ({ ...s, step: 'welcome' }))
        break
      case 'credentials':
        setState(s => ({ ...s, step: 'billing-method', credentialStatus: 'idle', errorMessage: undefined }))
        break
    }
  }, [state.step])

  // Select billing method
  const handleSelectBillingMethod = useCallback((method: BillingMethod) => {
    setState(s => ({ ...s, billingMethod: method }))
  }, [])

  // Submit credential (API key)
  const handleSubmitCredential = useCallback(async (credential: string) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      if (!credential.trim()) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'Please enter a valid API key',
        }))
        return
      }

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
  }, [handleSaveConfig])

  // Claude OAuth state
  const [existingClaudeToken, setExistingClaudeToken] = useState<string | null>(null)
  const [isClaudeCliInstalled, setIsClaudeCliInstalled] = useState(false)
  const [claudeOAuthChecked, setClaudeOAuthChecked] = useState(false)
  // Two-step OAuth flow state
  const [isWaitingForCode, setIsWaitingForCode] = useState(false)

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
        setExistingClaudeToken(result.token)
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
      step: 'welcome',
      loginStatus: 'idle',
      credentialStatus: 'idle',
      completionStatus: 'saving',
      billingMethod: null,
      isExistingUser: false,
      errorMessage: undefined,
    })
    setExistingClaudeToken(null)
    setIsClaudeCliInstalled(false)
    setClaudeOAuthChecked(false)
    setIsWaitingForCode(false)
  }, [])

  return {
    state,
    handleContinue,
    handleBack,
    handleSelectBillingMethod,
    handleSubmitCredential,
    handleStartOAuth,
    existingClaudeToken,
    isClaudeCliInstalled,
    handleUseExistingClaudeToken,
    // Two-step OAuth flow
    isWaitingForCode,
    handleSubmitAuthCode,
    handleCancelOAuth,
    handleFinish,
    handleCancel,
    reset,
  }
}
