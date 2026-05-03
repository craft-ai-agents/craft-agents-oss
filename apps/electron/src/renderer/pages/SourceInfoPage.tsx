/**
 * SourceInfoPage
 *
 * Displays source details including connection info, authentication status,
 * documentation (guide.md), and metadata. View-only.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { SourceMenu } from '@/components/app-shell/SourceMenu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { routes, navigate } from '@/lib/navigate'
import { useNavigation } from '@/contexts/NavigationContext'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Alert,
  Info_Markdown,
  PermissionsDataTable,
  ToolsDataTable,
  type PermissionRow,
  type ToolRow,
} from '@/components/info'
import type { LoadedSource, McpToolWithPermission, SourceCredentialScopeResult } from '../../shared/types'
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

function getSourceTierLabel(source: LoadedSource, t: (key: string) => string): string {
  switch (source.tier) {
    case 'global':
      return t('sourcesList.tier.global')
    case 'global-dormant':
      return t('sourcesList.tier.dormant')
    case 'project':
      return t('sourcesList.tier.project')
    case 'workspace':
    default:
      return t('sourcesList.tier.workspace')
  }
}

function getCredentialScopeLabel(
  source: LoadedSource,
  credentialScope: SourceCredentialScopeResult | null,
  t: (key: string) => string,
): string {
  if (source.tier === 'global-dormant') return t('sourceInfo.credsScope.inactive')

  switch (credentialScope?.scope) {
    case 'no-auth':
      return t('sourceInfo.credsScope.noAuth')
    case 'global':
      return t('sourceInfo.credsScope.global')
    case 'workspace-override':
      return t('sourceInfo.credsScope.workspaceOverride')
    case 'workspace-override-empty':
      return t('sourceInfo.credsScope.workspaceOverrideEmpty')
    case 'workspace':
      return t('sourceInfo.credsScope.workspace')
    case 'none':
      return t('sourceInfo.credsScope.none')
    case 'inactive':
      return t('sourceInfo.credsScope.inactive')
    default:
      if (source.tier === 'global') return t('sourceInfo.credsScope.globalFallback')
      return t('sourceInfo.credsScope.workspace')
  }
}

type CredentialDialogMode = 'global' | 'override' | 'revert'

interface SourceCredentialDialogProps {
  open: boolean
  mode: CredentialDialogMode
  source: LoadedSource
  workspaceId: string
  sourceSlug: string
  credentialScope: SourceCredentialScopeResult | null
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

function SourceCredentialDialog({
  open,
  mode,
  source,
  workspaceId,
  sourceSlug,
  credentialScope,
  onOpenChange,
  onComplete,
}: SourceCredentialDialogProps) {
  const { t } = useTranslation()
  const [credential, setCredential] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const usesOAuth = Boolean(credentialScope?.usesOAuth)

  useEffect(() => {
    if (!open) setCredential('')
  }, [open])

  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const handleOverride = useCallback(async () => {
    if (!usesOAuth && !credential.trim()) return
    setSubmitting(true)
    try {
      if (mode === 'global') {
        if (usesOAuth) {
          const result = await window.electronAPI.performOAuth({ sourceSlug, credentialScope: 'global' })
          if (!result.success) {
            throw new Error(result.error || t('sourceInfo.credentialDialog.oauthFailed'))
          }
        } else {
          await window.electronAPI.saveSourceGlobalCredentials(workspaceId, sourceSlug, credential.trim())
        }
      } else if (usesOAuth) {
        const result = await window.electronAPI.performOAuth({ sourceSlug, credentialScope: 'workspace-override' })
        if (!result.success) {
          throw new Error(result.error || t('sourceInfo.credentialDialog.oauthFailed'))
        }
      } else {
        await window.electronAPI.saveSourceCredentialOverride(workspaceId, sourceSlug, credential.trim())
      }
      toast.success(t('sourceInfo.credentialDialog.saved'))
      onComplete()
      close()
    } catch (err) {
      toast.error(t('sourceInfo.credentialDialog.failedToSave'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }, [close, credential, mode, onComplete, sourceSlug, t, usesOAuth, workspaceId])

  const handleRevert = useCallback(async () => {
    setSubmitting(true)
    try {
      await window.electronAPI.clearSourceCredentialOverride(workspaceId, sourceSlug)
      toast.success(t('sourceInfo.credentialDialog.reverted'))
      onComplete()
      close()
    } catch (err) {
      toast.error(t('sourceInfo.credentialDialog.failedToRevert'), {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSubmitting(false)
    }
  }, [close, onComplete, sourceSlug, t, workspaceId])

  const isGlobal = mode === 'global'
  const isRevert = mode === 'revert'
  const title = isRevert
    ? t('sourceInfo.credentialDialog.revertTitle')
    : isGlobal
      ? t('sourceInfo.credentialDialog.globalTitle', { name: source.config.name })
      : t('sourceInfo.credentialDialog.overrideTitle', { name: source.config.name })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isRevert
              ? t('sourceInfo.credentialDialog.revertDescription')
              : usesOAuth
                ? isGlobal
                  ? t('sourceInfo.credentialDialog.globalOAuthDescription')
                  : t('sourceInfo.credentialDialog.oauthDescription')
                : isGlobal
                  ? t('sourceInfo.credentialDialog.globalManualDescription')
                  : t('sourceInfo.credentialDialog.manualDescription')}
          </DialogDescription>
        </DialogHeader>

        {!isRevert && !usesOAuth && (
          <div className="grid gap-2">
            <Label htmlFor="source-credential">{t('sourceInfo.credentialDialog.credentialLabel')}</Label>
            <Input
              id="source-credential"
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={t('sourceInfo.credentialDialog.credentialPlaceholder')}
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          {isRevert ? (
            <Button type="button" onClick={handleRevert} disabled={submitting}>
              {t('sourceInfo.credentialDialog.revertConfirm')}
            </Button>
          ) : (
            <Button type="button" onClick={handleOverride} disabled={submitting || (!usesOAuth && !credential.trim())}>
              {usesOAuth ? t('sourceInfo.credentialDialog.continueOAuth') : t('common.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
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
  const [credentialScope, setCredentialScope] = useState<SourceCredentialScopeResult | null>(null)
  const [credentialDialogMode, setCredentialDialogMode] = useState<CredentialDialogMode | null>(null)
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const loadSource = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)

    try {
      const [sources, globalSources, enabledGlobalSlugs] = await Promise.all([
        window.electronAPI.getSources(workspaceId),
        window.electronAPI.listGlobalSources(),
        window.electronAPI.getEnabledGlobalSources(workspaceId),
      ])

      if (!isMountedRef.current) return

      const activeSlugs = new Set((sources || []).map((s) => s.config.slug))
      const enabledSlugs = new Set(enabledGlobalSlugs || [])
      const found = (sources || []).find((s) => s.config.slug === sourceSlug)
        ?? (globalSources || [])
          .filter((s) => !activeSlugs.has(s.config.slug))
          .map((s) => ({ ...s, tier: enabledSlugs.has(s.config.slug) ? 'global' as const : 'global-dormant' as const }))
          .find((s) => s.config.slug === sourceSlug)

      if (found) {
        setSource(found)

        if (found.tier !== 'global-dormant') {
          const [config, nextCredentialScope] = await Promise.all([
            window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug),
            window.electronAPI.getSourceCredentialScope(workspaceId, sourceSlug),
          ])
          if (isMountedRef.current) {
            setPermissionsConfig(config)
            setCredentialScope(nextCredentialScope)
          }
        } else if (isMountedRef.current) {
          setPermissionsConfig(null)
          setCredentialScope(null)
        }
      } else {
        setSource(null)
        setPermissionsConfig(null)
        setCredentialScope(null)
        setError(t('sourceInfo.notFound'))
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setError(err instanceof Error ? err.message : t('sourceInfo.failedToLoad'))
    } finally {
      if (isMountedRef.current && showLoading) setLoading(false)
    }
  }, [workspaceId, sourceSlug, t])

  // Load source data
  useEffect(() => {
    void loadSource(true)
  }, [loadSource])

  // Load MCP tools when source is loaded and is MCP type
  useEffect(() => {
    if (!source || source.config.type !== 'mcp' || source.tier === 'global-dormant') {
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
  }, [source, workspaceId, sourceSlug, t])

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

    const cleanup = window.electronAPI.onSourcesChanged((changedWorkspaceId) => {
      if (changedWorkspaceId !== workspaceId) return
      void loadSource(false)
    })

    return cleanup
  }, [loadSource, workspaceId])

  // Listen for global source activation/library changes
  useEffect(() => {
    if (!window.electronAPI?.onGlobalSourcesChanged) return

    const cleanup = window.electronAPI.onGlobalSourcesChanged((changedWorkspaceId) => {
      if (changedWorkspaceId && changedWorkspaceId !== workspaceId) return
      void loadSource(false)
    })

    return cleanup
  }, [loadSource, workspaceId])

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
  }, [source, workspaceId, sourceSlug, onDelete, navigateToSource, t])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://sources/source/${sourceSlug}?window=focused`)
  }, [sourceSlug])

  const handleCredentialDialogComplete = useCallback(() => {
    void loadSource(false)
  }, [loadSource])

  // Get source name for header
  const sourceName = source?.config.name || sourceSlug

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
            onSetGlobalCredentials={credentialScope?.canAuthenticate && source?.tier === 'global' ? () => setCredentialDialogMode('global') : undefined}
            onUseWorkspaceCredentials={credentialScope?.canOverride ? () => setCredentialDialogMode('override') : undefined}
            onRevertGlobalCredentials={credentialScope?.canRevert ? () => setCredentialDialogMode('revert') : undefined}
            canDelete={(source?.tier ?? 'workspace') === 'workspace'}
            deleteLabel={(source?.tier ?? 'workspace') === 'workspace' ? undefined : t('sourcesList.managedSource')}
          />
        }
      />

      {source && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and tagline */}
          <Info_Page.Hero
            avatar={<SourceAvatar source={source} fluid />}
            title={source.config.name}
            tagline={source.config.tagline}
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

          {/* Connection */}
          <Info_Section
            title={t('sourceInfo.connection')}
            description={getConnectionDescription(source, t)}
            actions={
              // EditPopover for AI-assisted config.json editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('source-config', source.folderPath)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${source.folderPath}/config.json`,
                }}
              />
            }
          >
            <Info_Table
              footer={source.config.connectionError && (
                <div className="px-4 py-2 border-t border-border/30 bg-destructive/5">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{source.config.connectionError}</span>
                  </div>
                </div>
              )}
            >
              <Info_Table.Row label={t('common.type')} value={source.config.type.toUpperCase()} />
              <Info_Table.Row label={t('sourceInfo.tier')} value={getSourceTierLabel(source, t)} />
              <Info_Table.Row label={t('sourceInfo.credsScope')} value={getCredentialScopeLabel(source, credentialScope, t)} />
              {sourceUrl && (
                <Info_Table.Row label={t('common.url')}>
                  <button
                    onClick={handleOpenUrl}
                    className="truncate hover:underline text-foreground focus:outline-none focus-visible:underline text-left block w-full"
                  >
                    {sourceUrl}
                  </button>
                </Info_Table.Row>
              )}
              <Info_Table.Row label={t('sourceInfo.lastTested')} value={formatRelativeTime(source.config.lastTestedAt, t)} />
            </Info_Table>
          </Info_Section>

          {/* Permissions - for API and local sources */}
          {source.config.type !== 'mcp' && permissionsConfig && apiPermissionsData.length > 0 && (
            <Info_Section
              title={t('sourceInfo.permissions')}
              description={getPermissionsDescription(source, t)}
              actions={
                // EditPopover for AI-assisted permissions.json editing
                <EditPopover
                  trigger={<EditButton />}
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
                // EditPopover for AI-assisted tool permissions editing
                <EditPopover
                  trigger={<EditButton />}
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
                // EditPopover for AI-assisted permissions.json editing
                <EditPopover
                  trigger={<EditButton />}
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

          {/* Documentation */}
          {source.guide?.raw && (
            <Info_Section
              title={t('sourceInfo.documentation')}
              description={t('sourceInfo.documentationDesc')}
              actions={
                // EditPopover for AI-assisted guide.md editing with "Edit File" as secondary action
                <EditPopover
                  trigger={<EditButton />}
                  {...getEditConfig('source-guide', source.folderPath)}
                  secondaryAction={{
                    label: t('common.editFile'),
                    filePath: `${source.folderPath}/guide.md`,
                  }}
                />
              }
            >
              <Info_Markdown maxHeight={540} fullscreen>
                {source.guide.raw}
              </Info_Markdown>
            </Info_Section>
          )}

          {credentialDialogMode && (
            <SourceCredentialDialog
              open={Boolean(credentialDialogMode)}
              mode={credentialDialogMode}
              source={source}
              workspaceId={workspaceId}
              sourceSlug={sourceSlug}
              credentialScope={credentialScope}
              onOpenChange={(open) => {
                if (!open) setCredentialDialogMode(null)
              }}
              onComplete={handleCredentialDialogComplete}
            />
          )}
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
