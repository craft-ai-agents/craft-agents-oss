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
import type { SetupNeeds, GitBashStatus, LlmConnectionSetup } from '../../shared/types'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
  /** Start the wizard at a specific step (default: 'welcome') */
  initialStep?: OnboardingStep
  /** Pre-select an API setup method (useful when editing an existing connection) */
  initialApiSetupMethod?: ApiSetupMethod
  /** Called when user goes back from the initial step (dismisses the wizard) */
  onDismiss?: () => void
  /** Called immediately after config is saved to disk (before wizard closes).
   *  Use this to propagate billing/model changes to the UI without waiting for onComplete. */
  onConfigSaved?: () => void
  /** Slug of existing connection being edited (null = creating new) */
  editingSlug?: string | null
  /** Set of slugs already in use (for generating unique slugs when creating new) */
  existingSlugs?: Set<string>
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
  handleStartOAuth: (methodOverride?: ApiSetupMethod) => void

  // Claude OAuth (two-step flow)
  isWaitingForCode: boolean
  handleSubmitAuthCode: (code: string) => void
  handleCancelOAuth: () => void

  // Copilot device code (displayed during device flow)
  copilotDeviceCode?: { userCode: string; verificationUri: string }

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

// Base slug for each setup method (used as template key in ipc.ts)
const BASE_SLUG_FOR_METHOD: Record<ApiSetupMethod, string> = {
  anthropic_api_key: 'anthropic-api',
  claude_oauth: 'claude-max',
  chatgpt_oauth: 'codex',
  openai_api_key: 'codex-api',
  copilot_oauth: 'copilot',
  pi_chatgpt_oauth: 'pi-codex',
  pi_copilot_oauth: 'pi-copilot',
  pi_google_api_key: 'pi-google',
}

/**
 * Generate a unique slug for a new connection.
 * If the base slug is taken, appends -2, -3, etc.
 * When editingSlug is provided, reuses that slug (editing existing connection).
 */
