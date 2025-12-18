import { useState } from "react"
import { KeyRound, CheckCircle2, Clock, SkipForward, Globe } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "@/components/onboarding/primitives"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

export type ApiAuthType = 'none' | 'header' | 'bearer' | 'query' | 'basic'

export interface ApiConfig {
  name: string
  baseUrl: string
  auth?: {
    type: ApiAuthType
    headerName?: string
    queryParam?: string
    authScheme?: string
    credentialLabel?: string
    secretLabel?: string
  }
  description?: string
}

export type ApiAuthStatus = 'pending' | 'configured' | 'skipped'

interface ApiAuthStepProps {
  /** Name of the agent */
  agentName: string
  /** APIs that need credentials */
  apis: ApiConfig[]
  /** Current auth status for each API (by name) */
  apiStatus?: Record<string, ApiAuthStatus>
  /** Called when user submits credentials */
  onSubmitCredentials?: (apiName: string, credentials: string | { username: string; password: string }) => void
  /** Called to skip an API */
  onSkip?: (apiName: string) => void
  /** Called when all APIs are done */
  onContinue?: () => void
  /** Called to cancel */
  onCancel?: () => void
  /** Whether any operation is in progress */
  isLoading?: boolean
}

/**
 * ApiAuthStep - Credential input for REST APIs
 *
 * Shows list of APIs that need credentials.
 * Supports API keys, bearer tokens, and basic auth.
 */
export function ApiAuthStep({
  agentName,
  apis,
  apiStatus = {},
  onSubmitCredentials,
  onSkip,
  onContinue,
  onCancel,
  isLoading = false,
}: ApiAuthStepProps) {
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [basicAuth, setBasicAuth] = useState<Record<string, { username: string; password: string }>>({})

  const allDone = apis.every(
    (a) => apiStatus[a.name] === 'configured' || apiStatus[a.name] === 'skipped'
  )

  const handleSubmit = (api: ApiConfig) => {
    if (api.auth?.type === 'basic') {
      const auth = basicAuth[api.name]
      if (auth?.username && auth?.password) {
        onSubmitCredentials?.(api.name, auth)
      }
    } else {
      const cred = credentials[api.name]
      if (cred?.trim()) {
        onSubmitCredentials?.(api.name, cred.trim())
      }
    }
  }

  const getStatusBadge = (status: ApiAuthStatus | undefined) => {
    switch (status) {
      case 'configured':
        return (
          <Badge variant="outline" className="text-green-600 border-green-600/30 bg-green-500/10">
            <CheckCircle2 className="mr-1 size-3" />
            Configured
          </Badge>
        )
      case 'skipped':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            <SkipForward className="mr-1 size-3" />
            Skipped
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

  const getCredentialLabel = (api: ApiConfig): string => {
    if (api.auth?.credentialLabel) return api.auth.credentialLabel
    switch (api.auth?.type) {
      case 'bearer':
        return 'Bearer Token'
      case 'header':
        return api.auth.headerName || 'API Key'
      case 'query':
        return api.auth.queryParam || 'API Key'
      case 'basic':
        return 'Username'
      default:
        return 'API Key'
    }
  }

  return (
    <StepFormLayout
      icon={<KeyRound />}
      iconVariant="primary"
      title="Configure API credentials"
      description={`${agentName} uses ${apis.length} API${apis.length === 1 ? '' : 's'} that ${apis.length === 1 ? 'requires' : 'require'} credentials.`}
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
          {apis.map((api) => {
          const status = apiStatus[api.name]
          const isDone = status === 'configured' || status === 'skipped'
          const isBasic = api.auth?.type === 'basic'

          return (
            <div
              key={api.name}
              className={cn(
                "rounded-lg border p-4 transition-colors",
                isDone
                  ? "border-border/30 bg-foreground/[0.01]"
                  : "border-border/50 bg-foreground/[0.02]"
              )}
            >
              {/* API header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{api.name}</span>
                    {getStatusBadge(status)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground truncate">
                    {api.baseUrl}
                  </p>
                  {api.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {api.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Credential input (only show if not done) */}
              {!isDone && (
                <div className="mt-3 pt-3 border-t border-border/30 space-y-3">
                  {isBasic ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor={`username-${api.name}`} className="text-xs">
                          {api.auth?.credentialLabel || 'Username'}
                        </Label>
                        <Input
                          id={`username-${api.name}`}
                          type="text"
                          placeholder="Enter username..."
                          value={basicAuth[api.name]?.username || ''}
                          onChange={(e) =>
                            setBasicAuth(prev => ({
                              ...prev,
                              [api.name]: { ...prev[api.name], username: e.target.value }
                            }))
                          }
                          className="text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`password-${api.name}`} className="text-xs">
                          {api.auth?.secretLabel || 'Password'}
                        </Label>
                        <Input
                          id={`password-${api.name}`}
                          type="password"
                          placeholder="Enter password..."
                          value={basicAuth[api.name]?.password || ''}
                          onChange={(e) =>
                            setBasicAuth(prev => ({
                              ...prev,
                              [api.name]: { ...prev[api.name], password: e.target.value }
                            }))
                          }
                          className="text-sm"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor={`cred-${api.name}`} className="text-xs">
                        {getCredentialLabel(api)}
                      </Label>
                      <Input
                        id={`cred-${api.name}`}
                        type="password"
                        placeholder={`Enter ${getCredentialLabel(api).toLowerCase()}...`}
                        value={credentials[api.name] || ''}
                        onChange={(e) =>
                          setCredentials(prev => ({ ...prev, [api.name]: e.target.value }))
                        }
                        className="text-sm"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSubmit(api)}
                      disabled={
                        isBasic
                          ? !basicAuth[api.name]?.username || !basicAuth[api.name]?.password
                          : !credentials[api.name]?.trim()
                      }
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSkip?.(api.name)}
                      className="text-muted-foreground"
                    >
                      Skip
                    </Button>
                  </div>
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
