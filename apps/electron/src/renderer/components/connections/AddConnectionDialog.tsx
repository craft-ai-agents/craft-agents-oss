import { useState, useEffect } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/loading-indicator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { ConnectionConfig, ConnectionType } from "../../../shared/types"

type DialogState = 'idle' | 'authenticating' | 'error'

interface AddConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (config: Omit<ConnectionConfig, 'id' | 'enabled'>) => void
  /** Connection to edit (if provided, dialog is in edit mode) */
  editConnection?: ConnectionConfig | null
  /** Called when editing an existing connection */
  onEdit?: (id: string, config: Omit<ConnectionConfig, 'id' | 'enabled'>) => void
}

export function AddConnectionDialog({
  open,
  onOpenChange,
  onAdd,
  editConnection,
  onEdit,
}: AddConnectionDialogProps) {
  const isEditMode = !!editConnection

  // Tab state
  const [activeTab, setActiveTab] = useState<ConnectionType>('mcp')

  // MCP form state
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpClientId, setMcpClientId] = useState('')
  const [mcpClientSecret, setMcpClientSecret] = useState('')
  const [showMcpClientSecret, setShowMcpClientSecret] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // API form state
  const [apiName, setApiName] = useState('')
  const [apiUrl, setApiUrl] = useState('')
  const [apiBearerToken, setApiBearerToken] = useState('')
  const [showBearerToken, setShowBearerToken] = useState(false)

  // Dialog state
  const [dialogState, setDialogState] = useState<DialogState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Prefill form when editing
  useEffect(() => {
    if (editConnection && open) {
      setActiveTab(editConnection.type)
      if (editConnection.type === 'mcp') {
        setMcpName(editConnection.name)
        setMcpUrl(editConnection.mcpUrl || '')
        setMcpClientId(editConnection.mcpClientId || '')
        setMcpClientSecret(editConnection.mcpClientSecret || '')
        // Open advanced settings if client ID or secret is set
        if (editConnection.mcpClientId || editConnection.mcpClientSecret) {
          setAdvancedOpen(true)
        }
      } else {
        setApiName(editConnection.name)
        setApiUrl(editConnection.apiUrl || '')
        setApiBearerToken(editConnection.apiBearerToken || '')
      }
    }
  }, [editConnection, open])

  // Validation
  const isMcpValid = mcpName.trim() !== '' && mcpUrl.trim() !== ''
  const isApiValid = apiName.trim() !== '' && apiUrl.trim() !== '' && apiBearerToken.trim() !== ''
  const isValid = activeTab === 'mcp' ? isMcpValid : isApiValid

  // Reset form when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset all state
      setActiveTab('mcp')
      setMcpName('')
      setMcpUrl('')
      setMcpClientId('')
      setMcpClientSecret('')
      setShowMcpClientSecret(false)
      setAdvancedOpen(false)
      setApiName('')
      setApiUrl('')
      setApiBearerToken('')
      setShowBearerToken(false)
      setDialogState('idle')
      setError(null)
    }
    onOpenChange(newOpen)
  }

  const handleSubmit = async () => {
    if (activeTab === 'mcp') {
      setDialogState('authenticating')
      setError(null)
      try {
        // Start OAuth flow
        const result = await window.electronAPI.startConnectionMcpOAuth({
          name: mcpName,
          url: mcpUrl,
          clientId: mcpClientId || undefined,
          clientSecret: mcpClientSecret || undefined,
        })

        if (!result.success) {
          throw new Error(result.error || 'OAuth authentication failed')
        }

        const config = {
          type: 'mcp' as const,
          name: mcpName,
          mcpUrl,
          mcpClientId: result.clientId || mcpClientId || undefined,
          mcpClientSecret: mcpClientSecret || undefined,
          mcpAccessToken: result.accessToken, // Will be stored in CredentialManager on save
          mcpRefreshToken: result.refreshToken, // Will be stored in CredentialManager on save
          mcpExpiresAt: result.expiresAt, // Will be stored in CredentialManager on save
          isAuthenticated: true,
        }

        if (isEditMode && editConnection && onEdit) {
          onEdit(editConnection.id, config)
        } else {
          onAdd(config)
        }
        handleOpenChange(false)
      } catch (err) {
        setDialogState('error')
        setError(err instanceof Error ? err.message : 'Authentication failed')
      }
    } else {
      // API: just save bearer token (no OAuth needed)
      const config = {
        type: 'api' as const,
        name: apiName,
        apiUrl,
        apiBearerToken,
        isAuthenticated: true,
      }

      if (isEditMode && editConnection && onEdit) {
        onEdit(editConnection.id, config)
      } else {
        onAdd(config)
      }
      handleOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit connection' : 'Add connection'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Modify your connection settings.' : 'Connect to external data and tools.'}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ConnectionType)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="mcp" disabled={dialogState === 'authenticating' || isEditMode}>
              MCP Server
            </TabsTrigger>
            <TabsTrigger value="api" disabled={dialogState === 'authenticating' || isEditMode}>
              API
            </TabsTrigger>
          </TabsList>

          {/* MCP Tab */}
          <TabsContent value="mcp" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">Name</Label>
              <Input
                id="mcp-name"
                placeholder="My MCP Server"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
                disabled={dialogState === 'authenticating'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-url">Remote MCP server URL</Label>
              <Input
                id="mcp-url"
                placeholder="https://mcp.example.com"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
                disabled={dialogState === 'authenticating'}
              />
            </div>

            {/* Advanced Settings (Collapsible) */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                {advancedOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                Advanced settings
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label htmlFor="mcp-client-id">OAuth Client ID (optional)</Label>
                  <Input
                    id="mcp-client-id"
                    placeholder="OAuth Client ID (optional)"
                    value={mcpClientId}
                    onChange={(e) => setMcpClientId(e.target.value)}
                    disabled={dialogState === 'authenticating'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="mcp-client-secret">OAuth Client Secret (optional)</Label>
                  <div className="relative">
                    <Input
                      id="mcp-client-secret"
                      type={showMcpClientSecret ? 'text' : 'password'}
                      placeholder="OAuth Client Secret (optional)"
                      value={mcpClientSecret}
                      onChange={(e) => setMcpClientSecret(e.target.value)}
                      disabled={dialogState === 'authenticating'}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMcpClientSecret(!showMcpClientSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showMcpClientSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </TabsContent>

          {/* API Tab */}
          <TabsContent value="api" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="api-name">Name</Label>
              <Input
                id="api-name"
                placeholder="My API"
                value={apiName}
                onChange={(e) => setApiName(e.target.value)}
                disabled={dialogState === 'authenticating'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-url">API URL</Label>
              <Input
                id="api-url"
                placeholder="https://api.example.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                disabled={dialogState === 'authenticating'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-bearer">Bearer Token</Label>
              <div className="relative">
                <Input
                  id="api-bearer"
                  type={showBearerToken ? 'text' : 'password'}
                  placeholder="Enter bearer token..."
                  value={apiBearerToken}
                  onChange={(e) => setApiBearerToken(e.target.value)}
                  disabled={dialogState === 'authenticating'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowBearerToken(!showBearerToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showBearerToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Error message */}
        {dialogState === 'error' && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Trust warning */}
        <p className="text-xs text-muted-foreground">
          Only use connections from developers you trust.
        </p>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={dialogState === 'authenticating'}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || dialogState === 'authenticating'}
            className={cn(dialogState === 'authenticating' && "gap-2")}
          >
            {dialogState === 'authenticating' && <Spinner className="text-xs" />}
            {dialogState === 'authenticating' ? 'Connecting...' : isEditMode ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
