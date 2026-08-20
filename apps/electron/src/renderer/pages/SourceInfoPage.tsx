/**
 * SourceInfoPage
 *
 * Displays source details including connection info, authentication status,
 * documentation (guide.md), and metadata.
 * Native-first edit for name/type/url/docs/enabled; AI EditPopover secondary.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useMemo, useCallback } from 'react'
import { AlertCircle } from 'lucide-react'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SourceMenu } from '@/components/app-shell/SourceMenu'
import { useNavigation } from '@/contexts/NavigationContext'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Alert,
  PermissionsDataTable,
  ToolsDataTable,
  type PermissionRow,
  type ToolRow,
} from '@/components/info'
import type { LoadedSource, McpToolWithPermission } from '../../shared/types'
import type { PermissionsConfigFile } from '@craft-agent/shared/agent/modes'

interface SourceInfoPageProps {
  sourceSlug: string
  workspaceId: string
  /** Optional callback when source is deleted */
  onDelete?: () => void
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp: number | undefined, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!timestamp) return t('common.never')

  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return t('common.justNow')
  if (minutes < 60) return t('time.minutesAgo', { count: minutes })
  if (hours < 24) return t('time.hoursAgo', { count: hours })
  return t('time.daysAgo', { count: days })
}

function estimateGuideTokens(raw: string | undefined): number {
  if (!raw) return 0
  return Math.ceil(raw.length / 4)
}

function formatApproxTokens(n: number): string {
  if (n >= 1_000_000) return `≈${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `≈${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `≈${n}`
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
 * Convert permissions config to PermissionRow[] for API/local sources
 */
function buildApiPermissionsData(config: PermissionsConfigFile): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Blocked Tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'blocked', type: 'tool', pattern, comment })
  })

  // Allowed Bash Patterns
  config.allowedBashPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'allowed', type: 'bash', pattern, comment })
  })

  // Allowed API Endpoints
  config.allowedApiEndpoints?.forEach((item) => {
    const pattern = `${item.method} ${item.path}`
    const comment = typeof item === 'object' && 'comment' in item ? item.comment : null
    rows.push({ access: 'allowed', type: 'api', pattern, comment })
  })

  return rows
}

/**
 * Convert permissions config to PermissionRow[] for MCP sources
 */
function buildMcpPermissionsData(config: PermissionsConfigFile): PermissionRow[] {
  const rows: PermissionRow[] = []

  // Blocked Tools
  config.blockedTools?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'blocked', type: 'mcp', pattern, comment })
  })

  // Allowed MCP Patterns
  config.allowedMcpPatterns?.forEach((item) => {
    const pattern = typeof item === 'string' ? item : item.pattern
    const comment = typeof item === 'string' ? null : item.comment
    rows.push({ access: 'allowed', type: 'mcp', pattern, comment })
  })

  return rows
}

/**
 * Convert MCP tools to ToolRow[]
 */
function buildToolsData(tools: McpToolWithPermission[]): ToolRow[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    permission: tool.allowed ? 'allowed' : 'requires-permission',
  }))
}

/**
 * Get contextual description for Connection section based on source type
 */
function getConnectionDescription(source: LoadedSource, t: (key: string) => string): string {
  const { type, mcp } = source.config

  if (type === 'mcp') {
    if (mcp?.transport === 'stdio') {
      return t('sourceInfo.localCommand')
    }
    return t('sourceInfo.serverUrl')
  }
  if (type === 'api') {
    return t('sourceInfo.baseUrl')
  }
  if (type === 'local') {
    return t('sourceInfo.filesystemPath')
  }
  return t('sourceInfo.connectionDetails')
}

/**
 * Get contextual description for Permissions section based on source type
 */
function getPermissionsDescription(source: LoadedSource, t: (key: string) => string): string {
  const { type } = source.config

  if (type === 'mcp') {
    return t('sourceInfo.toolPatternsAllowed')
  }
  if (type === 'api') {
    return t('sourceInfo.apiEndpointsAllowed')
  }
  return t('sourceInfo.accessRules')
}

