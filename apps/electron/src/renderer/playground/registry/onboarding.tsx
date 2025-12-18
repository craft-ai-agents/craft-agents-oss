import type { ComponentEntry } from './types'
import { StepIndicator } from '@/components/onboarding/StepIndicator'
import { WelcomeStep } from '@/components/onboarding/WelcomeStep'
import { CraftLoginStep } from '@/components/onboarding/CraftLoginStep'
import { SpaceSelectionStep } from '@/components/onboarding/SpaceSelectionStep'
import { BillingMethodStep } from '@/components/onboarding/BillingMethodStep'
import { CredentialsStep } from '@/components/onboarding/CredentialsStep'
import { CompletionStep } from '@/components/onboarding/CompletionStep'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import type { SpaceCategory } from '@/components/onboarding/SpaceSelectionStep'
import type { OnboardingState } from '@/components/onboarding/OnboardingWizard'

// Sample data for testing
const sampleSpaceCategories: SpaceCategory[] = [
  {
    name: 'Recommended',
    spaces: [
      { id: 'personal-1', name: 'Personal Space', type: 'personal' },
    ],
  },
  {
    name: 'Your Spaces',
    spaces: [
      { id: 'team-1', name: 'Engineering Team', type: 'team' },
      { id: 'team-2', name: 'Design Team', type: 'team' },
      { id: 'team-3', name: 'Marketing', type: 'team' },
    ],
  },
  {
    name: 'Other Spaces',
    spaces: [
      { id: 'shared-1', name: 'Company Wiki', type: 'shared' },
      { id: 'shared-2', name: 'Project Docs', type: 'shared' },
    ],
  },
]

const createOnboardingState = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  step: 'welcome',
  loginStatus: 'idle',
  credentialStatus: 'idle',
  completionStatus: 'complete',
  selectedSpaceId: null,
  selectedSpaceName: null,
  billingMethod: null,
  isExistingUser: false,
  ...overrides,
})

const noopHandler = () => console.log('[Playground] Action triggered')

