import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseZap, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { sourceSelection } from '@/hooks/useEntitySelection'
import { SourceMenu } from './SourceMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import { cn } from '@/lib/utils'
import type { LoadedSource, SourceConnectionStatus, SourceFilter } from '../../../shared/types'
const SOURCE_TYPE_CONFIG: Record<string, { labelKey: string; colorClass: string }> = {
  mcp: { labelKey: 'sourcesList.typeMcp', colorClass: 'bg-accent/10 text-accent' },
  api: { labelKey: 'sourcesList.typeApi', colorClass: 'bg-success/10 text-success' },
  local: { labelKey: 'sourcesList.typeLocal', colorClass: 'bg-info/10 text-info' },
}

const SOURCE_STATUS_CONFIG: Record<string, { labelKey: string; colorClass: string } | null> = {
  connected: null,
  needs_auth: { labelKey: 'sourcesList.statusAuthRequired', colorClass: 'bg-warning/10 text-warning' },
  failed: { labelKey: 'sourcesList.statusDisconnected', colorClass: 'bg-destructive/10 text-destructive' },
  untested: { labelKey: 'sourcesList.statusNotTested', colorClass: 'bg-foreground/10 text-foreground/50' },
  local_disabled: { labelKey: 'sourcesList.statusDisabled', colorClass: 'bg-foreground/10 text-foreground/50' },
}

function estimateTokensFromGuide(raw: string | undefined): number {
  if (!raw) return 0
  return Math.ceil(raw.length / 4)
}

function formatApproxTokens(n: number): string {
  if (n >= 1_000_000) return `≈${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `≈${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `≈${n}`
}

const SOURCE_TYPE_FILTER_LABEL_KEYS: Record<string, string> = {
  api: 'sourcesList.filterApi',
  mcp: 'sourcesList.filterMcp',
  local: 'sourcesList.filterLocalFolder',
}

export interface SourcesListPanelProps {
  sources: LoadedSource[]
  sourceFilter?: SourceFilter | null
  workspaceRootPath?: string
  onDeleteSource: (sourceSlug: string) => void
  onSourceClick: (source: LoadedSource) => void
  selectedSourceSlug?: string | null
  localMcpEnabled?: boolean
  className?: string
}

export function SourcesListPanel({
  sources,
  sourceFilter,
  workspaceRootPath,
  onDeleteSource,
  onSourceClick,
  selectedSourceSlug,
  localMcpEnabled = true,
  className,
}: SourcesListPanelProps) {
  const { t } = useTranslation()
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')
  const [indexFileCount, setIndexFileCount] = React.useState<number | null>(null)
  const [reindexing, setReindexing] = React.useState(false)

  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return sources
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      const filterLabelKey = SOURCE_TYPE_FILTER_LABEL_KEYS[sourceFilter.sourceType]
      const filterLabel = filterLabelKey ? t(filterLabelKey) : sourceFilter.sourceType
      return t('sourcesList.noSourcesOfType', { type: filterLabel })
    }
    return t('sourcesList.noSourcesConfigured')
  }, [sourceFilter, t])

  const handleReindex = React.useCallback(async () => {
    if (!activeWorkspaceId || reindexing) return
    if (typeof window.electronAPI.reindexSources !== 'function') {
      toast.error(t('sourcesList.reindexUnavailable'))
      return
    }
    setReindexing(true)
    try {
      const result = await window.electronAPI.reindexSources(activeWorkspaceId)
      setIndexFileCount(result.indexed)
      toast.success(
        t('sourcesList.reindexDone', {
          count: result.indexed,
          indexed: result.indexed,
        }),
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('sourcesList.reindexFailed', { error: msg }))
    } finally {
      setReindexing(false)
    }
  }, [activeWorkspaceId, reindexing, t])

  return (
    <>
    <div className="flex items-center justify-end gap-2 px-3 pt-2 pb-1">
      {indexFileCount != null && (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {t('sourcesList.indexHitCount', { count: indexFileCount })}
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleReindex()}
        disabled={reindexing || !activeWorkspaceId}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-[8px] border border-border/50 bg-background px-2.5',
          'text-[11px] font-medium text-muted-foreground shadow-minimal',
          'hover:bg-foreground/[0.03] hover:text-foreground disabled:opacity-50',
        )}
        title={t('sourcesList.reindexHint')}
      >
        <RefreshCw className={cn('h-3 w-3', reindexing && 'animate-spin')} />
        {reindexing ? t('sourcesList.reindexing') : t('sourcesList.reindex')}
      </button>
    </div>
    <EntityPanel<LoadedSource>
      items={filteredSources}
      getId={(s) => s.config.slug}
      selection={sourceSelection}
      selectedId={selectedSourceSlug}
      onItemClick={onSourceClick}
      className={className}
      containerProps={{ 'data-list-role': 'sources' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<DatabaseZap />}
          title={emptyMessage}
          description={t('sourcesList.emptyDescription')}
          docKey="sources"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  {t('sourcesList.addSource')}
                </button>
              }
              {...getEditConfig(
                sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                workspaceRootPath
              )}
            />
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(source) => {
        const connectionStatus = deriveConnectionStatus(source, localMcpEnabled)
        const typeConfig = SOURCE_TYPE_CONFIG[source.config.type]
        const statusConfig = SOURCE_STATUS_CONFIG[connectionStatus]
        const subtitle = source.config.tagline || source.config.provider || ''
        return {
          icon: <SourceAvatar source={source} size="sm" />,
          title: source.config.name,
          badges: (
            <>
              {typeConfig && <EntityListBadge colorClass={typeConfig.colorClass}>{t(typeConfig.labelKey)}</EntityListBadge>}
              {statusConfig && (
                <EntityListBadge colorClass={statusConfig.colorClass} tooltip={source.config.connectionError || undefined} className="cursor-default">
                  {t(statusConfig.labelKey)}
                </EntityListBadge>
              )}
              {(() => {
                const tokens = estimateTokensFromGuide(source.guide?.raw)
                if (tokens <= 0) return null
                return (
                  <EntityListBadge colorClass="bg-foreground/5 text-foreground/55" className="cursor-default tabular-nums">
                    {t('sourcesList.tokenEstimate', { tokens: formatApproxTokens(tokens) })}
                  </EntityListBadge>
                )
              })()}
              {subtitle && <span className="truncate">{subtitle}</span>}
            </>
          ),
          menu: (
            <SourceMenu
              sourceSlug={source.config.slug}
              sourceName={source.config.name}
              onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://sources/source/${source.config.slug}?window=focused`)}
              onShowInFinder={() => window.electronAPI.showInFolder(source.folderPath)}
              onDelete={() => onDeleteSource(source.config.slug)}
              onSendToWorkspace={hasOtherWorkspaces ? () => {
                setSendResourceSlug(source.config.slug)
                setSendResourceLabel(source.config.name)
                setSendDialogOpen(true)
              } : undefined}
            />
          ),
        }
      }}
    />

    {/* Send to Workspace dialog */}
    {sendResourceSlug && (
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType="source"
        resourceIds={[sendResourceSlug]}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />
    )}
    </>
  )
}
