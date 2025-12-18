import { useEffect, useState, useCallback } from "react"
import { Bot, Server, Key, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react"
import { Spinner } from "@/components/ui/loading-indicator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SubAgentMetadata, AgentAuthRequirements } from "../../../shared/types"

type AuthStep =
  | 'loading'           // Loading auth requirements
  | 'mcp-confirm'       // Confirm before starting OAuth
  | 'mcp-authenticating' // OAuth in progress
  | 'mcp-bearer'        // Bearer token input (fallback)
  | 'api-input'         // API key input
  | 'complete'          // All done
  | 'error'             // Error occurred

interface McpServerAuth {
  name: string
  url: string
  requiresAuth?: boolean
  status: 'pending' | 'authenticating' | 'complete' | 'skipped' | 'error'
  error?: string
}

interface ApiAuth {
  name: string
  auth?: { type: string; credentialLabel?: string; secretLabel?: string }
  status: 'pending' | 'complete' | 'skipped'
}

interface AgentAuthDialogProps {
  agent: SubAgentMetadata | null
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: (success: boolean) => void
}

/**
 * Dialog for authenticating MCP servers and APIs for an agent.
 * Handles OAuth flow, bearer token fallback, and API key collection.
 */
export function AgentAuthDialog({
  agent,
  workspaceId,
  open,
  onOpenChange,
  onComplete,
}: AgentAuthDialogProps) {
  const [step, setStep] = useState<AuthStep>('loading')
  const [mcpServers, setMcpServers] = useState<McpServerAuth[]>([])
  const [apis, setApis] = useState<ApiAuth[]>([])
  const [currentMcpIndex, setCurrentMcpIndex] = useState(0)
  const [currentApiIndex, setCurrentApiIndex] = useState(0)
  const [bearerToken, setBearerToken] = useState('')
  const [apiCredential, setApiCredential] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Load auth requirements when dialog opens
  useEffect(() => {
    if (!open || !agent) {
      // Reset state when closing
      setStep('loading')
      setMcpServers([])
      setApis([])
      setCurrentMcpIndex(0)
      setCurrentApiIndex(0)
      setBearerToken('')
      setApiCredential('')
      setError(null)
      return
    }

    loadAuthRequirements()
  }, [open, agent, workspaceId])

  const loadAuthRequirements = async () => {
    if (!agent) return

    setStep('loading')
    setError(null)

    try {
      const requirements = await window.electronAPI.getAgentAuthRequirements(workspaceId, agent.id)

      const mcpWithStatus: McpServerAuth[] = requirements.mcpServers.map(s => ({
        ...s,
        status: 'pending' as const,
      }))

      const apisWithStatus: ApiAuth[] = requirements.apis.map(a => ({
        ...a,
        status: 'pending' as const,
      }))

      setMcpServers(mcpWithStatus)
      setApis(apisWithStatus)

      // Determine next step
      if (mcpWithStatus.length > 0) {
        setStep('mcp-confirm')
      } else if (apisWithStatus.length > 0) {
        setStep('api-input')
      } else {
        // No auth needed
        setStep('complete')
      }
    } catch (err) {
      console.error('[AgentAuthDialog] Failed to load auth requirements:', err)
      setError(err instanceof Error ? err.message : 'Failed to load auth requirements')
      setStep('error')
    }
  }

  const currentMcpServer = mcpServers[currentMcpIndex]
  const currentApi = apis[currentApiIndex]

  // Start OAuth for current MCP server
  const startOAuth = useCallback(async () => {
    if (!agent || !currentMcpServer) return

    setStep('mcp-authenticating')
    setMcpServers(prev => prev.map((s, i) =>
      i === currentMcpIndex ? { ...s, status: 'authenticating' } : s
    ))

    try {
      const result = await window.electronAPI.startMcpOAuth(
        workspaceId,
        agent.id,
        currentMcpServer.url,
        currentMcpServer.name
      )

      if (result.success) {
        // Mark as complete and move to next
        setMcpServers(prev => prev.map((s, i) =>
          i === currentMcpIndex ? { ...s, status: 'complete' } : s
        ))
        moveToNextMcp()
      } else {
        // OAuth failed, show bearer token input as fallback
        setMcpServers(prev => prev.map((s, i) =>
          i === currentMcpIndex ? { ...s, status: 'pending', error: result.error } : s
        ))
        setError(result.error || 'OAuth failed')
        setStep('mcp-bearer')
      }
    } catch (err) {
      console.error('[AgentAuthDialog] OAuth error:', err)
      setMcpServers(prev => prev.map((s, i) =>
        i === currentMcpIndex ? { ...s, status: 'pending', error: 'OAuth failed' } : s
      ))
      setError(err instanceof Error ? err.message : 'OAuth failed')
      setStep('mcp-bearer')
    }
  }, [agent, currentMcpServer, currentMcpIndex, workspaceId])

  // Save bearer token for current MCP server
  const saveBearerToken = useCallback(async () => {
    if (!agent || !currentMcpServer || !bearerToken.trim()) return

    try {
      await window.electronAPI.saveMcpBearer(
        workspaceId,
        agent.id,
        currentMcpServer.name,
        bearerToken.trim()
      )

      // Mark as complete and move to next
      setMcpServers(prev => prev.map((s, i) =>
        i === currentMcpIndex ? { ...s, status: 'complete' } : s
      ))
      setBearerToken('')
      setError(null)
      moveToNextMcp()
    } catch (err) {
      console.error('[AgentAuthDialog] Failed to save bearer token:', err)
      setError(err instanceof Error ? err.message : 'Failed to save token')
    }
  }, [agent, currentMcpServer, currentMcpIndex, bearerToken, workspaceId])

  // Move to next MCP server or APIs
  const moveToNextMcp = useCallback(() => {
    const nextIndex = currentMcpIndex + 1
    if (nextIndex < mcpServers.length) {
      setCurrentMcpIndex(nextIndex)
      setStep('mcp-confirm')
      setError(null)
    } else if (apis.length > 0) {
      setStep('api-input')
      setError(null)
    } else {
      setStep('complete')
    }
  }, [currentMcpIndex, mcpServers.length, apis.length])

  // Skip current MCP server
  const skipCurrentMcp = useCallback(() => {
    setMcpServers(prev => prev.map((s, i) =>
      i === currentMcpIndex ? { ...s, status: 'skipped' } : s
    ))
    setBearerToken('')
    setError(null)
    moveToNextMcp()
  }, [currentMcpIndex, moveToNextMcp])

  // Save API credential
  const saveApiCredential = useCallback(async () => {
    if (!agent || !currentApi || !apiCredential.trim()) return

    try {
      await window.electronAPI.saveApiCredentials(
        workspaceId,
        agent.id,
        currentApi.name,
        apiCredential.trim()
      )

      // Mark as complete and move to next
      setApis(prev => prev.map((a, i) =>
        i === currentApiIndex ? { ...a, status: 'complete' } : a
      ))
      setApiCredential('')

      // Move to next API or complete
      const nextIndex = currentApiIndex + 1
      if (nextIndex < apis.length) {
        setCurrentApiIndex(nextIndex)
      } else {
        setStep('complete')
      }
    } catch (err) {
      console.error('[AgentAuthDialog] Failed to save API credential:', err)
      setError(err instanceof Error ? err.message : 'Failed to save credential')
    }
  }, [agent, currentApi, currentApiIndex, apiCredential, apis.length, workspaceId])

  // Skip current API
  const skipCurrentApi = useCallback(() => {
    setApis(prev => prev.map((a, i) =>
      i === currentApiIndex ? { ...a, status: 'skipped' } : a
    ))
    setApiCredential('')

    const nextIndex = currentApiIndex + 1
    if (nextIndex < apis.length) {
      setCurrentApiIndex(nextIndex)
    } else {
      setStep('complete')
    }
  }, [currentApiIndex, apis.length])

  // Handle dialog close
  const handleClose = useCallback(() => {
    const hasCompletedAny = mcpServers.some(s => s.status === 'complete') ||
                           apis.some(a => a.status === 'complete')
    onOpenChange(false)
    onComplete(step === 'complete' || hasCompletedAny)
  }, [mcpServers, apis, step, onOpenChange, onComplete])

  // Complete and close
  const handleFinish = useCallback(() => {
    onOpenChange(false)
    onComplete(true)
  }, [onOpenChange, onComplete])

  if (!agent) return null

  const totalItems = mcpServers.length + apis.length
  const completedItems = mcpServers.filter(s => s.status === 'complete').length +
                        apis.filter(a => a.status === 'complete').length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Authenticate {agent.displayName || agent.name}
          </DialogTitle>
          <DialogDescription>
            {totalItems > 0 && step !== 'complete' && (
              <span>Step {completedItems + 1} of {totalItems}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[400px]">
          {/* Loading */}
          {step === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="text-lg text-muted-foreground" />
            </div>
          )}

          {/* MCP Confirm - Before OAuth */}
          {step === 'mcp-confirm' && currentMcpServer && (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3">
                <Server className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{currentMcpServer.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{currentMcpServer.url}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Click "Authenticate" to open your browser and sign in to this MCP server.
              </p>
            </div>
          )}

          {/* MCP Authenticating - OAuth in progress */}
          {step === 'mcp-authenticating' && currentMcpServer && (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3">
                <Server className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{currentMcpServer.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{currentMcpServer.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Spinner className="text-sm" />
                <span>Waiting for authentication...</span>
                <ExternalLink className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                Complete the sign-in process in your browser. This dialog will update automatically.
              </p>
            </div>
          )}

          {/* MCP Bearer Token - Fallback input */}
          {step === 'mcp-bearer' && currentMcpServer && (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3">
                <Server className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{currentMcpServer.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{currentMcpServer.url}</p>
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-amber-500">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="bearer-token">Bearer Token</Label>
                <Input
                  id="bearer-token"
                  type="password"
                  placeholder="Enter bearer token..."
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveBearerToken()}
                />
                <p className="text-xs text-muted-foreground">
                  Enter a bearer token manually if OAuth is not available.
                </p>
              </div>
            </div>
          )}

          {/* API Input */}
          {step === 'api-input' && currentApi && (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3">
                <Key className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{currentApi.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {currentApi.auth?.type === 'basic' ? 'Basic Authentication' :
                     currentApi.auth?.type === 'bearer' ? 'Bearer Token' :
                     currentApi.auth?.type === 'header' ? 'API Key (Header)' :
                     currentApi.auth?.type === 'query' ? 'API Key (Query)' :
                     'API Credential'}
                  </p>
                </div>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="api-credential">
                  {currentApi.auth?.credentialLabel || 'API Key'}
                </Label>
                <Input
                  id="api-credential"
                  type="password"
                  placeholder={`Enter ${currentApi.auth?.credentialLabel?.toLowerCase() || 'API key'}...`}
                  value={apiCredential}
                  onChange={(e) => setApiCredential(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveApiCredential()}
                />
              </div>
            </div>
          )}

          {/* Complete */}
          {step === 'complete' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Authentication Complete</span>
              </div>
              {(mcpServers.length > 0 || apis.length > 0) && (
                <div className="space-y-2">
                  {mcpServers.map((server, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {server.status === 'complete' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : server.status === 'skipped' ? (
                        <span className="h-4 w-4 text-center text-muted-foreground">–</span>
                      ) : (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      )}
                      <span className={server.status === 'skipped' ? 'text-muted-foreground' : ''}>
                        {server.name}
                      </span>
                    </div>
                  ))}
                  {apis.map((api, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      {api.status === 'complete' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <span className="h-4 w-4 text-center text-muted-foreground">–</span>
                      )}
                      <span className={api.status === 'skipped' ? 'text-muted-foreground' : ''}>
                        {api.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Authentication Error</span>
              </div>
              {error && (
                <p className="text-sm text-muted-foreground">{error}</p>
              )}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          {/* Loading - just show cancel */}
          {step === 'loading' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {/* MCP Confirm */}
          {step === 'mcp-confirm' && (
            <>
              <Button variant="outline" onClick={skipCurrentMcp}>
                Skip
              </Button>
              <Button onClick={startOAuth}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Authenticate
              </Button>
            </>
          )}

          {/* MCP Authenticating */}
          {step === 'mcp-authenticating' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {/* MCP Bearer */}
          {step === 'mcp-bearer' && (
            <>
              <Button variant="outline" onClick={skipCurrentMcp}>
                Skip
              </Button>
              <Button onClick={saveBearerToken} disabled={!bearerToken.trim()}>
                Save Token
              </Button>
            </>
          )}

          {/* API Input */}
          {step === 'api-input' && (
            <>
              <Button variant="outline" onClick={skipCurrentApi}>
                Skip
              </Button>
              <Button onClick={saveApiCredential} disabled={!apiCredential.trim()}>
                Save
              </Button>
            </>
          )}

          {/* Complete */}
          {step === 'complete' && (
            <Button onClick={handleFinish}>
              Done
            </Button>
          )}

          {/* Error */}
          {step === 'error' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={loadAuthRequirements}>
                Retry
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
