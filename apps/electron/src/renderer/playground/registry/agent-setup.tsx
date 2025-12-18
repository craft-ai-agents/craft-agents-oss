import type { ComponentEntry } from './types'
import { ExtractingStep } from '@/components/agent-setup/ExtractingStep'
import { ReviewConcernsStep, type Concern } from '@/components/agent-setup/ReviewConcernsStep'
import { McpAuthStep, type McpServerConfig, type McpServerAuthStatus } from '@/components/agent-setup/McpAuthStep'
import { ApiAuthStep, type ApiConfig, type ApiAuthStatus } from '@/components/agent-setup/ApiAuthStep'
import { ReadyStep } from '@/components/agent-setup/ReadyStep'
import { ActiveStep } from '@/components/agent-setup/ActiveStep'
import { ErrorStep } from '@/components/agent-setup/ErrorStep'
import { AgentSetupWizard, type AgentSetupState } from '@/components/agent-setup/AgentSetupWizard'
import { AgentSetupStepIndicator } from '@/components/agent-setup/AgentSetupStepIndicator'
import { AgentSetupDemo } from '@/components/agent-setup/AgentSetupDemo'

// Sample data for testing
const sampleConcerns: Concern[] = [
  {
    type: 'confusing',
    description: 'The instructions mention "project files" but don\'t specify which file types.',
    context: 'When working with project files, always check for conflicts first.',
    suggestedQuestion: 'What file types should the agent focus on?',
    suggestedAnswers: ['All files', 'Only code files (.ts, .js, .py)', 'Documentation only (.md, .txt)'],
  },
  {
    type: 'conflicting',
    description: 'The agent is told to both "always ask before making changes" and "work autonomously".',
    suggestedQuestion: 'How should the agent handle making changes?',
    suggestedAnswers: ['Always ask first', 'Ask for major changes only', 'Work autonomously'],
  },
  {
    type: 'missing',
    description: 'No preferred coding style or formatting rules are specified.',
    suggestedQuestion: 'What coding style should the agent follow?',
  },
]

const sampleMcpServers: McpServerConfig[] = [
  {
    name: 'GitHub',
    url: 'https://mcp.github.com/v1',
    requiresAuth: true,
    description: 'Access repositories and manage issues',
  },
  {
    name: 'Notion',
    url: 'https://api.notion.com/mcp',
    requiresAuth: true,
    description: 'Read and write Notion pages',
  },
  {
    name: 'Public Docs',
    url: 'https://docs.example.com/mcp',
    requiresAuth: false,
    description: 'Read-only documentation access',
  },
]

const sampleApis: ApiConfig[] = [
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    auth: {
      type: 'bearer',
      credentialLabel: 'OpenAI API Key',
    },
    description: 'For embeddings and completions',
  },
  {
    name: 'Stripe',
    baseUrl: 'https://api.stripe.com',
    auth: {
      type: 'header',
      headerName: 'Authorization',
      credentialLabel: 'Stripe Secret Key',
    },
    description: 'Payment processing',
  },
  {
    name: 'Internal API',
    baseUrl: 'https://internal.company.com/api',
    auth: {
      type: 'basic',
      credentialLabel: 'Service Account',
      secretLabel: 'Service Password',
    },
  },
]

const noopHandler = () => console.log('[Playground] Action triggered')

const createAgentSetupState = (overrides: Partial<AgentSetupState> = {}): AgentSetupState => ({
  step: 'extracting',
  agentId: 'sample-agent-123',
  agentName: 'Code Assistant',
  ...overrides,
})

