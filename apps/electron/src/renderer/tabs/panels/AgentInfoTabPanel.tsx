/**
 * AgentInfoTabPanel
 *
 * Displays agent details including capabilities, MCP servers, and APIs.
 * Shows activation banner if agent hasn't been set up yet.
 * Content extracted from AgentInfoDialog.
 */

import * as React from 'react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, Lock, Globe } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { McpIcon } from '@/components/icons/McpIcon'
import { Spinner } from '@/components/ui/loading-indicator'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { SetupAuthBanner, type BannerState } from '@/components/chat/SetupAuthBanner'
import { useAgentState } from '@/hooks/useAgentState'
import { useTabs } from '../useTabs'
import type {
  SubAgentDefinition,
  AgentAuthStatus,
} from '../../../shared/types'
import type { Tab, AgentInfoTab } from '../types'

interface AgentInfoTabPanelProps {
  tab: Tab
}

export default function AgentInfoTabPanel({ tab }: AgentInfoTabPanelProps) {
  const agentInfoTab = tab as AgentInfoTab
  const { agentId, workspaceId } = agentInfoTab

  const [definition, setDefinition] = useState<SubAgentDefinition | null>(null)
  const [authStatus, setAuthStatus] = useState<AgentAuthStatus | null>(null)
  const [definitionLoading, setDefinitionLoading] = useState(false)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get agent state to determine if agent is activated
  const agentState = useAgentState(workspaceId, agentId)

  // Banner state from centralized hook (single source of truth)
  const bannerState = useMemo((): { state: BannerState; reason?: string } => ({
    state: agentState.bannerState,
    reason: agentState.bannerReason ?? undefined
  }), [agentState.bannerState, agentState.bannerReason])

  // Handle banner action - no-op since agent setup flow was removed
  const handleBannerAction = useCallback(() => {
    // Agent setup wizard has been removed
    // Banner will still show auth status, but no action available
  }, [])

  // Always try to fetch definition and auth status (may return cached/partial data)
  useEffect(() => {
    let isMounted = true
    setDefinitionLoading(true)
    setToolsLoading(true)
    setError(null)

    // Fetch definition (may return cached data even for non-activated agents)
    window.electronAPI.getAgentDefinition(workspaceId, agentId)
      .then((def) => {
        if (!isMounted) return
        setDefinition(def)
        setDefinitionLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        // Don't show error for non-activated agents - just means no cached data
        if (agentState.isIdle) {
          setDefinitionLoading(false)
        } else {
          setError(err.message || 'Failed to load agent definition')
          setDefinitionLoading(false)
        }
      })

    // Fetch auth status (includes MCP server tools)
    window.electronAPI.getAgentAuthStatus(workspaceId, agentId)
      .then((auth) => {
        if (!isMounted) return
        setAuthStatus(auth)
        setToolsLoading(false)
      })
      .catch(() => {
        if (!isMounted) return
        setToolsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [workspaceId, agentId, agentState.isIdle])

  return (
    <ScrollArea className="h-full">
      <div className="px-8 p-6  mx-auto">
        {/* Agent name as title */}
        <h2 className="text-lg font-semibold mb-4">{agentInfoTab.label}</h2>

        {/* Show loading spinner only when we expect to get data (not for idle agents) */}
        {definitionLoading && !agentState.isIdle && (
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

        {/* Show banner when no definition and not loading (or needs setup - show immediately) */}
        {!definition && (!definitionLoading || agentState.needsSetup) && bannerState.state !== 'hidden' && (
          <SetupAuthBanner
            state={bannerState.state}
            agentName={agentInfoTab.label}
            reason={bannerState.reason}
            onAction={handleBannerAction}
            variant="inputAreaCover"
          />
        )}

        {definition && !definitionLoading && (
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

            {/* Warnings */}
            {definition.warnings && definition.warnings.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-info" />
                  Warnings
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {definition.warnings.map((msg, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-info shrink-0">!</span>
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
              {definition?.mcpServers && definition.mcpServers.length > 0 ? (
                <ul className="text-sm space-y-2">
                  {definition.mcpServers.map((server, i) => {
                    // Find matching server from authStatus for tools and auth info
                    const authServer = authStatus?.mcpServers?.find(s => s.name === server.name)
                    const tools = authServer?.tools
                    const hasAuthInfo = authServer !== undefined

                    return (
                      <li key={i} className="bg-muted/50 rounded-md px-4 py-3 select-none">
                        <div className="flex items-start gap-3">
                          <SourceAvatar
                            type="mcp"
                            name={server.name}
                            logoUrl={server.logo}
                            size="lg"
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{server.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {server.url}
                            </div>
                          </div>
                        </div>
                        {/* Tools section - show loading or tools */}
                        {toolsLoading ? (
                          <div className="flex items-center gap-1.5 mt-2 mb-3 text-xs text-muted-foreground">
                            <Spinner className="text-xs" />
                            <span>Loading tools...</span>
                          </div>
                        ) : tools && tools.length > 0 ? (
                          <Collapsible className="mt-2 mb-3">
                            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                              <span>{tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2">
                              <div className="flex flex-wrap gap-1.5">
                                {tools.map((tool, j) => (
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
                        ) : null}
                        {/* Auth status - show from authServer if available, else from definition */}
                        {(hasAuthInfo ? authServer?.requiresAuth : server.requiresAuth) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <Badge variant="outline" className="text-xs">
                              <Lock className="h-3 w-3 mr-1" />
                              Requires Auth
                            </Badge>
                            {hasAuthInfo ? (
                              authServer?.hasAuth ? (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-success/30 text-success"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Authenticated
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-info/30 text-info"
                                >
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Not authenticated
                                </Badge>
                              )
                            ) : null}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No MCP servers configured
                </p>
              )}
            </div>

            <Separator />

            {/* APIs */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <Globe className="h-4 w-4" />
                APIs
              </h4>
              {authStatus?.apis && authStatus.apis.length > 0 ? (
                <ul className="text-sm space-y-2">
                  {authStatus.apis.map((api, i) => (
                    <li key={i} className="bg-muted/50 rounded-md px-4 py-3">
                      <div className="flex items-start gap-3">
                        <SourceAvatar
                          type="api"
                          name={api.name}
                          logoUrl={api.logo}
                          size="lg"
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{api.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {api.baseUrl}
                          </div>
                          {api.auth && api.auth.type !== 'none' && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <Badge variant="outline" className="text-xs">
                                Auth: {api.auth.type}
                              </Badge>
                              {api.hasAuth ? (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-success/30 text-success"
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Configured
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-xs border-info/30 text-info"
                                >
                                  <AlertCircle className="h-3 w-3 mr-1" />
                                  Not configured
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : definition?.apis && definition.apis.length > 0 ? (
                <ul className="text-sm space-y-2">
                  {definition.apis.map((api, i) => (
                    <li key={i} className="bg-muted/50 rounded-md px-4 py-3">
                      <div className="flex items-start gap-3">
                        <SourceAvatar
                          type="api"
                          name={api.name}
                          logoUrl={api.logo}
                          size="lg"
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{api.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {api.baseUrl}
                          </div>
                          {api.auth && api.auth.type !== 'none' && (
                            <Badge variant="outline" className="text-xs mt-1">
                              Auth: {api.auth.type}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No API sources configured
                </p>
              )}
            </div>
          </div>
        )}

        {/* Show activation/setup banner at the bottom when there's content but agent needs further setup */}
        {definition && bannerState.state !== 'hidden' && !definitionLoading && (
          <div className="mt-6">
            <SetupAuthBanner
              state={bannerState.state}
              agentName={agentInfoTab.label}
              reason={bannerState.reason}
              onAction={handleBannerAction}
              variant="inputAreaCover"
            />
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
