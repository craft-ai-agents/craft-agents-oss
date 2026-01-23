import type { ComponentEntry } from './types'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { APISetupStep } from '@/components/onboarding/APISetupStep'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { CompletionStep } from '@/components/onboarding/CompletionStep'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import type { OnboardingState } from '@/components/onboarding/OnboardingWizard'

const createOnboardingState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  step: 'welcome',
  loginStatus: 'idle',
  credentialStatus: 'idle',
  completionStatus: 'complete',
  apiSetupMethod: null,
  isExistingUser: false,
  ...overrides,
})

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
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
    ],
    variants: [
      { name: 'New User', props: { isExistingUser: false } },
      { name: 'Existing User', props: { isExistingUser: true } },
    ],
    mockData: () => ({
      onContinue: noopHandler,
    }),
  },
  {
    id: 'api-setup-step',
    name: 'APISetupStep',
    category: 'Onboarding',
    description: 'Choose payment method for AI usage',
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
            { label: 'API Key', value: 'api_key' },
          ],
        },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'No Selection', props: { selectedMethod: null } },
      { name: 'Claude OAuth Selected', props: { selectedMethod: 'claude_oauth' } },
      { name: 'API Key Selected', props: { selectedMethod: 'api_key' } },
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
      { name: 'Idle', props: { apiSetupMethod: 'api_key', status: 'idle' } },
      { name: 'Validating', props: { apiSetupMethod: 'api_key', status: 'validating' } },
      { name: 'Success', props: { apiSetupMethod: 'api_key', status: 'success' } },
      { name: 'Error', props: { apiSetupMethod: 'api_key', status: 'error', errorMessage: 'Invalid API key. Please check and try again.' } },
    ],
    mockData: () => ({
      apiSetupMethod: 'api_key',
      onSubmit: (data: { apiKey: string; baseUrl?: string; customModel?: string }) => console.log('[Playground] Submitted:', data),
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
      { name: 'Idle (Existing Token)', props: { apiSetupMethod: 'claude_oauth', status: 'idle', existingClaudeToken: 'sk-ant-abc123def456ghi789...' } },
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
        name: 'API Setup',
        props: {
          state: createOnboardingState({ step: 'api-setup' }),
        },
      },
      {
        name: 'API Setup (Selected)',
        props: {
          state: createOnboardingState({ step: 'api-setup', apiSetupMethod: 'claude_oauth' }),
        },
      },
      {
        name: 'Credentials - API Key',
        props: {
          state: createOnboardingState({ step: 'credentials', apiSetupMethod: 'api_key' }),
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
      onSubmitCredential: (data: { apiKey: string; baseUrl?: string; customModel?: string }) => console.log('[Playground] Submitted:', data),
      onStartOAuth: noopHandler,
      onFinish: noopHandler,
    }),
  },
]
