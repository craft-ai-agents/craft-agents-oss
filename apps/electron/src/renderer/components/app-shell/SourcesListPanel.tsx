import * as React from 'react'
import { DatabaseZap } from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { sourceSelection } from '@/hooks/useEntitySelection'
import { SourceMenu } from './SourceMenu'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import { useTranslations } from '@/i18n'
import type { LoadedSource, SourceConnectionStatus, SourceFilter } from '../../../shared/types'

const SOURCE_TYPE_CONFIG: Record<string, { label: string; colorClass: string }> = {
  mcp: { label: 'MCP', colorClass: 'bg-accent/10 text-accent' },
  api: { label: 'API', colorClass: 'bg-success/10 text-success' },
  local: { label: 'Local', colorClass: 'bg-info/10 text-info' },
}

const SOURCE_STATUS_CONFIG: Record<string, { label: string; colorClass: string } | null> = {
  connected: null,
  needs_auth: { label: 'Auth Required', colorClass: 'bg-warning/10 text-warning' },
  failed: { label: 'Disconnected', colorClass: 'bg-destructive/10 text-destructive' },
  untested: { label: 'Not Tested', colorClass: 'bg-foreground/10 text-foreground/50' },
  local_disabled: { label: 'Disabled', colorClass: 'bg-foreground/10 text-foreground/50' },
}

const SOURCE_TYPE_FILTER_LABELS: Record<string, string> = {
  api: 'API',
  mcp: 'MCP',
  local: 'local folder',
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
  const { t } = useTranslations()
  
  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return sources
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      if (sourceFilter.sourceType === 'api') {
        return t('common.noApiSourcesConfigured', 'No API sources configured.')
      } else if (sourceFilter.sourceType === 'mcp') {
        return t('common.noMcpSourcesConfigured', 'No MCP sources configured.')
      } else if (sourceFilter.sourceType === 'local') {
        return t('common.noLocalFolderSourcesConfigured', 'No local folder sources configured.')
      }
      return `No ${SOURCE_TYPE_FILTER_LABELS[sourceFilter.sourceType] ?? sourceFilter.sourceType} sources configured.`
    }
    return t('common.noSourcesConfigured', 'No sources configured.')
  }, [sourceFilter, t])

  const translatedSourceStatusConfig = React.useMemo(() => ({
    ...SOURCE_STATUS_CONFIG,
    needs_auth: SOURCE_STATUS_CONFIG.needs_auth ? { ...SOURCE_STATUS_CONFIG.needs_auth, label: t('common.authRequired', 'Auth Required') } : null,
    failed: SOURCE_STATUS_CONFIG.failed ? { ...SOURCE_STATUS_CONFIG.failed, label: t('common.disconnected', 'Disconnected') } : null,
    untested: SOURCE_STATUS_CONFIG.untested ? { ...SOURCE_STATUS_CONFIG.untested, label: t('common.notTested', 'Not Tested') } : null,
    local_disabled: SOURCE_STATUS_CONFIG.local_disabled ? { ...SOURCE_STATUS_CONFIG.local_disabled, label: t('common.disabled', 'Disabled') } : null,
  }), [t])

  return (
    <EntityPanel<LoadedSource>
      items={filteredSources}
      getId={(s) => s.config.slug}
      selection={sourceSelection}
      selectedId={selectedSourceSlug}
      onItemClick={onSourceClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<DatabaseZap />}
          title={emptyMessage}
          description={t('common.sourcesDescription', 'Sources connect your agent to external data — MCP servers, REST APIs, and local folders.')}
          docKey="sources"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  {t('common.addSource', 'Add Source')}
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
        const statusConfig = translatedSourceStatusConfig[connectionStatus]
        const subtitle = source.config.tagline || source.config.provider || ''
        return {
          icon: <SourceAvatar source={source} size="sm" />,
          title: source.config.name,
          badges: (
            <>
              {typeConfig && <EntityListBadge colorClass={typeConfig.colorClass}>{typeConfig.label}</EntityListBadge>}
              {statusConfig && (
                <EntityListBadge colorClass={statusConfig.colorClass} tooltip={source.config.connectionError || undefined} className="cursor-default">
                  {statusConfig.label}
                </EntityListBadge>
              )}
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
            />
          ),
        }
      }}
    />
  )
}
