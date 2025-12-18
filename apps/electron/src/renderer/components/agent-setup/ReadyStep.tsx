import { CheckCircle2, Globe, Zap } from "lucide-react"
import { McpIcon } from "@/components/icons/McpIcon"
import { StepFormLayout, ContinueButton } from "@/components/onboarding/primitives"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { McpServerConfig } from "./McpAuthStep"
import type { ApiConfig } from "./ApiAuthStep"

interface ReadyStepProps {
  /** Name of the agent */
  agentName: string
  /** Agent capabilities */
  capabilities?: string[]
  /** Configured MCP servers */
  mcpServers?: McpServerConfig[]
  /** Configured APIs */
  apis?: ApiConfig[]
  /** Called to activate the agent */
  onActivate?: () => void
  /** Whether activation is in progress */
  isLoading?: boolean
}

/**
 * ReadyStep - Summary screen before agent activation
 *
 * Shows what the agent can do and what resources are connected.
 */
export function ReadyStep({
  agentName,
  capabilities = [],
  mcpServers = [],
  apis = [],
  onActivate,
  isLoading = false,
}: ReadyStepProps) {
  const hasResources = mcpServers.length > 0 || apis.length > 0

  return (
    <StepFormLayout
      grow
      title={`${agentName} is ready`}
      description="All authentication is complete. Start a chat to use the agent."
      actions={
        <ContinueButton
          onClick={onActivate}
          loading={isLoading}
          loadingText="Starting..."
        >
          <Zap className="mr-1.5 size-4" />
          Start Chat
        </ContinueButton>
      }
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 pr-4">
          {/* Capabilities */}
          {capabilities.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-foreground/[0.02] p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Capabilities
              </h3>
              <ul className="space-y-1.5">
                {capabilities.map((cap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground mt-1.5">•</span>
                    <span>{cap}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Connected resources */}
          {hasResources && (
            <div className="rounded-lg border border-border/50 bg-foreground/[0.02] p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Connected Resources
              </h3>
              <div className="space-y-2">
                {mcpServers.map((server) => (
                  <div
                    key={server.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <McpIcon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{server.name}</span>
                    <CheckCircle2 className="size-4 text-green-500" />
                  </div>
                ))}
                {apis.map((api) => (
                  <div
                    key={api.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Globe className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{api.name}</span>
                    <CheckCircle2 className="size-4 text-green-500" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No resources message */}
          {!hasResources && capabilities.length === 0 && (
            <div className="rounded-lg border border-border/50 bg-foreground/[0.02] p-4">
              <p className="text-sm text-muted-foreground text-center">
                This agent uses custom instructions with built-in tools.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </StepFormLayout>
  )
}
