import { useState, useCallback } from "react"
import { AgentSetupWizard, type AgentSetupState, type McpServerAuthStatus, type ApiAuthStatus } from "./AgentSetupWizard"
import type { Concern } from "./ReviewConcernsStep"
import type { McpServerConfig } from "./McpAuthStep"
import type { ApiConfig } from "./ApiAuthStep"

// Sample data for the demo - the most advanced case
const demoConcerns: Concern[] = [
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

const demoMcpServers: McpServerConfig[] = [
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
]

const demoApis: ApiConfig[] = [
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
]

const demoCapabilities = [
  'Generate clean, well-documented code from natural language descriptions',
  'Debug and fix issues with detailed explanations of root causes',
  'Refactor existing code for better performance and maintainability',
  'Create comprehensive documentation with examples and usage guides',
  'Review code changes and provide actionable feedback',
]

/**
 * AgentSetupDemo - Interactive demo of the full agent setup flow
 *
 * Simulates all steps with realistic data and state transitions.
 * Click through to see each step of the most advanced setup case.
 */
export function AgentSetupDemo() {
  const [state, setState] = useState<AgentSetupState>({
    step: 'extracting',
    agentId: 'demo-agent-123',
    agentName: 'Code Assistant',
    extractionMessage: 'Reading agent configuration...',
    concerns: demoConcerns,
    mcpServers: demoMcpServers,
    mcpServerStatus: {},
    apis: demoApis,
    apiStatus: {},
    capabilities: demoCapabilities,
  })

  // Simulate extraction completing after a delay
  const simulateExtraction = useCallback(() => {
    setState(s => ({ ...s, isLoading: true, extractionMessage: 'Parsing instructions...' }))

    setTimeout(() => {
      setState(s => ({ ...s, extractionMessage: 'Detecting integrations...' }))
    }, 500)

    setTimeout(() => {
      setState(s => ({ ...s, extractionMessage: 'Analyzing concerns...' }))
    }, 1000)

    setTimeout(() => {
      setState(s => ({ ...s, step: 'review', isLoading: false }))
    }, 1500)
  }, [])

  // Start the demo
  const handleStart = useCallback(() => {
    simulateExtraction()
  }, [simulateExtraction])

  // Cancel goes back to extracting (reset)
  const handleCancel = useCallback(() => {
    setState({
      step: 'extracting',
      agentId: 'demo-agent-123',
      agentName: 'Code Assistant',
      extractionMessage: 'Reading agent configuration...',
      concerns: demoConcerns,
      mcpServers: demoMcpServers,
      mcpServerStatus: {},
      apis: demoApis,
      apiStatus: {},
      capabilities: demoCapabilities,
    })
  }, [])

  // Submit review answers
  const handleSubmitReview = useCallback((answers: Record<number, string>) => {
    console.log('[Demo] Review answers:', answers)
    setState(s => ({ ...s, isLoading: true }))

    setTimeout(() => {
      setState(s => ({ ...s, step: 'mcp-auth', isLoading: false }))
    }, 500)
  }, [])

  // Start OAuth for MCP server
  const handleStartMcpOAuth = useCallback((serverName: string) => {
    console.log('[Demo] Starting OAuth for:', serverName)
    setState(s => ({
      ...s,
      mcpServerStatus: { ...s.mcpServerStatus, [serverName]: 'authenticating' as McpServerAuthStatus }
    }))

    // Simulate OAuth completing
    setTimeout(() => {
      setState(s => ({
        ...s,
        mcpServerStatus: { ...s.mcpServerStatus, [serverName]: 'authenticated' as McpServerAuthStatus }
      }))
    }, 1500)
  }, [])

  // Submit bearer token for MCP server
  const handleSubmitMcpBearer = useCallback((serverName: string, token: string) => {
    console.log('[Demo] Bearer token for:', serverName, token)
    setState(s => ({
      ...s,
      mcpServerStatus: { ...s.mcpServerStatus, [serverName]: 'authenticated' as McpServerAuthStatus }
    }))
  }, [])

  // Skip MCP server
  const handleSkipMcpServer = useCallback((serverName: string) => {
    console.log('[Demo] Skipping MCP:', serverName)
    setState(s => ({
      ...s,
      mcpServerStatus: { ...s.mcpServerStatus, [serverName]: 'skipped' as McpServerAuthStatus }
    }))
  }, [])

  // Complete MCP auth step
  const handleMcpAuthComplete = useCallback(() => {
    setState(s => ({ ...s, step: 'api-auth' }))
  }, [])

  // Submit API credentials
  const handleSubmitApiCredentials = useCallback((apiName: string, credentials: string | { username: string; password: string }) => {
    console.log('[Demo] API credentials for:', apiName, credentials)
    setState(s => ({
      ...s,
      apiStatus: { ...s.apiStatus, [apiName]: 'configured' as ApiAuthStatus }
    }))
  }, [])

  // Skip API
  const handleSkipApi = useCallback((apiName: string) => {
    console.log('[Demo] Skipping API:', apiName)
    setState(s => ({
      ...s,
      apiStatus: { ...s.apiStatus, [apiName]: 'skipped' as ApiAuthStatus }
    }))
  }, [])

  // Complete API auth step
  const handleApiAuthComplete = useCallback(() => {
    setState(s => ({ ...s, step: 'ready' }))
  }, [])

  // Go back from ready
  const handleBack = useCallback(() => {
    setState(s => ({ ...s, step: 'api-auth' }))
  }, [])

  // Activate agent
  const handleActivate = useCallback(() => {
    setState(s => ({ ...s, isLoading: true }))

    setTimeout(() => {
      setState(s => ({ ...s, step: 'active', isLoading: false }))
    }, 1000)
  }, [])

  // Retry after error
  const handleRetry = useCallback(() => {
    setState(s => ({ ...s, step: 'extracting', errorMessage: undefined }))
    simulateExtraction()
  }, [simulateExtraction])

  // Start chat (just logs in demo)
  const handleStartChat = useCallback(() => {
    console.log('[Demo] Starting chat with agent')
    alert('Demo complete! In the real app, this would open a chat with the agent.')
  }, [])

  // Close (reset demo)
  const handleClose = useCallback(() => {
    handleCancel()
  }, [handleCancel])

  // Simulate error (for testing)
  const handleSimulateError = useCallback(() => {
    setState(s => ({
      ...s,
      step: 'error',
      errorMessage: 'Failed to connect to MCP server. Please check your network connection and try again.',
    }))
  }, [])

  return (
    <div className="relative h-full">
      {/* Demo controls overlay */}
      {state.step === 'extracting' && !state.isLoading && (
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <button
            onClick={handleStart}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Start Demo
          </button>
          <button
            onClick={handleSimulateError}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            Simulate Error
          </button>
        </div>
      )}

      {/* Debug info */}
      <div className="absolute bottom-4 left-4 z-10 text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded">
        Step: <span className="font-mono text-foreground">{state.step}</span>
        {state.isLoading && <span className="ml-2 text-amber-500">(loading)</span>}
      </div>

      {/* The actual wizard */}
      <AgentSetupWizard
        state={state}
        onCancel={handleCancel}
        onBack={handleBack}
        onSubmitReview={handleSubmitReview}
        onStartMcpOAuth={handleStartMcpOAuth}
        onSubmitMcpBearer={handleSubmitMcpBearer}
        onSkipMcpServer={handleSkipMcpServer}
        onMcpAuthComplete={handleMcpAuthComplete}
        onSubmitApiCredentials={handleSubmitApiCredentials}
        onSkipApi={handleSkipApi}
        onApiAuthComplete={handleApiAuthComplete}
        onActivate={handleActivate}
        onRetry={handleRetry}
        onStartChat={handleStartChat}
        onClose={handleClose}
      />
    </div>
  )
}
