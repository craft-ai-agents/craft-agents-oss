import { useState } from "react"
import { Server, ExternalLink, Key, CheckCircle2, Clock, SkipForward } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "@/components/onboarding/primitives"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/loading-indicator"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface McpServerConfig {
  name: string
  url: string
  requiresAuth?: boolean
  description?: string
}

export type McpServerAuthStatus = 'pending' | 'authenticating' | 'authenticated' | 'skipped' | 'bearer-input'

interface McpAuthStepProps {
  /** Name of the agent */
  agentName: string
  /** MCP servers that need authentication */
  servers: McpServerConfig[]
  /** Current auth status for each server (by name) */
  serverStatus?: Record<string, McpServerAuthStatus>
  /** Index of server currently being authenticated */
  currentServerIndex?: number
  /** Called to start OAuth for a server */
  onStartOAuth?: (serverName: string) => void
  /** Called when user enters bearer token */
  onSubmitBearer?: (serverName: string, token: string) => void
  /** Called to skip a server */
  onSkip?: (serverName: string) => void
  /** Called when all servers are done */
  onContinue?: () => void
  /** Called to cancel */
  onCancel?: () => void
  /** Whether any operation is in progress */
  isLoading?: boolean
}

/**
 * McpAuthStep - Authentication flow for MCP servers
 *
 * Shows list of MCP servers that need authentication.
 * User can authenticate via OAuth or enter bearer token as fallback.
 */
export function McpAuthStep({
  agentName,
  servers,
  serverStatus = {},
  currentServerIndex = 0,
  onStartOAuth,
  onSubmitBearer,
  onSkip,
  onContinue,
  onCancel,
  isLoading = false,
}: McpAuthStepProps) {
  const [bearerTokens, setBearerTokens] = useState<Record<string, string>>({})
  const [showBearerInput, setShowBearerInput] = useState<Record<string, boolean>>({})

  const allDone = servers.every(
    (s) => serverStatus[s.name] === 'authenticated' || serverStatus[s.name] === 'skipped'
  )

  const handleOAuth = (serverName: string) => {
    onStartOAuth?.(serverName)
  }

  const handleBearerSubmit = (serverName: string) => {
    const token = bearerTokens[serverName]
    if (token?.trim()) {
      onSubmitBearer?.(serverName, token.trim())
    }
  }

  const toggleBearerInput = (serverName: string) => {
    setShowBearerInput(prev => ({ ...prev, [serverName]: !prev[serverName] }))
  }

  const getStatusBadge = (status: McpServerAuthStatus | undefined) => {
    switch (status) {
      case 'authenticated':
        return (
          <Badge variant="outline" className="text-green-600 border-green-600/30 bg-green-500/10">
            <CheckCircle2 className="mr-1 size-3" />
            Connected
          </Badge>
        )
      case 'skipped':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <SkipForward className="mr-1 size-3" />
            Skipped
          </Badge>
        )
      case 'authenticating':
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-600/30 bg-amber-500/10">
            <Spinner className="mr-1 text-xs" />
            Authenticating...
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <Clock className="mr-1 size-3" />
            Pending
          </Badge>
        )
    }
  }

  return (
    <StepFormLayout
      icon={<Server />}
      iconVariant="primary"
      title="Connect MCP servers"
      description={`${agentName} uses ${servers.length} external server${servers.length === 1 ? '' : 's'} that ${servers.length === 1 ? 'needs' : 'need'} authentication.`}
      actions={
        <>
          <BackButton onClick={onCancel}>Cancel</BackButton>
          <ContinueButton
            onClick={onContinue}
            disabled={!allDone}
            loading={isLoading}
          >
            Continue
          </ContinueButton>
        </>
      }
    >
      <ScrollArea className="h-[320px]">
        <div className="space-y-3 pr-4">
          {servers.map((server, index) => {
          const status = serverStatus[server.name]
          const isDone = status === 'authenticated' || status === 'skipped'
          const isAuthenticating = status === 'authenticating'
          const showBearer = showBearerInput[server.name] || status === 'bearer-input'

          return (
            <div
              key={server.name}
              className={cn(
                "rounded-lg border p-4 transition-colors",
                isDone
                  ? "border-border/30 bg-foreground/[0.01]"
                  : "border-border/50 bg-foreground/[0.02]"
              )}
            >
              {/* Server header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Server className="size-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{server.name}</span>
                    {getStatusBadge(status)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground truncate">
                    {server.url}
                  </p>
                  {server.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {server.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Auth actions (only show if not done) */}
              {!isDone && !isAuthenticating && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  {!showBearer ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleOAuth(server.name)}
                        className="gap-2"
                      >
                        <ExternalLink className="size-3.5" />
                        Sign in
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleBearerInput(server.name)}
                        className="text-muted-foreground"
                      >
                        <Key className="mr-1.5 size-3.5" />
                        Use token
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSkip?.(server.name)}
                        className="ml-auto text-muted-foreground"
                      >
                        Skip
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor={`bearer-${server.name}`} className="text-xs">
                        Bearer Token
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id={`bearer-${server.name}`}
                          type="password"
                          placeholder="Enter bearer token..."
                          value={bearerTokens[server.name] || ''}
                          onChange={(e) =>
                            setBearerTokens(prev => ({ ...prev, [server.name]: e.target.value }))
                          }
                          className="flex-1 text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => handleBearerSubmit(server.name)}
                          disabled={!bearerTokens[server.name]?.trim()}
                        >
                          Save
                        </Button>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleBearerInput(server.name)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Use OAuth instead
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Authenticating state */}
              {isAuthenticating && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Spinner className="text-xs" />
                    Waiting for authentication in browser...
                  </p>
                </div>
              )}
            </div>
          )
          })}
        </div>
      </ScrollArea>
    </StepFormLayout>
  )
}
