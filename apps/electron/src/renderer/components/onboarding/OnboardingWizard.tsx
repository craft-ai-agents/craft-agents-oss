import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import type { ApiSetupMethod } from "./APISetupStep"
import { ProviderSelectStep, type ProviderChoice } from "./ProviderSelectStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import { LocalModelStep, type LocalModelSubmitData } from "./LocalModelStep"
import { CompletionStep } from "./CompletionStep"
import { GitBashWarning, type GitBashStatus } from "./GitBashWarning"
import type { ApiKeySubmitData } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export type OnboardingStep =
  | 'welcome'
  | 'git-bash'
  | 'provider-select'
  | 'local-model'
  | 'credentials'
  | 'complete'

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  apiSetupMethod: ApiSetupMethod | null
  isExistingUser: boolean
  errorMessage?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
  isCheckingGitBash?: boolean
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onSelectApiSetupMethod: (method: ApiSetupMethod) => void
  onSubmitCredential: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onFinish: () => void

  // Claude OAuth (two-step flow)
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void

  // Copilot device flow
  copilotDeviceCode?: { userCode: string; verificationUri: string }

  // Git Bash (Windows)
  onBrowseGitBash?: () => Promise<string | null>
  onUseGitBashPath?: (path: string) => void
  onRecheckGitBash?: () => void
  onClearError?: () => void

  // Provider select (new flow)
  onSelectProvider?: (choice: ProviderChoice) => void
  /** Called when user chooses "Setup later" on provider select */
  onSkipSetup?: () => void

  // Local model
  onSubmitLocalModel?: (data: LocalModelSubmitData) => void

  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    customApi?: CustomEndpointApi
  }

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up Craft Agent:
 * 1. Welcome
 * 2. Provider Select (Claude / ChatGPT / Copilot / API Key / Local)
 * 3. Credentials (API Key or OAuth) or Local Model
 * 4. Completion
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onSelectApiSetupMethod,
  onSubmitCredential,
  onStartOAuth,
  onFinish,
  // Two-step OAuth flow
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  // Copilot device flow
  copilotDeviceCode,
  // Git Bash (Windows)
  onBrowseGitBash,
  onUseGitBashPath,
  onRecheckGitBash,
  onClearError,
  // Provider select (new flow)
  onSelectProvider,
  onSkipSetup,
  // Local model
  onSubmitLocalModel,
  // Edit mode
  editInitialValues,
  className
}: OnboardingWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            isLoading={state.isCheckingGitBash}
          />
        )

      case 'git-bash':
        return (
          <GitBashWarning
            status={state.gitBashStatus!}
            onBrowse={onBrowseGitBash!}
            onUsePath={onUseGitBashPath!}
            onRecheck={onRecheckGitBash!}
            onBack={onBack}
            isRechecking={state.isRecheckingGitBash}
            errorMessage={state.errorMessage}
            onClearError={onClearError}
          />
        )

      case 'provider-select':
        return (
          <ProviderSelectStep
            onSelect={onSelectProvider!}
            onSkip={onSkipSetup}
          />
        )

      case 'local-model':
        return (
          <LocalModelStep
            onSubmit={onSubmitLocalModel!}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
          />
        )

      case 'credentials':
        return (
          <CredentialsStep
            apiSetupMethod={state.apiSetupMethod!}
            status={state.credentialStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitCredential}
            onStartOAuth={onStartOAuth}
            onBack={onBack}
            isWaitingForCode={isWaitingForCode}
            onSubmitAuthCode={onSubmitAuthCode}
            editInitialValues={editInitialValues}
            onCancelOAuth={onCancelOAuth}
            copilotDeviceCode={copilotDeviceCode}
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            onFinish={onFinish}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col bg-foreground-2",
        !className?.includes('h-full') && "min-h-screen",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content */}
      <main className="flex flex-1 items-center justify-center p-8">
        {renderStep()}
      </main>
    </div>
  )
}