function resolveSlugForMethod(
  method: ApiSetupMethod,
  editingSlug: string | null,
  existingSlugs: Set<string>,
): string {
  // Editing an existing connection — reuse its slug
  if (editingSlug) return editingSlug

  const base = BASE_SLUG_FOR_METHOD[method]
  if (!existingSlugs.has(base)) return base

  let i = 2
  while (existingSlugs.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

// Map ApiSetupMethod to LlmConnectionSetup for the new unified connection system
function apiSetupMethodToConnectionSetup(
  method: ApiSetupMethod,
  options: { credential?: string; baseUrl?: string; connectionDefaultModel?: string; models?: string[] },
  editingSlug: string | null,
  existingSlugs: Set<string>,
): LlmConnectionSetup {
  const slug = resolveSlugForMethod(method, editingSlug, existingSlugs)

  switch (method) {
    case 'anthropic_api_key':
      return {
        slug,
        credential: options.credential,
        baseUrl: options.baseUrl,
        defaultModel: options.connectionDefaultModel,
        models: options.models,
      }
    case 'claude_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'chatgpt_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'openai_api_key':
      return {
        slug,
        credential: options.credential,
        baseUrl: options.baseUrl,
        defaultModel: options.connectionDefaultModel,
        models: options.models,
      }
    case 'copilot_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'pi_chatgpt_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'pi_copilot_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'pi_google_api_key':
      return {
        slug,
        credential: options.credential,
      }
  }
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
  initialStep = 'welcome',
  initialApiSetupMethod,
  onDismiss,
  onConfigSaved,
  editingSlug = null,
  existingSlugs = new Set(),
}: UseOnboardingOptions): UseOnboardingReturn {
  // Main wizard state
  const [state, setState] = useState<OnboardingState>({
    step: initialStep,
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    apiSetupMethod: initialApiSetupMethod ?? null,
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

  // Save configuration using the new unified LLM connection API
  const handleSaveConfig = useCallback(async (credential?: string, options?: { baseUrl?: string; connectionDefaultModel?: string; models?: string[] }) => {
    if (!state.apiSetupMethod) {
      return
    }

    setState(s => ({ ...s, completionStatus: 'saving' }))

    try {
      // Build connection setup from UI state
      const setup = apiSetupMethodToConnectionSetup(state.apiSetupMethod, {
        credential,
        baseUrl: options?.baseUrl,
        connectionDefaultModel: options?.connectionDefaultModel,
        models: options?.models,
      }, editingSlug, existingSlugs)
      // Use new unified API
      const result = await window.electronAPI.setupLlmConnection(setup)

      if (result.success) {
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
  }, [state.apiSetupMethod, onConfigSaved, editingSlug, existingSlugs])

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
  // Tests the connection first before saving to catch issues early
  const handleSubmitCredential = useCallback(async (data: ApiKeySubmitData) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    const isOpenAiFlow = state.apiSetupMethod === 'openai_api_key'
    const isPiGoogleFlow = state.apiSetupMethod === 'pi_google_api_key'

    try {
      // API key validation differs by provider:
      // - OpenAI flow: API key is always required
      // - Pi flow: API key is always required
      // - Anthropic flow: API key required for hosted providers, optional for Ollama/local
      if (isOpenAiFlow) {
        if (!data.apiKey.trim()) {
          setState(s => ({
            ...s,
            credentialStatus: 'error',
            errorMessage: 'Please enter a valid OpenAI API key',
          }))
          return
        }
      } else if (isPiGoogleFlow) {
        if (!data.apiKey.trim()) {
          setState(s => ({
            ...s,
            credentialStatus: 'error',
            errorMessage: 'Please enter a valid Google AI Studio API key',
          }))
          return
        }
      } else {
        // Anthropic flow - key optional for custom endpoints (Ollama, local models)
        if (!data.apiKey.trim() && !data.baseUrl) {
          setState(s => ({
            ...s,
            credentialStatus: 'error',
            errorMessage: 'Please enter a valid API key',
          }))
          return
        }
      }

      // Validate connection before saving using provider-specific validation
      let testResult: { success: boolean; error?: string }

      if (isOpenAiFlow) {
        // OpenAI validation - tests against /v1/models endpoint
        testResult = await window.electronAPI.testOpenAiConnection(
          data.apiKey,
          data.baseUrl,
          data.models,
        )
      } else if (isPiGoogleFlow) {
        // Pi/Google validation - skip connection test for now, just save the key
        testResult = { success: true }
      } else {
        // Anthropic validation - tests auth, endpoint, model, and tool support
        testResult = await window.electronAPI.testApiConnection(
          data.apiKey,
          data.baseUrl,
          data.models,
        )
      }

      if (!testResult.success) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: testResult.error || 'Connection test failed',
        }))
        return
      }

      await handleSaveConfig(data.apiKey, {
        baseUrl: data.baseUrl,
        connectionDefaultModel: data.connectionDefaultModel,
        models: data.models,
      })

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
  }, [handleSaveConfig, state.apiSetupMethod])

  // Two-step OAuth flow state
  const [isWaitingForCode, setIsWaitingForCode] = useState(false)

  // Copilot device code (displayed during device flow)
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<{ userCode: string; verificationUri: string } | undefined>()

  // Start OAuth flow (Claude or ChatGPT depending on selected method)
  const handleStartOAuth = useCallback(async (methodOverride?: ApiSetupMethod) => {
    const effectiveMethod = methodOverride ?? state.apiSetupMethod

    if (methodOverride && methodOverride !== state.apiSetupMethod) {
      setState(s => ({
        ...s,
        apiSetupMethod: methodOverride,
        step: 'credentials',
        credentialStatus: 'validating',
        errorMessage: undefined,
      }))
    } else {
      setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))
    }

    if (!effectiveMethod) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: 'Select an authentication method first.',
      }))
      return
    }

    try {
      // ChatGPT OAuth (single-step flow - opens browser, captures tokens automatically)
      // Also handles Pi + ChatGPT Plus variant
      if (effectiveMethod === 'chatgpt_oauth' || effectiveMethod === 'pi_chatgpt_oauth') {
        const connectionSlug = apiSetupMethodToConnectionSetup(effectiveMethod, {}, editingSlug, existingSlugs).slug
        const result = await window.electronAPI.startChatGptOAuth(connectionSlug)

        if (result.success) {
          // Tokens captured automatically, save config and complete
          await handleSaveConfig(undefined)
          setState(s => ({
            ...s,
            credentialStatus: 'success',
            step: 'complete',
          }))
        } else {
          setState(s => ({
            ...s,
            credentialStatus: 'error',
            errorMessage: result.error || 'ChatGPT authentication failed',
          }))
        }
        return
      }

      // Copilot OAuth (device flow — polls for token after user enters code on GitHub)
      // Also handles Pi + GitHub Copilot variant
      if (effectiveMethod === 'copilot_oauth' || effectiveMethod === 'pi_copilot_oauth') {
        const connectionSlug = apiSetupMethodToConnectionSetup(effectiveMethod, {}, editingSlug, existingSlugs).slug

        // Subscribe to device code event before starting the flow
        const cleanup = window.electronAPI.onCopilotDeviceCode((data) => {
          setCopilotDeviceCode(data)
        })

        try {
          const result = await window.electronAPI.startCopilotOAuth(connectionSlug)

          if (result.success) {
            // Tokens captured, save config and complete
            await handleSaveConfig(undefined)
            setState(s => ({
              ...s,
              credentialStatus: 'success',
              step: 'complete',
            }))
          } else {
            setState(s => ({
              ...s,
              credentialStatus: 'error',
              errorMessage: result.error || 'GitHub authentication failed',
            }))
          }
        } finally {
          cleanup()
          setCopilotDeviceCode(undefined)
        }
        return
      }

      // Claude OAuth (two-step flow - opens browser, user copies code)
      // Also handles Pi + Claude Max variant
      if (effectiveMethod !== 'claude_oauth') {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: 'This connection uses API keys, not OAuth.',
        }))
        return
      }

      const result = await window.electronAPI.startClaudeOAuth()

      if (result.success) {
        // Browser opened successfully, now waiting for user to copy the code
        setIsWaitingForCode(true)
        setState(s => ({ ...s, credentialStatus: 'idle' }))
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
  }, [state.apiSetupMethod, handleSaveConfig, editingSlug, existingSlugs])

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
      const connectionSlug = apiSetupMethodToConnectionSetup('claude_oauth', {}, editingSlug, existingSlugs).slug
      const result = await window.electronAPI.exchangeClaudeCode(code.trim(), connectionSlug)

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
  }, [handleSaveConfig, editingSlug, existingSlugs])

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

  // Reset onboarding to initial state (used after logout or modal close)
  const reset = useCallback(() => {
    setState({
      step: initialStep,
      loginStatus: 'idle',
      credentialStatus: 'idle',
      completionStatus: 'saving',
      apiSetupMethod: initialApiSetupMethod ?? null,
      isExistingUser: false,
      errorMessage: undefined,
    })
    setIsWaitingForCode(false)
    // Clean up any pending OAuth state
    window.electronAPI.clearClaudeOAuthState().catch(() => {
      // Ignore errors - state may not exist
    })
  }, [initialStep, initialApiSetupMethod])

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
    // Copilot device code
    copilotDeviceCode,
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
