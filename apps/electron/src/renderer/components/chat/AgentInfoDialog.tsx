import { useEffect, useState } from "react"
import { Bot, Wrench, AlertCircle, CheckCircle2, ChevronRight, Lock } from "lucide-react"
import { McpIcon } from "@/components/icons/McpIcon"
import { Spinner } from "@/components/ui/loading-indicator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { SubAgentMetadata, SubAgentDefinition, AgentAuthStatus } from "../../../shared/types"

interface AgentInfoDialogProps {
  agent: SubAgentMetadata | null
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
}

/**
 * Dialog showing full agent details including capabilities, MCP servers, and APIs
 */
export function AgentInfoDialog({
  agent,
  open,
  onOpenChange,
  workspaceId,
}: AgentInfoDialogProps) {
  const [definition, setDefinition] = useState<SubAgentDefinition | null>(null)
  const [authStatus, setAuthStatus] = useState<AgentAuthStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch definition and auth status when dialog opens
  useEffect(() => {
    if (!open || !agent) {
      setDefinition(null)
      setAuthStatus(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    // Fetch both definition and auth status in parallel
    Promise.all([
      window.electronAPI.getAgentDefinition(workspaceId, agent.id),
      window.electronAPI.getAgentAuthStatus(workspaceId, agent.id),
    ])
      .then(([def, auth]) => {
        setDefinition(def)
        setAuthStatus(auth)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message || 'Failed to load agent definition')
        setLoading(false)
      })
  }, [open, agent, workspaceId])

  if (!agent) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {agent.displayName || agent.name}
          </DialogTitle>
          <DialogDescription>
            @{agent.name}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner className="text-lg text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive py-4">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {definition && !loading && (
            <div className="space-y-4">
              {/* Capabilities */}
              {definition.capabilities && definition.capabilities.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Capabilities</h4>
                  <ul className="text-sm space-y-1.5 list-disc pl-5">
                    {definition.capabilities.map((cap, i) => (
                      <li key={i}>{cap}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Info Messages */}
              {definition.info && definition.info.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Info</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {definition.info.map((msg, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-accent shrink-0">i</span>
                        <span>{msg}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Separator />

              {/* MCP Servers */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <McpIcon className="h-4 w-4" />
                  MCP Servers
                </h4>
                {authStatus?.mcpServers && authStatus.mcpServers.length > 0 ? (
                  <ul className="text-sm space-y-2">
                    {authStatus.mcpServers.map((server, i) => (
                      <li key={i} className="bg-muted/50 rounded-md p-2">
                        <div className="font-medium">{server.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{server.url}</div>
                        {server.tools && server.tools.length > 0 && (
                          <Collapsible className="mt-2 mb-3">
                            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                              <span>{server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2">
                              <div className="flex flex-wrap gap-1.5">
                                {server.tools.map((tool, j) => (
                                  <Badge
                                    key={j}
                                    variant="secondary"
                                    className="text-xs font-mono font-normal bg-foreground/5"
                                  >
                                    {tool}
                                  </Badge>
                                ))}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        {server.requiresAuth && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant="outline" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Requires Auth
                            </Badge>
                            {server.hasAuth ? (
                              <Badge variant="outline" className="text-xs border-success/30 text-success">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Authenticated
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-info/30 text-info">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Not authenticated
                              </Badge>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : definition?.mcpServers && definition.mcpServers.length > 0 ? (
                  <ul className="text-sm space-y-2">
                    {definition.mcpServers.map((server, i) => (
                      <li key={i} className="bg-muted/50 rounded-md p-2">
                        <div className="font-medium">{server.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{server.url}</div>
                        {server.requiresAuth && (
                          <Badge variant="outline" className="text-xs mt-1">Requires Auth</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No MCP servers configured</p>
                )}
              </div>

              {/* APIs */}
              {(authStatus?.apis?.length || definition?.apis?.length) ? (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Wrench className="h-4 w-4" />
                      REST APIs
                    </h4>
                    {authStatus?.apis && authStatus.apis.length > 0 ? (
                      <ul className="text-sm space-y-2">
                        {authStatus.apis.map((api, i) => (
                          <li key={i} className="bg-muted/50 rounded-md p-2">
                            <div className="font-medium">{api.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{api.baseUrl}</div>
                            {api.auth && api.auth.type !== 'none' && (
                              <div className="flex items-center gap-1.5 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  Auth: {api.auth.type}
                                </Badge>
                                {api.hasAuth ? (
                                  <Badge variant="outline" className="text-xs border-success/30 text-success">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Configured
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs border-info/30 text-info">
                                    <AlertCircle className="h-3 w-3 mr-1" />
                                    Not configured
                                  </Badge>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : definition?.apis && definition.apis.length > 0 ? (
                      <ul className="text-sm space-y-2">
                        {definition.apis.map((api, i) => (
                          <li key={i} className="bg-muted/50 rounded-md p-2">
                            <div className="font-medium">{api.name}</div>
                            <div className="text-xs text-muted-foreground truncate">{api.baseUrl}</div>
                            {api.auth && api.auth.type !== 'none' && (
                              <Badge variant="outline" className="text-xs mt-1">
                                Auth: {api.auth.type}
                              </Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {!definition && !loading && !error && (
            <p className="text-sm text-muted-foreground py-4">
              No definition available. This agent may need to be activated first.
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