export const agentSetupComponents: ComponentEntry[] = [
  // Step Indicator
  {
    id: 'agent-setup-step-indicator',
    name: 'AgentSetupStepIndicator',
    category: 'Agent Setup',
    description: 'Progress dots showing current step in agent setup flow',
    component: AgentSetupStepIndicator,
    props: [
      {
        name: 'currentStep',
        description: 'Current step in the flow',
        control: {
          type: 'select',
          options: [
            { label: 'Extracting', value: 'extracting' },
            { label: 'Review', value: 'review' },
            { label: 'MCP Auth', value: 'mcp-auth' },
            { label: 'API Auth', value: 'api-auth' },
            { label: 'Ready', value: 'ready' },
            { label: 'Active', value: 'active' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'extracting',
      },
      {
        name: 'hasConcerns',
        description: 'Show review step',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'hasMcpServers',
        description: 'Show MCP auth step',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'hasApis',
        description: 'Show API auth step',
        control: { type: 'boolean' },
        defaultValue: true,
      },
    ],
    variants: [
      { name: 'All Steps - Extracting', props: { currentStep: 'extracting', hasConcerns: true, hasMcpServers: true, hasApis: true } },
      { name: 'All Steps - Review', props: { currentStep: 'review', hasConcerns: true, hasMcpServers: true, hasApis: true } },
      { name: 'All Steps - MCP Auth', props: { currentStep: 'mcp-auth', hasConcerns: true, hasMcpServers: true, hasApis: true } },
      { name: 'All Steps - API Auth', props: { currentStep: 'api-auth', hasConcerns: true, hasMcpServers: true, hasApis: true } },
      { name: 'All Steps - Ready', props: { currentStep: 'ready', hasConcerns: true, hasMcpServers: true, hasApis: true } },
      { name: 'Minimal - Only Extract + Ready', props: { currentStep: 'extracting', hasConcerns: false, hasMcpServers: false, hasApis: false } },
      { name: 'No Review', props: { currentStep: 'mcp-auth', hasConcerns: false, hasMcpServers: true, hasApis: true } },
    ],
  },

  // Extracting Step
  {
    id: 'extracting-step',
    name: 'ExtractingStep',
    category: 'Agent Setup',
    description: 'Loading screen while parsing agent from Craft document',
    component: ExtractingStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent being extracted',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'message',
        description: 'Current extraction status message',
        control: { type: 'string', placeholder: 'Status message' },
        defaultValue: 'Reading agent configuration...',
      },
    ],
    variants: [
      { name: 'Default', props: { agentName: 'Code Assistant', message: 'Reading agent configuration...' } },
      { name: 'Parsing Instructions', props: { agentName: 'Writer', message: 'Parsing instructions...' } },
      { name: 'Loading MCP Config', props: { agentName: 'Data Analyst', message: 'Loading MCP server configuration...' } },
      { name: 'Detecting APIs', props: { agentName: 'API Helper', message: 'Detecting REST API integrations...' } },
    ],
    mockData: () => ({
      onCancel: noopHandler,
    }),
  },

  // Review Concerns Step
  {
    id: 'review-concerns-step',
    name: 'ReviewConcernsStep',
    category: 'Agent Setup',
    description: 'User reviews and answers concerns from agent extraction',
    component: ReviewConcernsStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'isLoading',
        description: 'Show loading state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Multiple Concerns', props: { agentName: 'Code Assistant', concerns: sampleConcerns } },
      { name: 'Single Concern', props: { agentName: 'Writer', concerns: [sampleConcerns[0]] } },
      { name: 'No Suggested Answers', props: { agentName: 'Custom Agent', concerns: [sampleConcerns[2]] } },
      { name: 'Loading', props: { agentName: 'Code Assistant', concerns: sampleConcerns, isLoading: true } },
    ],
    mockData: () => ({
      concerns: sampleConcerns,
      onContinue: (answers: Record<number, string>) => console.log('[Playground] Submitted answers:', answers),
      onCancel: noopHandler,
    }),
  },

  // MCP Auth Step
  {
    id: 'mcp-auth-step',
    name: 'McpAuthStep',
    category: 'Agent Setup',
    description: 'Authentication flow for MCP servers',
    component: McpAuthStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'isLoading',
        description: 'Show loading state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'All Pending',
        props: {
          agentName: 'Code Assistant',
          servers: sampleMcpServers.filter(s => s.requiresAuth),
          serverStatus: {},
        },
      },
      {
        name: 'One Authenticating',
        props: {
          agentName: 'Code Assistant',
          servers: sampleMcpServers.filter(s => s.requiresAuth),
          serverStatus: { 'GitHub': 'authenticating' } as Record<string, McpServerAuthStatus>,
        },
      },
      {
        name: 'Mixed Status',
        props: {
          agentName: 'Code Assistant',
          servers: sampleMcpServers.filter(s => s.requiresAuth),
          serverStatus: { 'GitHub': 'authenticated', 'Notion': 'pending' } as Record<string, McpServerAuthStatus>,
        },
      },
      {
        name: 'All Done',
        props: {
          agentName: 'Code Assistant',
          servers: sampleMcpServers.filter(s => s.requiresAuth),
          serverStatus: { 'GitHub': 'authenticated', 'Notion': 'skipped' } as Record<string, McpServerAuthStatus>,
        },
      },
      {
        name: 'Single Server',
        props: {
          agentName: 'Writer',
          servers: [sampleMcpServers[0]],
          serverStatus: {},
        },
      },
    ],
    mockData: () => ({
      servers: sampleMcpServers.filter(s => s.requiresAuth),
      serverStatus: {},
      onStartOAuth: (name: string) => console.log('[Playground] Start OAuth:', name),
      onSubmitBearer: (name: string, token: string) => console.log('[Playground] Bearer token:', name, token),
      onSkip: (name: string) => console.log('[Playground] Skip server:', name),
      onContinue: noopHandler,
      onCancel: noopHandler,
    }),
  },

  // API Auth Step
  {
    id: 'api-auth-step',
    name: 'ApiAuthStep',
    category: 'Agent Setup',
    description: 'Credential input for REST APIs',
    component: ApiAuthStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'isLoading',
        description: 'Show loading state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'All Pending',
        props: {
          agentName: 'Code Assistant',
          apis: sampleApis,
          apiStatus: {},
        },
      },
      {
        name: 'Mixed Status',
        props: {
          agentName: 'Code Assistant',
          apis: sampleApis,
          apiStatus: { 'OpenAI': 'configured', 'Stripe': 'pending' } as Record<string, ApiAuthStatus>,
        },
      },
      {
        name: 'All Configured',
        props: {
          agentName: 'Code Assistant',
          apis: sampleApis,
          apiStatus: { 'OpenAI': 'configured', 'Stripe': 'configured', 'Internal API': 'skipped' } as Record<string, ApiAuthStatus>,
        },
      },
      {
        name: 'Basic Auth Only',
        props: {
          agentName: 'Internal Agent',
          apis: [sampleApis[2]],
          apiStatus: {},
        },
      },
      {
        name: 'Bearer Token Only',
        props: {
          agentName: 'AI Helper',
          apis: [sampleApis[0]],
          apiStatus: {},
        },
      },
    ],
    mockData: () => ({
      apis: sampleApis,
      apiStatus: {},
      onSubmitCredentials: (name: string, creds: unknown) => console.log('[Playground] Credentials:', name, creds),
      onSkip: (name: string) => console.log('[Playground] Skip API:', name),
      onContinue: noopHandler,
      onCancel: noopHandler,
    }),
  },

  // Ready Step
  {
    id: 'ready-step',
    name: 'ReadyStep',
    category: 'Agent Setup',
    description: 'Summary screen before agent activation',
    component: ReadyStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'isLoading',
        description: 'Show activation loading state',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      {
        name: 'Full Resources',
        props: {
          agentName: 'Code Assistant',
          capabilities: ['Code generation', 'Bug fixing', 'Refactoring', 'Documentation'],
          mcpServers: sampleMcpServers.slice(0, 2),
          apis: sampleApis.slice(0, 2),
        },
      },
      {
        name: 'MCP Only',
        props: {
          agentName: 'Document Agent',
          capabilities: ['Read documents', 'Summarize', 'Search'],
          mcpServers: sampleMcpServers.slice(0, 1),
          apis: [],
        },
      },
      {
        name: 'APIs Only',
        props: {
          agentName: 'API Helper',
          capabilities: ['API calls', 'Data transformation'],
          mcpServers: [],
          apis: sampleApis.slice(0, 2),
        },
      },
      {
        name: 'No Resources',
        props: {
          agentName: 'Simple Assistant',
          capabilities: [],
          mcpServers: [],
          apis: [],
        },
      },
      {
        name: 'Activating',
        props: {
          agentName: 'Code Assistant',
          capabilities: ['Code generation'],
          mcpServers: sampleMcpServers.slice(0, 1),
          apis: [],
          isLoading: true,
        },
      },
    ],
    mockData: () => ({
      capabilities: ['Code generation', 'Bug fixing', 'Refactoring', 'Documentation'],
      mcpServers: sampleMcpServers.slice(0, 2),
      apis: sampleApis.slice(0, 2),
      onActivate: noopHandler,
      onBack: noopHandler,
    }),
  },

  // Active Step
  {
    id: 'active-step',
    name: 'ActiveStep',
    category: 'Agent Setup',
    description: 'Success screen after agent activation',
    component: ActiveStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
    ],
    variants: [
      { name: 'Default', props: { agentName: 'Code Assistant' } },
      { name: 'Short Name', props: { agentName: 'Writer' } },
      { name: 'Long Name', props: { agentName: 'Enterprise Code Review Assistant' } },
    ],
    mockData: () => ({
      onStartChat: noopHandler,
      onClose: noopHandler,
    }),
  },

  // Error Step
  {
    id: 'error-step',
    name: 'ErrorStep',
    category: 'Agent Setup',
    description: 'Error screen when something goes wrong',
    component: ErrorStep,
    props: [
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'Code Assistant',
      },
      {
        name: 'errorMessage',
        description: 'Error message to display',
        control: { type: 'textarea', placeholder: 'Error message', rows: 3 },
        defaultValue: 'Failed to connect to MCP server. Please check your network connection and try again.',
      },
    ],
    variants: [
      {
        name: 'Network Error',
        props: {
          agentName: 'Code Assistant',
          errorMessage: 'Failed to connect to MCP server. Please check your network connection and try again.',
        },
      },
      {
        name: 'Auth Error',
        props: {
          agentName: 'Document Agent',
          errorMessage: 'Authentication failed. Your credentials may have expired.',
        },
      },
      {
        name: 'Parse Error',
        props: {
          agentName: 'Custom Agent',
          errorMessage: 'Could not parse agent configuration. The document may be malformed.',
        },
      },
      {
        name: 'Long Error',
        props: {
          agentName: 'API Helper',
          errorMessage: 'Multiple errors occurred during setup: (1) GitHub MCP server returned 401 Unauthorized, (2) OpenAI API key validation failed with "invalid_api_key", (3) Internal API endpoint is unreachable.',
        },
      },
    ],
    mockData: () => ({
      onRetry: noopHandler,
      onCancel: noopHandler,
    }),
  },

  // Full Wizard
  {
    id: 'agent-setup-wizard',
    name: 'AgentSetupWizard',
    category: 'Agent Setup',
    description: 'Full agent setup flow container with all steps',
    component: AgentSetupWizard,
    layout: 'top',
    props: [],
    variants: [
      {
        name: 'Extracting',
        props: {
          state: createAgentSetupState({
            step: 'extracting',
            agentName: 'Code Assistant',
            extractionMessage: 'Reading agent configuration...',
          }),
        },
      },
      {
        name: 'Review Concerns',
        props: {
          state: createAgentSetupState({
            step: 'review',
            agentName: 'Code Assistant',
            concerns: sampleConcerns,
          }),
        },
      },
      {
        name: 'MCP Auth',
        props: {
          state: createAgentSetupState({
            step: 'mcp-auth',
            agentName: 'Code Assistant',
            concerns: sampleConcerns,
            mcpServers: sampleMcpServers,
            mcpServerStatus: { 'GitHub': 'authenticated' },
          }),
        },
      },
      {
        name: 'API Auth',
        props: {
          state: createAgentSetupState({
            step: 'api-auth',
            agentName: 'Code Assistant',
            concerns: sampleConcerns,
            mcpServers: sampleMcpServers,
            apis: sampleApis,
            apiStatus: { 'OpenAI': 'configured' },
          }),
        },
      },
      {
        name: 'Ready',
        props: {
          state: createAgentSetupState({
            step: 'ready',
            agentName: 'Code Assistant',
            capabilities: ['Code generation', 'Bug fixing', 'Refactoring'],
            mcpServers: sampleMcpServers.slice(0, 2),
            apis: sampleApis.slice(0, 2),
          }),
        },
      },
      {
        name: 'Active',
        props: {
          state: createAgentSetupState({
            step: 'active',
            agentName: 'Code Assistant',
          }),
        },
      },
      {
        name: 'Error',
        props: {
          state: createAgentSetupState({
            step: 'error',
            agentName: 'Code Assistant',
            errorMessage: 'Failed to connect to MCP server. Please check your network connection.',
          }),
        },
      },
      {
        name: 'Minimal Flow (No Auth)',
        props: {
          state: createAgentSetupState({
            step: 'ready',
            agentName: 'Simple Agent',
            capabilities: ['Text generation'],
            mcpServers: [],
            apis: [],
          }),
        },
      },
    ],
    mockData: () => ({
      state: createAgentSetupState(),
      onCancel: noopHandler,
      onBack: noopHandler,
      onSubmitReview: (answers: Record<number, string>) => console.log('[Playground] Review answers:', answers),
      onStartMcpOAuth: (name: string) => console.log('[Playground] Start MCP OAuth:', name),
      onSubmitMcpBearer: (name: string, token: string) => console.log('[Playground] MCP Bearer:', name, token),
      onSkipMcpServer: (name: string) => console.log('[Playground] Skip MCP:', name),
      onMcpAuthComplete: noopHandler,
      onSubmitApiCredentials: (name: string, creds: unknown) => console.log('[Playground] API creds:', name, creds),
      onSkipApi: (name: string) => console.log('[Playground] Skip API:', name),
      onApiAuthComplete: noopHandler,
      onActivate: noopHandler,
      onRetry: noopHandler,
      onStartChat: noopHandler,
      onClose: noopHandler,
    }),
  },

  // Interactive Demo
  {
    id: 'agent-setup-demo',
    name: 'AgentSetupDemo',
    category: 'Agent Setup',
    description: 'Interactive demo - click through the full agent setup flow',
    component: AgentSetupDemo,
    layout: 'top',
    props: [],
    variants: [
      { name: 'Interactive Demo', props: {} },
    ],
  },
]
