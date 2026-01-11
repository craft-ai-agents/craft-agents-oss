/**
 * SourceInfoPage
 *
 * Displays source details including connection info, authentication status,
 * documentation (guide.md), and metadata. View-only.
 */

import * as React from 'react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  AlertCircle,
} from 'lucide-react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Separator } from '@/components/ui/separator'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { Spinner } from '@craft-agent/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'
import { CONTENT_MAX_WIDTH_CLASS } from '@/config/layout'
import { useAppShellContext } from '@/context/AppShellContext'
import type { LoadedSource, McpToolWithPermission } from '../../shared/types'
import type { PermissionsConfigFile } from '@craft-agent/shared/agent'

interface SourceInfoPageProps {
  sourceSlug: string
  workspaceId: string
  agentSlug?: string
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Never'

  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

/**
 * Get source URL for display
 */
function getSourceUrl(source: LoadedSource): string | null {
  const { type, mcp, api, local } = source.config

  if (type === 'mcp' && mcp?.url) return mcp.url
  if (type === 'api' && api?.baseUrl) return api.baseUrl
  if (type === 'local' && local?.path) return local.path

  return null
}

/**
 * Section Header - matches Settings styling
 */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
      {children}
    </h3>
  )
}

export default function SourceInfoPage({ sourceSlug, workspaceId, agentSlug }: SourceInfoPageProps) {
  const { textareaRef, openNewChat } = useAppShellContext()
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfigFile | null>(null)
  const [mcpTools, setMcpTools] = useState<McpToolWithPermission[] | null>(null)
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false)
  const [mcpToolsError, setMcpToolsError] = useState<string | null>(null)
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)

  // Load source data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSource = async () => {
      try {
        // Load sources based on whether it's agent-scoped or workspace-scoped
        const sources = agentSlug
          ? await window.electronAPI.getAgentSources(workspaceId, agentSlug)
          : await window.electronAPI.getSources(workspaceId)

        if (!isMounted) return

        // Find the source by slug
        const found = sources.find((s) => s.config.slug === sourceSlug)
        if (found) {
          setSource(found)

          // Load permissions config via IPC
          const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
          if (isMounted) {
            setPermissionsConfig(config)
          }
        } else {
          setError('Source not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load source')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSource()

    return () => {
      isMounted = false
    }
  }, [workspaceId, sourceSlug, agentSlug])

  // Load MCP tools when source is loaded and is MCP type
  useEffect(() => {
    if (!source || source.config.type !== 'mcp') {
      setMcpTools(null)
      setMcpToolsError(null)
      return
    }

    let isMounted = true
    setMcpToolsLoading(true)
    setMcpToolsError(null)

    const loadTools = async () => {
      try {
        const result = await window.electronAPI.getMcpTools(workspaceId, sourceSlug)
        if (!isMounted) return

        if (result.success && result.tools) {
          setMcpTools(result.tools)
        } else {
          setMcpToolsError(result.error || 'Failed to load tools')
        }
      } catch (err) {
        if (!isMounted) return
        setMcpToolsError(err instanceof Error ? err.message : 'Failed to load tools')
      } finally {
        if (isMounted) setMcpToolsLoading(false)
      }
    }

    loadTools()

    return () => {
      isMounted = false
    }
  }, [source, workspaceId, sourceSlug])

  // Load workspace settings (for localMcpEnabled)
  useEffect(() => {
    if (!workspaceId) return
    window.electronAPI.getWorkspaceSettings(workspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
      }
    }).catch((err) => {
      console.error('[SourceInfoPage] Failed to load workspace settings:', err)
    })
  }, [workspaceId])

  // Listen for source folder changes (config.json, guide.md, permissions.json)
  useEffect(() => {
    if (!window.electronAPI?.onSourcesChanged) return

    const cleanup = window.electronAPI.onSourcesChanged((sources) => {
      // Check if the updated sources include our source
      const updated = sources.find((s) => s.config.slug === sourceSlug)

      if (updated) {
        console.log('[SourceInfoPage] Source changed, reloading...')
        setSource(updated)

        // Reload permissions config via IPC
        const loadPermissionsConfig = async () => {
          try {
            const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
            setPermissionsConfig(config)
          } catch (err) {
            console.error('[SourceInfoPage] Failed to reload permissions config:', err)
          }
        }
        loadPermissionsConfig()
      }
    })

    return cleanup
  }, [sourceSlug, workspaceId])

  // Compute source URL
  const sourceUrl = useMemo(() => source ? getSourceUrl(source) : null, [source])

  // Group MCP tools by permission status
  const groupedTools = useMemo(() => {
    if (!mcpTools) return null
    const allowed = mcpTools.filter(t => t.allowed)
    const requiresPermission = mcpTools.filter(t => !t.allowed)
    return { allowed, requiresPermission }
  }, [mcpTools])

  // Handle opening URL (website or folder)
  const handleOpenUrl = useCallback(async () => {
    if (!source || !sourceUrl) return
    if (window.electronAPI) {
      // Check if it's a URL or a file path
      if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        // Open in browser
        await window.electronAPI.openUrl(sourceUrl)
      } else {
        // Open folder
        await window.electronAPI.showInFolder(sourceUrl)
      }
    }
  }, [source, sourceUrl])

  // Handle opening source folder
  const handleOpenSourceFolder = useCallback(async () => {
    if (!source) return
    if (window.electronAPI) {
      await window.electronAPI.showInFolder(source.folderPath)
    }
  }, [source])

  // Handle "Edit in chat" - opens a new chat with the .settings agent
  const handleEditInChat = useCallback(async (section: 'connection' | 'permissions') => {
    if (!source || !openNewChat) return

    try {
      // Ensure the .settings builtin agent exists
      const agentId = await window.electronAPI.ensureBuiltinAgent(workspaceId, '.settings')
      if (!agentId) {
        console.error('[SourceInfoPage] Failed to create settings agent')
        return
      }

      const sessionName = section === 'connection'
        ? `Edit ${source.config.name} connection`
        : `Edit ${source.config.name} permissions`

      const message = section === 'connection'
        ? `I would like to edit the connection settings for the "${source.config.name}" source: `
        : `I would like to edit the permissions for the "${source.config.name}" source: `

      // Use openNewChat which handles session creation and input pre-filling
      await openNewChat({
        agentId,
        name: sessionName,
        input: message,
      })

      // Focus the textarea and move cursor to end after the input is set
      setTimeout(() => {
        const textarea = textareaRef?.current
        if (textarea) {
          textarea.focus()
          // Move cursor to end of text
          const length = textarea.value.length
          textarea.setSelectionRange(length, length)
        }
      }, 150)
    } catch (error) {
      console.error('[SourceInfoPage] Failed to edit in chat:', error)
    }
  }, [source, workspaceId, openNewChat, textareaRef])

  // Handle editing guide.md in Monaco markdown editor
  const handleEditGuide = useCallback(async () => {
    if (!source) return

    const guidePath = `${source.folderPath}/guide.md`

    await window.electronAPI.openPreview({
      mode: 'markdown',
      sessionId: 'workspace',  // Use 'workspace' as session for non-session previews
      previewId: `source-guide:${sourceSlug}`,
      markdown: {
        mode: 'readWrite',
        filePath: guidePath,
        title: `${source.config.name} - guide.md`,
      },
    })
  }, [source, sourceSlug])

  // Get source name for header
  const sourceName = source?.config.name || sourceSlug

  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={sourceName} />
        <Separator />
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="text-lg text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={sourceName} />
        <Separator />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-4">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <p className="text-sm font-medium">Error loading source</p>
          <p className="text-xs text-center max-w-md">{error}</p>
        </div>
      </div>
    )
  }

  if (!source) {
    return (
      <div className="h-full flex flex-col">
        <PanelHeader title={sourceName} />
        <Separator />
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Source not found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={sourceName} />
      <Separator />
      <ScrollArea className="flex-1">
        <div className={cn(CONTENT_MAX_WIDTH_CLASS, "mx-auto px-5 py-4")}>
          <div className="space-y-6">
            {/* Source avatar and tagline */}
            <div className="flex items-start gap-2.5">
              <SourceAvatar source={source} className="h-[32px] w-[32px] shrink-0 mt-[2px] rounded-[4px] ring-1 ring-border/30" />
              <div className="flex-1 min-w-0">
                {source.config.tagline && (
                  <p className="text-sm text-foreground/60 mt-0 leading-snug">
                    {source.config.tagline}
                  </p>
                )}
              </div>
            </div>

          {/* Disabled Warning - shown when source is stdio and local MCP is disabled */}
          {source.config.mcp?.transport === 'stdio' && !localMcpEnabled && (
            <div className="bg-foreground/5 border border-border/50 rounded-[8px] px-4 py-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div>
                  <span className="font-medium">Source Disabled</span>
                  <p className="text-foreground/60 mt-0.5">
                    Local MCP servers are disabled in Settings &gt; Advanced.
                    Enable them to use this source.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Connection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <SectionHeader>Connection</SectionHeader>
              <button
                onClick={() => handleEditInChat('connection')}
                className={cn(
                  "transition-colors text-[13px] cursor-pointer",
                  "text-muted-foreground hover:text-foreground hover:underline",
                  "focus:outline-none focus-visible:underline"
                )}
              >
                Edit in chat
              </button>
            </div>

            <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden py-2">
              {/* Table */}
              <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '128px' }} />
                  <col />
                </colgroup>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="pl-[22px] pr-4 py-1.5 text-muted-foreground">Type</td>
                    <td className="pr-4 py-1.5">
                      {source.config.type.toUpperCase()}
                    </td>
                  </tr>

                  {sourceUrl && (
                    <tr className="border-b border-border/30">
                      <td className="pl-[22px] pr-4 py-1.5 text-muted-foreground">URL</td>
                      <td className="pr-4 py-1.5">
                        <button
                          onClick={handleOpenUrl}
                          className="font-mono truncate hover:underline text-foreground focus:outline-none focus-visible:underline text-left block w-full"
                        >
                          {sourceUrl}
                        </button>
                      </td>
                    </tr>
                  )}

                  <tr>
                    <td className="pl-[22px] pr-4 py-1.5 text-muted-foreground">Last Tested</td>
                    <td className="pr-4 py-1.5">
                      {formatRelativeTime(source.config.lastTestedAt)}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Error message */}
              {source.config.connectionError && (
                <div className="px-[22px] py-2 border-t border-border/30 bg-destructive/5">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{source.config.connectionError}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Permissions - for API and local sources, show safe mode config */}
          {source.config.type !== 'mcp' && permissionsConfig && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader>Permissions</SectionHeader>
                <button
                  onClick={() => handleEditInChat('permissions')}
                  className={cn(
                    "transition-colors text-[13px] cursor-pointer",
                    "text-muted-foreground hover:text-foreground hover:underline",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  Edit in chat
                </button>
              </div>

              <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden py-2">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30">
                    <tr>
                      <th className="pl-[22px] pr-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Access</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[80px]">Type</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pattern</th>
                      <th className="pr-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Blocked Tools */}
                    {permissionsConfig.blockedTools?.map((tool, i) => (
                      <tr key={`blocked-${i}`} className="border-b border-border/30 last:border-0">
                        <td className="pl-[22px] pr-4 py-2 align-top">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                            Blocked
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground text-xs align-top">Tool</td>
                        <td className="px-4 py-2 align-top">
                          <code className="font-mono text-xs">{tool}</code>
                        </td>
                        <td className="pr-4 py-2 text-foreground/60 text-xs align-top">-</td>
                      </tr>
                    ))}

                    {/* Allowed Bash Patterns */}
                    {permissionsConfig.allowedBashPatterns?.map((item, i) => {
                      const pattern = typeof item === 'string' ? item : item.pattern
                      const comment = typeof item === 'string' ? null : item.comment
                      return (
                        <tr key={`bash-${i}`} className="border-b border-border/30 last:border-0">
                          <td className="pl-[22px] pr-4 py-2 align-top">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                              Allowed
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs align-top">Bash</td>
                          <td className="px-4 py-2 align-top">
                            <code className="font-mono text-xs">{pattern}</code>
                          </td>
                          <td className="pr-4 py-2 text-foreground/60 text-xs align-top">{comment || '-'}</td>
                        </tr>
                      )
                    })}

                    {/* Allowed API Endpoints */}
                    {permissionsConfig.allowedApiEndpoints?.map((item, i) => {
                      const pattern = `${item.method} ${item.path}`
                      const comment = typeof item === 'object' && 'comment' in item ? item.comment : null
                      return (
                        <tr key={`api-${i}`} className="border-b border-border/30 last:border-0">
                          <td className="pl-[22px] pr-4 py-2 align-top">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                              Allowed
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground text-xs align-top">API</td>
                          <td className="px-4 py-2 align-top">
                            <code className="font-mono text-xs">{pattern}</code>
                          </td>
                          <td className="pr-4 py-2 text-foreground/60 text-xs align-top">{comment || '-'}</td>
                        </tr>
                      )
                    })}

                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tools - for MCP sources, show tools grouped by permission */}
          {source.config.type === 'mcp' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader>Tools</SectionHeader>
                <button
                  onClick={() => handleEditInChat('permissions')}
                  className={cn(
                    "transition-colors text-[13px] cursor-pointer",
                    "text-muted-foreground hover:text-foreground hover:underline",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  Edit in chat
                </button>
              </div>

              <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden">
                {mcpToolsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Spinner className="text-muted-foreground" />
                  </div>
                ) : mcpToolsError ? (
                  <div className="px-[22px] py-4 text-sm text-muted-foreground">
                    {mcpToolsError === 'Source requires authentication' ? (
                      <span>Authenticate with this source to view available tools</span>
                    ) : (
                      <span>{mcpToolsError}</span>
                    )}
                  </div>
                ) : groupedTools ? (
                  <div>
                    {/* Allowed tools */}
                    {groupedTools.allowed.length > 0 && (
                      <div>
                        <div className="px-[22px] py-2 bg-success/5 border-b border-border/30">
                          <span className="text-xs font-semibold text-success uppercase tracking-wide">
                            Allowed ({groupedTools.allowed.length})
                          </span>
                        </div>
                        <div className="divide-y divide-border/30">
                          {groupedTools.allowed.map((tool) => (
                            <div key={tool.name} className="px-[22px] py-2">
                              <code className="font-mono text-xs">{tool.name}</code>
                              {tool.description && (
                                <p className="text-xs text-foreground/60 mt-0.5">{tool.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tools requiring permission */}
                    {groupedTools.requiresPermission.length > 0 && (
                      <div className={groupedTools.allowed.length > 0 ? 'border-t border-border/30' : ''}>
                        <div className="px-[22px] py-2 bg-info/5 border-b border-border/30">
                          <span className="text-xs font-semibold text-info uppercase tracking-wide">
                            Requires Permission ({groupedTools.requiresPermission.length})
                          </span>
                        </div>
                        <div className="divide-y divide-border/30">
                          {groupedTools.requiresPermission.map((tool) => (
                            <div key={tool.name} className="px-[22px] py-2">
                              <code className="font-mono text-xs">{tool.name}</code>
                              {tool.description && (
                                <p className="text-xs text-foreground/60 mt-0.5">{tool.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No tools */}
                    {groupedTools.allowed.length === 0 && groupedTools.requiresPermission.length === 0 && (
                      <div className="px-[22px] py-4 text-sm text-muted-foreground">
                        No tools available
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-[22px] py-4 text-sm text-muted-foreground">
                    Connect to view available tools
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Permissions - for MCP sources, show safe mode config patterns */}
          {source.config.type === 'mcp' && permissionsConfig && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader>Permissions</SectionHeader>
                <button
                  onClick={() => handleEditInChat('permissions')}
                  className={cn(
                    "transition-colors text-[13px] cursor-pointer",
                    "text-muted-foreground hover:text-foreground hover:underline",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  Edit in chat
                </button>
              </div>

              <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden py-2">
                <table className="w-full text-sm">
                  <thead className="border-b border-border/30">
                    <tr>
                      <th className="pl-[22px] pr-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-[100px]">Access</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pattern</th>
                      <th className="pr-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Blocked Tools */}
                    {permissionsConfig.blockedTools?.map((tool, i) => (
                      <tr key={`blocked-${i}`} className="border-b border-border/30 last:border-0">
                        <td className="pl-[22px] pr-4 py-2 align-top">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                            Blocked
                          </span>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <code className="font-mono text-xs">{tool}</code>
                        </td>
                        <td className="pr-4 py-2 text-foreground/60 text-xs align-top">-</td>
                      </tr>
                    ))}

                    {/* Allowed MCP Patterns */}
                    {permissionsConfig.allowedMcpPatterns?.map((item, i) => {
                      const pattern = typeof item === 'string' ? item : item.pattern
                      const comment = typeof item === 'string' ? null : item.comment
                      return (
                        <tr key={`mcp-${i}`} className="border-b border-border/30 last:border-0">
                          <td className="pl-[22px] pr-4 py-2 align-top">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                              Allowed
                            </span>
                          </td>
                          <td className="px-4 py-2 align-top">
                            <code className="font-mono text-xs">{pattern}</code>
                          </td>
                          <td className="pr-4 py-2 text-foreground/60 text-xs align-top">{comment || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Documentation */}
          {source.guide?.raw && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <SectionHeader>Documentation</SectionHeader>
                <button
                  onClick={handleEditGuide}
                  className={cn(
                    "transition-colors text-[13px] cursor-pointer",
                    "text-muted-foreground hover:text-foreground hover:underline",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  Edit
                </button>
              </div>

              <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden">
                {/* Content */}
                <div
                  className={cn(
                    "pl-[22px] pr-4 pb-3 text-sm overflow-y-auto",
                    source.guide.raw.trimStart().match(/^#{1,3}\s/) ? "pt-0" : "pt-1"
                  )}
                  style={{ maxHeight: 540 }}
                >
                  <Markdown mode="minimal">
                    {source.guide.raw}
                  </Markdown>
                </div>
              </div>
            </div>
          )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