export const onboardingComponents: ComponentEntry[] = [
  {
    id: 'step-indicator',
    name: 'StepIndicator',
    category: 'Onboarding',
    description: 'Progress dots showing current step in the onboarding flow',
    component: StepIndicator,
    props: [
      {
        name: 'currentStep',
        description: 'Current step in the flow',
        control: {
          type: 'select',
          options: [
            { label: 'Welcome', value: 'welcome' },
            { label: 'Craft Login', value: 'craft-login' },
            { label: 'Select Space', value: 'select-space' },
            { label: 'Billing Method', value: 'billing-method' },
            { label: 'Credentials', value: 'credentials' },
            { label: 'Complete', value: 'complete' },
          ],
        },
        defaultValue: 'welcome',
      },
      {
        name: 'isExistingUser',
        description: 'Show fewer steps for existing users',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'New User - Welcome', props: { currentStep: 'welcome', isExistingUser: false } },
      { name: 'New User - Login', props: { currentStep: 'craft-login', isExistingUser: false } },
      { name: 'New User - Select Space', props: { currentStep: 'select-space', isExistingUser: false } },
      { name: 'New User - Billing', props: { currentStep: 'billing-method', isExistingUser: false } },
      { name: 'New User - Credentials', props: { currentStep: 'credentials', isExistingUser: false } },
      { name: 'New User - Complete', props: { currentStep: 'complete', isExistingUser: false } },
      { name: 'Existing User - Welcome', props: { currentStep: 'welcome', isExistingUser: true } },
      { name: 'Existing User - Billing', props: { currentStep: 'billing-method', isExistingUser: true } },
      { name: 'Existing User - Complete', props: { currentStep: 'complete', isExistingUser: true } },
    ],
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
    ],
    variants: [
      { name: 'New User', props: { isExistingUser: false } },
      { name: 'Existing User', props: { isExistingUser: true } },
    ],
    mockData: () => ({
      onContinue: noopHandler,
      onCancel: noopHandler,
    }),
  },
  {
    id: 'craft-login-step',
    name: 'CraftLoginStep',
    category: 'Onboarding',
    description: 'OAuth login flow with Craft account',
    component: CraftLoginStep,
    props: [
      {
        name: 'status',
        description: 'Current login status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Waiting', value: 'waiting' },
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
      { name: 'Idle', props: { status: 'idle' } },
      { name: 'Waiting', props: { status: 'waiting' } },
      { name: 'Success', props: { status: 'success' } },
      { name: 'Error', props: { status: 'error', errorMessage: 'Your subscription has expired. Please renew to continue.' } },
    ],
    mockData: () => ({
      onLogin: noopHandler,
      onOpenManually: noopHandler,
      onBack: noopHandler,
      onRetry: noopHandler,
    }),
  },
  {
    id: 'space-selection-step',
    name: 'SpaceSelectionStep',
    category: 'Onboarding',
    description: 'Select which Craft space to connect',
    component: SpaceSelectionStep,
    props: [
      {
        name: 'selectedSpaceId',
        description: 'Currently selected space ID',
        control: {
          type: 'select',
          options: [
            { label: 'None', value: '' },
            { label: 'Personal Space', value: 'personal-1' },
            { label: 'Engineering Team', value: 'team-1' },
            { label: 'Design Team', value: 'team-2' },
          ],
        },
        defaultValue: '',
      },
      {
        name: 'isLoading',
        description: 'Show loading spinner',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Empty Selection', props: { selectedSpaceId: null, isLoading: false } },
      { name: 'With Selection', props: { selectedSpaceId: 'team-1', isLoading: false } },
      { name: 'Loading', props: { selectedSpaceId: null, isLoading: true } },
    ],
    mockData: () => ({
      categories: sampleSpaceCategories,
      onSelect: (id: string) => console.log('[Playground] Selected space:', id),
      onContinue: noopHandler,
      onBack: noopHandler,
    }),
  },
  {
    id: 'billing-method-step',
    name: 'BillingMethodStep',
    category: 'Onboarding',
    description: 'Choose payment method for AI usage',
    component: BillingMethodStep,
    props: [
      {
        name: 'selectedMethod',
        description: 'Currently selected billing method',
        control: {
          type: 'select',
          options: [
            { label: 'None', value: '' },
            { label: 'Craft Credits', value: 'craft_credits' },
            { label: 'API Key', value: 'api_key' },
            { label: 'Claude OAuth', value: 'claude_oauth' },
          ],
        },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'No Selection', props: { selectedMethod: null } },
      { name: 'Craft Credits Selected', props: { selectedMethod: 'craft_credits' } },
      { name: 'API Key Selected', props: { selectedMethod: 'api_key' } },
      { name: 'Claude OAuth Selected', props: { selectedMethod: 'claude_oauth' } },
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
    description: 'Enter Anthropic API key for authentication',
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
      { name: 'Idle', props: { billingMethod: 'api_key', status: 'idle' } },
      { name: 'Validating', props: { billingMethod: 'api_key', status: 'validating' } },
      { name: 'Success', props: { billingMethod: 'api_key', status: 'success' } },
      { name: 'Error', props: { billingMethod: 'api_key', status: 'error', errorMessage: 'Invalid API key. Please check and try again.' } },
    ],
    mockData: () => ({
      billingMethod: 'api_key',
      onSubmit: (cred: string) => console.log('[Playground] Submitted credential:', cred),
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
            { label: 'Waiting', value: 'validating' },
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
      { name: 'Idle', props: { billingMethod: 'claude_oauth', status: 'idle' } },
      { name: 'Waiting', props: { billingMethod: 'claude_oauth', status: 'validating' } },
      { name: 'Success', props: { billingMethod: 'claude_oauth', status: 'success' } },
      { name: 'Error', props: { billingMethod: 'claude_oauth', status: 'error', errorMessage: 'Authentication failed. Please try again.' } },
    ],
    mockData: () => ({
      billingMethod: 'claude_oauth',
      onSubmit: (cred: string) => console.log('[Playground] Submitted credential:', cred),
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
      {
        name: 'spaceName',
        description: 'Name of the connected space',
        control: { type: 'string', placeholder: 'Space name' },
        defaultValue: 'Engineering Team',
      },
    ],
    variants: [
      { name: 'Saving', props: { status: 'saving' } },
      { name: 'Complete', props: { status: 'complete', spaceName: 'Engineering Team' } },
      { name: 'Complete (No Space Name)', props: { status: 'complete', spaceName: '' } },
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
    props: [
      {
        name: 'isLoadingSpaces',
        description: 'Show loading state for spaces',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
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
        name: 'Craft Login - Idle',
        props: {
          state: createOnboardingState({ step: 'craft-login', loginStatus: 'idle' }),
        },
      },
      {
        name: 'Craft Login - Waiting',
        props: {
          state: createOnboardingState({ step: 'craft-login', loginStatus: 'waiting' }),
        },
      },
      {
        name: 'Space Selection',
        props: {
          state: createOnboardingState({ step: 'select-space' }),
        },
      },
      {
        name: 'Space Selection (With Selection)',
        props: {
          state: createOnboardingState({
            step: 'select-space',
            selectedSpaceId: 'team-1',
            selectedSpaceName: 'Engineering Team',
          }),
        },
      },
      {
        name: 'Billing Method',
        props: {
          state: createOnboardingState({ step: 'billing-method' }),
        },
      },
      {
        name: 'Billing Method (Selected)',
        props: {
          state: createOnboardingState({ step: 'billing-method', billingMethod: 'craft_credits' }),
        },
      },
      {
        name: 'Credentials - API Key',
        props: {
          state: createOnboardingState({ step: 'credentials', billingMethod: 'api_key' }),
        },
      },
      {
        name: 'Credentials - OAuth',
        props: {
          state: createOnboardingState({ step: 'credentials', billingMethod: 'claude_oauth' }),
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
            selectedSpaceName: 'Engineering Team',
          }),
        },
      },
    ],
    mockData: () => ({
      state: createOnboardingState(),
      spaceCategories: sampleSpaceCategories,
      className: 'min-h-0 h-full',
      onCancel: noopHandler,
      onContinue: noopHandler,
      onBack: noopHandler,
      onLogin: noopHandler,
      onOpenLoginManually: noopHandler,
      onRetryLogin: noopHandler,
      onSelectSpace: (id: string) => console.log('[Playground] Selected space:', id),
      onSelectBillingMethod: (method: string) => console.log('[Playground] Selected billing:', method),
      onSubmitCredential: (cred: string) => console.log('[Playground] Submitted:', cred),
      onStartOAuth: noopHandler,
      onFinish: noopHandler,
    }),
  },
]
