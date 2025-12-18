import { CheckCircle2, Server, Globe, Sparkles, Zap } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "@/components/onboarding/primitives"
import { Badge } from "@/components/ui/badge"
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
  /** Called to go back */
  onBack?: () => void
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
  onBack,
  isLoading = false,
}: ReadyStepProps) {
  const hasResources = mcpServers.length > 0 || apis.length > 0

  return (
    <StepFormLayout
      icon={<Sparkles />}
      iconVariant="success"
      title={`${agentName} is ready`}
      description="All authentication is complete. Activate the agent to start using it."
      actions={
        <>
          <BackButton onClick={onBack}>Back</BackButton>
          <ContinueButton
            onClick={onActivate}
            loading={isLoading}
            loadingText="Activating..."
          >
            <Zap className="mr-1.5 size-4" />
            Activate Agent
          </ContinueButton>
        </>
      }
    >
      <ScrollArea className="h-[280px]">
        <div className="space-y-4 pr-4">
          {/* Capabilities */}
          {capabilities.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-foreground/[0.02] p-4">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Capabilities
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {capabilities.map((cap, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {cap}
                  </Badge>
                ))}
              </div>
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
                    <Server className="size-4 text-muted-foreground" />
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
