import { cn } from "@/lib/utils"
import { ExtractingStep } from "./ExtractingStep"
import { ReviewConcernsStep, type Concern } from "./ReviewConcernsStep"
import { McpAuthStep, type McpServerConfig, type McpServerAuthStatus } from "./McpAuthStep"
import { ApiAuthStep, type ApiConfig, type ApiAuthStatus } from "./ApiAuthStep"
import { ReadyStep } from "./ReadyStep"
import { ActiveStep } from "./ActiveStep"
import { ErrorStep } from "./ErrorStep"

export type AgentSetupStep =
  | 'extracting'
  | 'review'
  | 'mcp-auth'
  | 'api-auth'
  | 'ready'
  | 'active'
  | 'error'

// Re-export types for convenience
export type { Concern, McpServerConfig, McpServerAuthStatus, ApiConfig, ApiAuthStatus }

export interface AgentSetupState {
  /** Current step in the flow */
  step: AgentSetupStep
  /** Agent ID */
  agentId: string
  /** Agent display name */
  agentName: string
  /** Extraction status message */
  extractionMessage?: string
  /** Concerns that need review */
  concerns?: Concern[]
  /** MCP servers that need auth */
  mcpServers?: McpServerConfig[]
  /** Auth status per MCP server */
  mcpServerStatus?: Record<string, McpServerAuthStatus>
  /** APIs that need credentials */
  apis?: ApiConfig[]
  /** Auth status per API */
  apiStatus?: Record<string, ApiAuthStatus>
  /** Agent capabilities */
  capabilities?: string[]
  /** Error message if step is 'error' */
  errorMessage?: string
  /** Whether an operation is in progress */
  isLoading?: boolean
}

interface AgentSetupWizardProps {
  /** Current state of the setup flow */
  state: AgentSetupState
  /** Called when user cancels the flow */
  onCancel?: () => void
  /** Called when user goes back a step */
  onBack?: () => void
  /** Called when user submits concern answers */
  onSubmitReview?: (answers: Record<number, string>) => void
  /** Called to start OAuth for an MCP server */
  onStartMcpOAuth?: (serverName: string) => void
  /** Called when user enters bearer token for an MCP server */
  onSubmitMcpBearer?: (serverName: string, token: string) => void
  /** Called to skip an MCP server */
  onSkipMcpServer?: (serverName: string) => void
  /** Called when MCP auth is done */
  onMcpAuthComplete?: () => void
  /** Called when user submits API credentials */
  onSubmitApiCredentials?: (apiName: string, credentials: string | { username: string; password: string }) => void
  /** Called to skip an API */
  onSkipApi?: (apiName: string) => void
  /** Called when API auth is done */
  onApiAuthComplete?: () => void
  /** Called to activate the agent */
  onActivate?: () => void
  /** Called to retry after error */
  onRetry?: () => void
  /** Called to start chat after activation */
  onStartChat?: () => void
  /** Called to close after activation */
  onClose?: () => void
  className?: string
}

/**
 * AgentSetupWizard - Full-screen wizard for agent setup
 *
 * Renders the appropriate step component based on state.step.
 */
export function AgentSetupWizard({
  state,
  onCancel,
  onBack,
  onSubmitReview,
  onStartMcpOAuth,
  onSubmitMcpBearer,
  onSkipMcpServer,
  onMcpAuthComplete,
  onSubmitApiCredentials,
  onSkipApi,
  onApiAuthComplete,
  onActivate,
  onRetry,
  onStartChat,
  onClose,
  className,
}: AgentSetupWizardProps) {
  const {
    step,
    agentName,
    extractionMessage,
    concerns = [],
    mcpServers = [],
    mcpServerStatus = {},
    apis = [],
    apiStatus = {},
    capabilities = [],
    errorMessage = '',
    isLoading = false,
  } = state

  const renderStep = () => {
    switch (step) {
      case 'extracting':
        return (
          <ExtractingStep
            agentName={agentName}
            message={extractionMessage}
            onCancel={onCancel}
          />
        )

      case 'review':
        return (
          <ReviewConcernsStep
            agentName={agentName}
            concerns={concerns}
            onContinue={onSubmitReview}
            onCancel={onCancel}
            isLoading={isLoading}
          />
        )

      case 'mcp-auth':
        return (
          <McpAuthStep
            agentName={agentName}
            servers={mcpServers.filter(s => s.requiresAuth)}
            serverStatus={mcpServerStatus}
            onStartOAuth={onStartMcpOAuth}
            onSubmitBearer={onSubmitMcpBearer}
            onSkip={onSkipMcpServer}
            onContinue={onMcpAuthComplete}
            onCancel={onCancel}
            isLoading={isLoading}
          />
        )

      case 'api-auth':
        return (
          <ApiAuthStep
            agentName={agentName}
            apis={apis.filter(a => a.auth?.type !== 'none')}
            apiStatus={apiStatus}
            onSubmitCredentials={onSubmitApiCredentials}
            onSkip={onSkipApi}
            onContinue={onApiAuthComplete}
            onCancel={onCancel}
            isLoading={isLoading}
          />
        )

      case 'ready':
        return (
          <ReadyStep
            agentName={agentName}
            capabilities={capabilities}
            mcpServers={mcpServers}
            apis={apis}
            onActivate={onActivate}
            isLoading={isLoading}
          />
        )

      case 'active':
        return (
          <ActiveStep
            agentName={agentName}
            onStartChat={onStartChat}
            onClose={onClose}
          />
        )

      case 'error':
        return (
          <ErrorStep
            agentName={agentName}
            errorMessage={errorMessage}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        )

      default:
        return null
    }
  }

  return (
    <div className={cn("flex h-full flex-col items-center justify-center p-8", className)}>
      {renderStep()}
    </div>
  )
}
