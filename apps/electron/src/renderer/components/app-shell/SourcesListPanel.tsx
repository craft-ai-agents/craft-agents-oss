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
import { useAppShellContext } from '@/context/AppShellContext'
import { toast } from 'sonner'
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
  workspaceId?: string
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
  workspaceId,
  workspaceRootPath,
  onDeleteSource,
  onSourceClick,
  selectedSourceSlug,
  localMcpEnabled = true,
  className,
}: SourcesListPanelProps) {
  const { workspaces } = useAppShellContext()
  const currentWorkspace = React.useMemo(
    () => workspaces.find(workspace => workspace.id === workspaceId) ?? null,
    [workspaceId, workspaces],
  )
  const canRevealPaths = !currentWorkspace?.isRemote
  const shareDestinations = React.useMemo(() => {
    return workspaces
      .filter(workspace => workspace.id !== workspaceId)
      .map(workspace => ({
        key: workspace.id,
        label: workspace.name,
        description: workspace.isRemote ? `${workspace.remoteServerName || 'Remote server'}` : 'This device',
      }))
  }, [workspaceId, workspaces])

  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return sources
    return sources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [sources, sourceFilter])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      return `No ${SOURCE_TYPE_FILTER_LABELS[sourceFilter.sourceType] ?? sourceFilter.sourceType} sources configured.`
    }
    return 'No sources configured.'
  }, [sourceFilter])

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
          description="Sources connect your agent to external data — MCP servers, REST APIs, and local folders."
          docKey="sources"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  Add Source
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
        const canShareSource = source.config.type !== 'local'
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
              onShowInFinder={canRevealPaths ? () => window.electronAPI.showInFolder(source.folderPath) : undefined}
              shareDestinations={workspaceId && canShareSource ? shareDestinations : []}
              onShare={workspaceId && canShareSource ? async (destinationWorkspaceId) => {
                const result = await window.electronAPI.shareSourceToWorkspace(workspaceId, source.config.slug, destinationWorkspaceId)
                if (!result.success) {
                  toast.error('Failed to share source', {
                    description: result.error || 'Unknown error',
                  })
                  return
                }
                toast.success('Source shared')
              } : undefined}
              onDelete={() => onDeleteSource(source.config.slug)}
            />
          ),
        }
      }}
    />
  )
}
