import type { ComponentEntry } from './types'
import { OnboardingFlowDemo } from '../demos/OnboardingFlowDemo'
import { ProviderSelectStep } from '@/components/onboarding/ProviderSelectStep'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { APISetupStep } from '@/components/onboarding/APISetupStep'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { CompletionStep } from '@/components/onboarding/CompletionStep'
import { GitBashWarning, type GitBashStatus } from '@/components/onboarding/GitBashWarning'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import type { OnboardingState } from '@/components/onboarding/OnboardingWizard'

const createOnboardingState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  step: 'welcome',
  loginStatus: 'idle',
  credentialStatus: 'idle',
  completionStatus: 'complete',
  apiSetupMethod: null,
  isExistingUser: false,
  gitBashStatus: { found: false, path: null, platform: 'win32' },
  isRecheckingGitBash: false,
  isCheckingGitBash: false,
  ...overrides,
})

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
  {
    id: 'onboarding-flow-demo',
    name: 'Onboarding Flow (Interactive)',
    category: 'Onboarding',
    description: 'Click through the full onboarding: Welcome → Provider → Credentials → Done',
    component: OnboardingFlowDemo,
    props: [],
    variants: [],
    layout: 'full',
  },
  {
    id: 'provider-select-step',
    name: 'ProviderSelectStep',
    category: 'Onboarding',
    description: 'First-launch screen — pick your subscription or API key',
    component: ProviderSelectStep,
    props: [],
    variants: [],
    mockData: () => ({
      onSelect: (choice: string) => console.log('[Playground] Provider selected:', choice),
      onSkip: () => console.log('[Playground] Setup deferred'),
    }),
  },
  {
    id: 'welcome-step',
    name: 'WelcomeStep',
    category: 'Onboarding',
    description: 'Initial welcome screen with feature overview',
    component: WelcomeStep,
    props: [
      {
        name: 'isExistingUser',
        description: 'Show update settings message instead of welcome',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isLoading',
        description: 'Show loading state on continue button',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'New User', props: { isExistingUser: false } },
      { name: 'Existing User', props: { isExistingUser: true } },
      { name: 'Loading', props: { isLoading: true } },
    ],
    mockData: () => ({
      onContinue: noopHandler,
    }),
  },
  {
    id: 'api-setup-step',
    name: 'APISetupStep',
    category: 'Onboarding',
    description: 'Choose payment method for AI usage with provider segmented control',
    component: APISetupStep,
    props: [
      {
        name: 'selectedMethod',
        description: 'Currently selected API setup method',
        control: {
          type: 'select',
          options: [
            { label: 'None', value: '' },
            { label: 'Claude OAuth', value: 'claude_oauth' },
            { label: 'Anthropic API Key', value: 'anthropic_api_key' },
            { label: 'CAB ChatGPT OAuth', value: 'pi_chatgpt_oauth' },
            { label: 'CAB Copilot OAuth', value: 'pi_copilot_oauth' },
            { label: 'CAB API Key', value: 'pi_api_key' },
          ],
        },
        defaultValue: '',
      },
      {
        name: 'initialSegment',
        description: 'Initial provider segment to show',
        control: {
          type: 'select',
          options: [
            { label: 'Anthropic', value: 'anthropic' },
            { label: 'OpenAI', value: 'openai' },
            { label: 'GitHub Copilot', value: 'copilot' },
          ],
        },
        defaultValue: 'anthropic',
      },
    ],
    variants: [
      { name: 'Anthropic Segment', props: { selectedMethod: null, initialSegment: 'anthropic' } },
      { name: 'Anthropic - Claude OAuth Selected', props: { selectedMethod: 'claude_oauth', initialSegment: 'anthropic' } },
      { name: 'Anthropic - API Key Selected', props: { selectedMethod: 'anthropic_api_key', initialSegment: 'anthropic' } },
      { name: 'CAB Segment', props: { selectedMethod: null, initialSegment: 'pi' } },
      { name: 'CAB - ChatGPT OAuth Selected', props: { selectedMethod: 'pi_chatgpt_oauth', initialSegment: 'pi' } },
      { name: 'CAB - Copilot OAuth Selected', props: { selectedMethod: 'pi_copilot_oauth', initialSegment: 'pi' } },
      { name: 'CAB - API Key Selected', props: { selectedMethod: 'pi_api_key', initialSegment: 'pi' } },
    ],
    mockData: () => ({
      onSelect: (method: string) => console.log('[Playground] Selected method:', method),
      onContinue: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'credentials-step-api-key',
    name: 'Credentials - API Key',
    category: 'Onboarding',
    description: 'API key + optional Base URL and Model for compatible APIs',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'Credential validation status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Idle', props: { apiSetupMethod: 'pi_api_key', status: 'idle' } },
      { name: 'Validating', props: { apiSetupMethod: 'pi_api_key', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'pi_api_key', status: 'success' } },
      { name: 'Error', props: { apiSetupMethod: 'pi_api_key', status: 'error', errorMessage: 'Invalid API key. Please check and try again.' } },
    ],
    mockData: () => ({
      apiSetupMethod: 'pi_api_key',
      onSubmit: (data: { apiKey: string; baseUrl?: string; connectionDefaultModel?: string; models?: string[] }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'credentials-step-oauth',
    name: 'Credentials - OAuth',
    category: 'Onboarding',
    description: 'Claude Max/Pro OAuth authentication flow',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'OAuth status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'isWaitingForCode',
        description: 'Show auth code entry form',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Idle', props: { apiSetupMethod: 'claude_oauth', status: 'idle' } },
      { name: 'Waiting for Code', props: { apiSetupMethod: 'claude_oauth', status: 'idle', isWaitingForCode: true } },
      { name: 'Waiting for Code - Validating', props: { apiSetupMethod: 'claude_oauth', status: 'validating', isWaitingForCode: true } },
      { name: 'Waiting for Code - Error', props: { apiSetupMethod: 'claude_oauth', status: 'error', isWaitingForCode: true, errorMessage: 'Invalid authorization code.' } },
      { name: 'Validating', props: { apiSetupMethod: 'claude_oauth', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'claude_oauth', status: 'success' } },
      { name: 'Error', props: { apiSetupMethod: 'claude_oauth', status: 'error', errorMessage: 'Authentication failed. Please try again.' } },
    ],
    mockData: () => ({
      apiSetupMethod: 'claude_oauth',
      onSubmit: (data: { apiKey: string }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onBack: noopHandler,
      onSubmitAuthCode: (code: string) => console.log('[Playground] Auth code:', code),
      onCancelOAuth: noopHandler,
    }),
  },
  {
    id: 'credentials-step-copilot',
    name: 'Credentials - Copilot',
    category: 'Onboarding',
    description: 'GitHub Copilot OAuth device flow authentication',
    component: CredentialsStep,
    props: [
      {
        name: 'status',
        description: 'OAuth status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Initial', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'idle' } },
      {
        name: 'Device Code Shown',
        props: {
          apiSetupMethod: 'pi_copilot_oauth',
          status: 'validating',
          copilotDeviceCode: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' },
        },
      },
      { name: 'Validating', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'pi_copilot_oauth', status: 'success' } },
      {
        name: 'Error',
        props: {
          apiSetupMethod: 'pi_copilot_oauth',
          status: 'error',
          errorMessage: 'Authorization failed. Please try again.',
        },
      },
    ],
    mockData: () => ({
      apiSetupMethod: 'pi_copilot_oauth',
      onSubmit: noopHandler,
      onStartOAuth: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'completion-step',
    name: 'CompletionStep',
    category: 'Onboarding',
    description: 'Success screen after completing onboarding',
    component: CompletionStep,
    props: [
      {
        name: 'status',
        description: 'Completion status',
        control: {
          type: 'select',
          options: [
            { label: 'Saving', value: 'saving' },
            { label: 'Complete', value: 'complete' },
          ],
        },
        defaultValue: 'complete',
      },
    ],
    variants: [
      { name: 'Saving', props: { status: 'saving' } },
      { name: 'Complete', props: { status: 'complete' } },
    ],
    mockData: () => ({
      onFinish: noopHandler,
    }),
  },
  {
    id: 'git-bash-warning',
    name: 'GitBashWarning',
    category: 'Onboarding',
    description: 'Warning screen when Git Bash is not found on Windows',
    component: GitBashWarning,
    props: [
      {
        name: 'isRechecking',
        description: 'Show loading state on re-check button',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Not Found',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
        },
      },
      {
        name: 'Rechecking',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
          isRechecking: true,
        },
      },
      {
        name: 'With Suggested Path',
        props: {
          status: { found: false, path: 'C:\\Program Files\\Git\\bin\\bash.exe', platform: 'win32' } as GitBashStatus,
        },
      },
      {
        name: 'With Error',
        props: {
          status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
          errorMessage: 'File does not exist at the specified path',
        },
      },
    ],
    mockData: () => ({
      status: { found: false, path: null, platform: 'win32' } as GitBashStatus,
      onBrowse: async () => {
        console.log('[Playground] Browse clicked')
        return 'C:\\Program Files\\Git\\bin\\bash.exe'
      },
      onUsePath: (path: string) => console.log('[Playground] Use path:', path),
      onRecheck: noopHandler,
      onBack: noopHandler,
      onClearError: noopHandler,
    }),
  },
  {
    id: 'onboarding-wizard',
    name: 'OnboardingWizard',
    category: 'Onboarding',
    description: 'Full-screen onboarding flow container with all steps',
    component: OnboardingWizard,
    props: [],
    variants: [
      {
        name: 'Welcome (New User)',
        props: {
          state: createOnboardingState({ step: 'welcome', isExistingUser: false }),
        },
      },
      {
        name: 'Welcome (Existing User)',
        props: {
          state: createOnboardingState({ step: 'welcome', isExistingUser: true }),
        },
      },
      {
        name: 'Git Bash Warning',
        props: {
          state: createOnboardingState({ step: 'git-bash' }),
        },
      },
      {
        name: 'Git Bash Warning (Rechecking)',
        props: {
          state: createOnboardingState({ step: 'git-bash', isRecheckingGitBash: true }),
        },
      },
      {
        name: 'Credentials - API Key',
        props: {
          state: createOnboardingState({ step: 'credentials', apiSetupMethod: 'anthropic_api_key' }),
        },
      },
      {
        name: 'Credentials - OAuth',
        props: {
          state: createOnboardingState({ step: 'credentials', apiSetupMethod: 'claude_oauth' }),
        },
      },
      {
        name: 'Complete - Saving',
        props: {
          state: createOnboardingState({ step: 'complete', completionStatus: 'saving' }),
        },
      },
      {
        name: 'Complete - Done',
        props: {
          state: createOnboardingState({
            step: 'complete',
            completionStatus: 'complete',
          }),
        },
      },
    ],
    mockData: () => ({
      state: createOnboardingState(),
      className: 'min-h-0 h-full',
      onContinue: noopHandler,
      onBack: noopHandler,
      onSelectApiSetupMethod: (method: string) => console.log('[Playground] Selected method:', method),
      onSubmitCredential: (data: { apiKey: string; baseUrl?: string; connectionDefaultModel?: string; models?: string[] }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onFinish: noopHandler,
      onBrowseGitBash: async () => {
        console.log('[Playground] Browse Git Bash clicked')
        return 'C:\\Program Files\\Git\\bin\\bash.exe'
      },
      onUseGitBashPath: (path: string) => console.log('[Playground] Use Git Bash path:', path),
      onRecheckGitBash: noopHandler,
      onClearError: noopHandler,
      onSkipSetup: () => console.log('[Playground] Setup deferred'),
    }),
  },
]