export default function SourceInfoPage({ sourceSlug, workspaceId, onDelete }: SourceInfoPageProps) {
  const { t } = useTranslation()
  const { navigateToSource } = useNavigation()
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfigFile | null>(null)
  const [mcpTools, setMcpTools] = useState<McpToolWithPermission[] | null>(null)
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false)
  const [mcpToolsError, setMcpToolsError] = useState<string | null>(null)
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)

  // Native edit drafts
  const [editName, setEditName] = useState('')
  const [editEnabled, setEditEnabled] = useState(true)
  const [editUrl, setEditUrl] = useState('')
  const [editTagline, setEditTagline] = useState('')
  const [editGuide, setEditGuide] = useState('')
  const [saving, setSaving] = useState(false)
  // Load source data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSource = async () => {
      try {
        const sources = await window.electronAPI.getSources(workspaceId)

        if (!isMounted) return

        const found = sources.find((s) => s.config.slug === sourceSlug)
        if (found) {
          setSource(found)
          setEditName(found.config.name)
          setEditEnabled(found.config.enabled !== false)
          setEditUrl(getSourceUrl(found) ?? '')
          setEditTagline(found.config.tagline ?? '')
          setEditGuide(found.guide?.raw ?? '')

          const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
          if (isMounted) {
            setPermissionsConfig(config)
          }
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : t('sourceInfo.failedToLoad'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSource()

    return () => {
      isMounted = false
    }
  }, [workspaceId, sourceSlug])

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
          setMcpToolsError(result.error || t('sourceInfo.failedToLoadTools'))
        }
      } catch (err) {
        if (!isMounted) return
        setMcpToolsError(err instanceof Error ? err.message : t('sourceInfo.failedToLoadTools'))
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

  // Listen for source folder changes
  useEffect(() => {
    if (!window.electronAPI?.onSourcesChanged) return

    const cleanup = window.electronAPI.onSourcesChanged((changedWorkspaceId, sources) => {
      if (changedWorkspaceId !== workspaceId) return
      const updated = sources.find((s) => s.config.slug === sourceSlug)

      if (updated) {
        setSource(updated)
        setEditName(updated.config.name)
        setEditEnabled(updated.config.enabled !== false)
        setEditUrl(getSourceUrl(updated) ?? '')
        setEditTagline(updated.config.tagline ?? '')
        setEditGuide(updated.guide?.raw ?? '')

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

  // Build data for PermissionsDataTable
  const apiPermissionsData = useMemo(() => {
    if (!permissionsConfig || source?.config.type === 'mcp') return []
    return buildApiPermissionsData(permissionsConfig)
  }, [permissionsConfig, source])

  const mcpPermissionsData = useMemo(() => {
    if (!permissionsConfig || source?.config.type !== 'mcp') return []
    return buildMcpPermissionsData(permissionsConfig)
  }, [permissionsConfig, source])

  // Build data for ToolsDataTable
  const toolsData = useMemo(() => {
    if (!mcpTools) return []
    return buildToolsData(mcpTools)
  }, [mcpTools])

  // Handle opening URL (website or folder)
  const handleOpenUrl = useCallback(async () => {
    if (!source || !sourceUrl) return
    if (window.electronAPI) {
      if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        await window.electronAPI.openUrl(sourceUrl)
      } else {
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

  // Handle deleting source (navigates to source list, preserving current filter)
  const handleDelete = useCallback(async () => {
    if (!source) return
    try {
      await window.electronAPI.deleteSource(workspaceId, sourceSlug)
      toast.success(t('sourceInfo.deletedSource', { name: source.config.name }))
      navigateToSource() // Navigate to source list, preserving filter
      onDelete?.()
    } catch (err) {
      toast.error(t('sourceInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [source, workspaceId, sourceSlug, onDelete, navigateToSource])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://sources/source/${sourceSlug}?window=focused`)
  }, [sourceSlug])

  const handleSaveNative = useCallback(async () => {
    if (!source) return
    const name = editName.trim()
    if (!name) {
      toast.error(t('common.enterName'))
      return
    }
    setSaving(true)
    try {
      const updated = await window.electronAPI.updateSource(workspaceId, sourceSlug, {
        name,
        enabled: editEnabled,
        url: editUrl,
        tagline: editTagline,
        guide: editGuide,
      })
      setSource(updated)
      toast.success(t('sourceInfo.saved'))
    } catch (err) {
      toast.error(t('sourceInfo.saveFailed'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }, [source, editName, editEnabled, editUrl, editTagline, editGuide, workspaceId, sourceSlug, t])

  // Get source name for header
  const sourceName = source?.config.name || sourceSlug

  const askAiTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 px-3 rounded-[6px] bg-background/60 shadow-minimal text-foreground/60 hover:text-foreground"
    >
      {t('common.askAi')}
    </Button>
  )

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!source && !loading && !error ? t('sourceInfo.notFound') : undefined}
    >
      <Info_Page.Header
        title={sourceName}
        titleMenu={
          <SourceMenu
            sourceSlug={sourceSlug}
            sourceName={sourceName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenSourceFolder}
            onDelete={handleDelete}
          />
        }
      />

      {source && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and tagline */}
          <Info_Page.Hero
            avatar={<SourceAvatar source={source} fluid />}
            title={editName || source.config.name}
            tagline={editTagline || source.config.tagline}
          />

          {/* Disabled Warning */}
          {source.config.mcp?.transport === 'stdio' && !localMcpEnabled && (
            <Info_Alert variant="warning" icon={<AlertCircle className="h-4 w-4" />}>
              <Info_Alert.Title>{t('sourceInfo.sourceDisabled')}</Info_Alert.Title>
              <Info_Alert.Description>
                {t('sourceInfo.localMcpDisabled')}
              </Info_Alert.Description>
            </Info_Alert>
          )}

          {/* Connection — native primary editor */}
          <Info_Section
            title={t('sourceInfo.connection')}
            description={getConnectionDescription(source, t)}
            actions={
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3 rounded-[6px]"
                  disabled={saving}
                  onClick={() => void handleSaveNative()}
                >
                  {saving ? t('common.saving') : t('common.save')}
                </Button>
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('source-config', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/config.json`,
                  }}
                />
              </div>
            }
          >
            <div className="space-y-3 px-4 py-3">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('common.name')}</label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 bg-muted/30 border-border/50"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('common.type')}</label>
                <Input
                  value={source.config.type.toUpperCase()}
                  disabled
                  className="h-8 bg-muted/20 border-border/40 opacity-80"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('sourceInfo.urlOrPath')}</label>
                <Input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder={source.config.type === 'local' ? t('common.enterPath') : t('common.url')}
                  className="h-8 bg-muted/30 border-border/50 font-mono text-xs"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('sourceInfo.tagline')}</label>
                <Input
                  value={editTagline}
                  onChange={(e) => setEditTagline(e.target.value)}
                  className="h-8 bg-muted/30 border-border/50"
                />
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="source-enabled">
                  {t('sourceInfo.enabled')}
                </label>
                <Switch
                  id="source-enabled"
                  checked={editEnabled}
                  onCheckedChange={setEditEnabled}
                />
              </div>
              {source.config.connectionError && (
                <div className="flex items-start gap-2 text-sm text-destructive pt-1">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{source.config.connectionError}</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t('sourceInfo.lastTested')}: {formatRelativeTime(source.config.lastTestedAt, t)}
              </p>
            </div>
          </Info_Section>

          {/* Token / size stats (guide chars÷4; local walk deferred) */}
          <Info_Section
            title={t('sourceInfo.tokenStats')}
            description={t('sourceInfo.tokenStatsDesc')}
          >
            <div className="px-4 py-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t('sourceInfo.guideTokens')}</span>
                <span className="tabular-nums font-medium">
                  {t('sourceInfo.approxTokens', {
                    tokens: formatApproxTokens(estimateGuideTokens(editGuide || source.guide?.raw)),
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{t('sourceInfo.guideChars')}</span>
                <span className="tabular-nums">{(editGuide || source.guide?.raw || '').length}</span>
              </div>
            </div>
          </Info_Section>

          {/* Permissions - for API and local sources */}
          {source.config.type !== 'mcp' && permissionsConfig && apiPermissionsData.length > 0 && (
            <Info_Section
              title={t('sourceInfo.permissions')}
              description={getPermissionsDescription(source, t)}
              actions={
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('source-permissions', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <PermissionsDataTable data={apiPermissionsData} fullscreen fullscreenTitle="Permissions" />
            </Info_Section>
          )}

          {/* Tools - for MCP sources */}
          {source.config.type === 'mcp' && (
            <Info_Section
              title={t('sourceInfo.tools')}
              description={t('sourceInfo.toolsDesc')}
              actions={
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('source-tool-permissions', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <ToolsDataTable
                data={toolsData}
                loading={mcpToolsLoading}
                error={mcpToolsError ?? undefined}
              />
            </Info_Section>
          )}

          {/* Permissions - for MCP sources */}
          {source.config.type === 'mcp' && permissionsConfig && mcpPermissionsData.length > 0 && (
            <Info_Section
              title={t('sourceInfo.permissions')}
              description={getPermissionsDescription(source, t)}
              actions={
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('source-permissions', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/permissions.json`,
                  }}
                />
              }
            >
              <PermissionsDataTable data={mcpPermissionsData} hideTypeColumn fullscreen fullscreenTitle="Permissions" />
            </Info_Section>
          )}

          {/* Documentation — always shown, native textarea primary */}
          <Info_Section
            title={t('sourceInfo.documentation')}
            description={t('sourceInfo.documentationDesc')}
            actions={
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3 rounded-[6px]"
                  disabled={saving}
                  onClick={() => void handleSaveNative()}
                >
                  {saving ? t('common.saving') : t('common.save')}
                </Button>
                <EditPopover
                  trigger={askAiTrigger}
                  {...getEditConfig('source-guide', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/guide.md`,
                  }}
                />
              </div>
            }
          >
            <div className="px-4 py-3">
              <Textarea
                value={editGuide}
                onChange={(e) => setEditGuide(e.target.value)}
                rows={12}
                placeholder={t('sourceInfo.docsPlaceholder')}
                className="min-h-[200px] max-h-96 overflow-y-auto bg-muted/30 border-border/50 font-mono text-xs leading-relaxed"
              />
            </div>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
