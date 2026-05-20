import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, ChevronDown, ChevronRight, DatabaseZap, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { deriveConnectionStatus } from '@/components/ui/source-status-indicator'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { sourceSelection } from '@/hooks/useEntitySelection'
import { SourceMenu } from './SourceMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { useAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig, type EditContextKey } from '@/components/ui/EditPopover'
import type { LoadedSource, SourceConnectionStatus, SourceFilter, SourceTier } from '../../../shared/types'

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

const SOURCE_TYPE_FILTER_LABEL_KEYS: Record<string, string> = {
  api: 'sourcesList.filterApi',
  mcp: 'sourcesList.filterMcp',
  local: 'sourcesList.filterLocalFolder',
}

const SOURCE_TIER_CONFIG: Record<SourceTier, { labelKey: string; colorClass: string }> = {
  workspace: { labelKey: 'sourcesList.tier.workspace', colorClass: 'bg-foreground/5 text-muted-foreground' },
  global: { labelKey: 'sourcesList.tier.global', colorClass: 'bg-info/10 text-info' },
  'global-dormant': { labelKey: 'sourcesList.tier.dormant', colorClass: 'bg-foreground/10 text-foreground/50' },
  project: { labelKey: 'sourcesList.tier.project', colorClass: 'bg-accent/10 text-accent' },
}

type SourceCategory = 'Local tools' | 'MCP tools' | 'Data & APIs' | 'Other'

function getSourceCategory(source: LoadedSource): SourceCategory {
  const text = [
    source.config.slug,
    source.config.name,
    source.config.type,
    source.config.provider,
    source.config.tagline,
  ].filter(Boolean).join(' ').toLowerCase()

  if (source.config.type === 'local' || text.includes('local') || text.includes('filesystem') || text.includes('bash') || text.includes('computer')) return 'Local tools'
  if (source.config.type === 'mcp' || text.includes('mcp')) return 'MCP tools'
  if (source.config.type === 'api' || text.includes('api') || text.includes('exa') || text.includes('search') || text.includes('ads') || text.includes('data')) return 'Data & APIs'
  return 'Other'
}

function groupSourcesByCategory(sources: LoadedSource[]) {
  const order: SourceCategory[] = ['Local tools', 'MCP tools', 'Data & APIs', 'Other']
  const grouped = new Map<SourceCategory, LoadedSource[]>()
  for (const category of order) grouped.set(category, [])
  for (const source of sources) grouped.get(getSourceCategory(source))?.push(source)

  return order
    .map((category) => ({
      category,
      items: (grouped.get(category) ?? []).slice().sort((a, b) => a.config.name.localeCompare(b.config.name)),
    }))
    .filter((group) => group.items.length > 0)
}

export interface SourcesListPanelProps {
  sources: LoadedSource[]
  workspaceId?: string
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
  workspaceId,
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
  const [globalSources, setGlobalSources] = React.useState<LoadedSource[]>([])
  const [enabledGlobalSlugs, setEnabledGlobalSlugs] = React.useState<Set<string>>(new Set())
  const [globalSourcesReady, setGlobalSourcesReady] = React.useState(false)
  const [libraryOpen, setLibraryOpen] = React.useState(false)
  const [updatingSlug, setUpdatingSlug] = React.useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = React.useState<Set<string>>(() => new Set())

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  const toggleCategory = React.useCallback((category: string) => {
    setCollapsedCategories((current) => {
      const next = new Set(current)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }, [])

  const reloadGlobalSources = React.useCallback(async () => {
    if (!workspaceId) {
      setGlobalSources([])
      setEnabledGlobalSlugs(new Set())
      setGlobalSourcesReady(false)
      return
    }
    setGlobalSourcesReady(false)
    try {
      const [loadedGlobalSources, loadedEnabledSlugs] = await Promise.all([
        window.electronAPI.listGlobalSources(),
        window.electronAPI.getEnabledGlobalSources(workspaceId),
      ])
      setGlobalSources(loadedGlobalSources || [])
      setEnabledGlobalSlugs(new Set(loadedEnabledSlugs || []))
      setGlobalSourcesReady(true)
    } catch (error) {
      console.error('[Sources] Failed to load global sources:', error)
      setGlobalSources([])
      setEnabledGlobalSlugs(new Set())
      setGlobalSourcesReady(false)
    }
  }, [workspaceId])

  React.useEffect(() => {
    void reloadGlobalSources()
  }, [reloadGlobalSources])

  React.useEffect(() => {
    if (!window.electronAPI?.onGlobalSourcesChanged) return
    return window.electronAPI.onGlobalSourcesChanged((changedWorkspaceId) => {
      if (changedWorkspaceId && changedWorkspaceId !== workspaceId) return
      void reloadGlobalSources()
    })
  }, [reloadGlobalSources, workspaceId])

  const globalSlugSet = React.useMemo(
    () => new Set(globalSources.map((source) => source.config.slug)),
    [globalSources]
  )

  const effectiveSources = React.useMemo(() => {
    const activeSlugs = new Set(sources.map((source) => source.config.slug))
    const visibleGlobals = globalSources
      .filter((source) => !activeSlugs.has(source.config.slug))
      .map((source) => ({
        ...source,
        tier: enabledGlobalSlugs.has(source.config.slug) ? 'global' as const : 'global-dormant' as const,
      }))

    return [...sources, ...visibleGlobals]
  }, [enabledGlobalSlugs, globalSources, sources])

  const filteredSources = React.useMemo(() => {
    if (!sourceFilter) return effectiveSources
    return effectiveSources.filter(s => s.config.type === sourceFilter.sourceType)
  }, [effectiveSources, sourceFilter])
  const groupedFilteredSources = React.useMemo(() => groupSourcesByCategory(filteredSources), [filteredSources])

  const handleToggleGlobal = React.useCallback(async (source: LoadedSource, enabled: boolean) => {
    if (!workspaceId) return
    setUpdatingSlug(source.config.slug)
    try {
      const next = await window.electronAPI.setGlobalSourceEnabled(workspaceId, source.config.slug, enabled)
      setEnabledGlobalSlugs(new Set(next || []))
      await reloadGlobalSources()
      toast.success(enabled ? t('sourcesList.activated') : t('sourcesList.deactivated'))
    } catch (error) {
      console.error('[Sources] Failed to update global source:', error)
      toast.error(t('sourcesList.updateFailed'))
    } finally {
      setUpdatingSlug(null)
    }
  }, [reloadGlobalSources, t, workspaceId])

  const handlePromoteToGlobal = React.useCallback(async (source: LoadedSource) => {
    if (!workspaceId) return
    setUpdatingSlug(source.config.slug)
    try {
      await window.electronAPI.promoteSourceToGlobal(workspaceId, source.config.slug, { includeCredentials: false })
      await reloadGlobalSources()
      toast.success(t('sourcesList.promoted'))
    } catch (error) {
      console.error('[Sources] Failed to promote source:', error)
      toast.error(t('sourcesList.promoteFailed'))
    } finally {
      setUpdatingSlug(null)
    }
  }, [reloadGlobalSources, t, workspaceId])

  const emptyMessage = React.useMemo(() => {
    if (sourceFilter?.kind === 'type') {
      const filterLabelKey = SOURCE_TYPE_FILTER_LABEL_KEYS[sourceFilter.sourceType]
      const filterLabel = filterLabelKey ? t(filterLabelKey) : sourceFilter.sourceType
      return t('sourcesList.noSourcesOfType', { type: filterLabel })
    }
    return t('sourcesList.noSourcesConfigured')
  }, [sourceFilter, t])

  return (
    <>
      <div className={className ? `flex min-h-0 flex-1 flex-col ${className}` : 'flex min-h-0 flex-1 flex-col'}>
        {className?.includes('runneros-library-grid') ? (
          <div className="runneros-glass-route min-h-0 flex-1 overflow-y-auto px-8 py-8">
            <div className="mb-7 flex items-start justify-between gap-4">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#fdba74]">
                  <DatabaseZap className="h-3.5 w-3.5" />
                  Tool layer
                </div>
                <h1 className="text-[28px] font-semibold leading-tight text-white">{t('sidebar.tools')}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Connected tools and data channels available to the workspace.</p>
              </div>
              <div className="flex items-center gap-2">
                {workspaceRootPath && (
                  <EditPopover
                    align="end"
                    trigger={
                      <button
                        type="button"
                        className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.045] px-3 text-xs font-medium text-white/76 transition-colors hover:bg-white/[0.08] hover:text-white"
                      >
                        <Plus className="size-3.5" />
                        Add tool
                      </button>
                    }
                    {...getEditConfig(
                      sourceFilter?.kind === 'type' ? `add-source-${sourceFilter.sourceType}` as EditContextKey : 'add-source',
                      workspaceRootPath
                    )}
                  />
                )}
                {workspaceId && (
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[#fb923c]/30 bg-[#f97316]/18 px-3 text-xs font-medium text-white shadow-[0_0_24px_rgba(249,115,22,0.20)] transition-colors hover:bg-[#f97316]/26"
                    title={t('sourcesList.browseGlobal')}
                  >
                    <BookOpen className="size-3.5" />
                    {t('sourcesList.library')}
                  </button>
                )}
              </div>
            </div>

            {filteredSources.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-white/[0.12] bg-white/[0.03] p-8 text-center text-sm text-white/55">
                {emptyMessage}
              </div>
            ) : (
              <div className="space-y-5">
                {groupedFilteredSources.map((group) => {
                  const collapsed = collapsedCategories.has(group.category)

                  return (
                  <section key={group.category}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(group.category)}
                      className="mb-2 flex w-full items-center gap-2.5 text-left"
                      aria-expanded={!collapsed}
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3 w-3 shrink-0 text-white/30" />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0 text-white/30" />
                      )}
                      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/42">{group.category}</h2>
                      <div className="h-px flex-1 bg-white/[0.06]" />
                      <span className="text-[11px] text-white/32">{group.items.length}</span>
                    </button>
                    {!collapsed && (
                    <div className="grid grid-cols-1 gap-2 min-[520px]:grid-cols-3">
                      {group.items.map((source) => {
                  const connectionStatus = deriveConnectionStatus(source, localMcpEnabled)
                  const typeConfig = SOURCE_TYPE_CONFIG[source.config.type]
                  const statusConfig = source.tier === 'global-dormant' ? null : SOURCE_STATUS_CONFIG[connectionStatus]
                  const tierConfig = SOURCE_TIER_CONFIG[source.tier ?? 'workspace']
                  const subtitle = source.config.tagline || source.config.provider || source.config.slug
                  const isWorkspaceSource = (source.tier ?? 'workspace') === 'workspace'
                  const isGlobalSource = source.tier === 'global'
                  const isDormantGlobal = source.tier === 'global-dormant'
                  const canPromote = globalSourcesReady && isWorkspaceSource && !globalSlugSet.has(source.config.slug)

                  return (
                    <div key={source.config.slug} className="group relative min-h-[78px] overflow-hidden rounded-[11px] border border-white/[0.075] bg-white/[0.035] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#fb923c]/35 hover:bg-white/[0.06] hover:shadow-[0_12px_34px_rgba(0,0,0,0.28),0_0_22px_rgba(249,115,22,0.10)]">
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#fb923c]/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                      <button type="button" onClick={() => onSourceClick(source)} className="flex w-full items-start gap-2 text-left">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border border-white/[0.08] bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                          <SourceAvatar source={source} size="sm" />
                        </div>
                        <div className="min-w-0 flex-1 pr-6">
                          <div className="truncate text-[12px] font-semibold text-white">{source.config.name}</div>
                          <p className="mt-1 line-clamp-2 text-[9.5px] leading-3.5 text-white/44">{subtitle}</p>
                        </div>
                      </button>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {typeConfig && <span className={`rounded-[6px] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.10em] ${typeConfig.colorClass}`}>{t(typeConfig.labelKey)}</span>}
                        {tierConfig && <span className={`rounded-[6px] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.10em] ${tierConfig.colorClass}`}>{t(tierConfig.labelKey)}</span>}
                        {statusConfig && <span className={`rounded-[6px] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.10em] ${statusConfig.colorClass}`}>{t(statusConfig.labelKey)}</span>}
                      </div>
                      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <SourceMenu
                          sourceSlug={source.config.slug}
                          sourceName={source.config.name}
                          onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://sources/source/${source.config.slug}?window=focused`)}
                          onShowInFinder={source.folderPath ? () => window.electronAPI.showInFolder(source.folderPath) : undefined}
                          onDelete={() => onDeleteSource(source.config.slug)}
                          canDelete={isWorkspaceSource}
                          deleteLabel={isWorkspaceSource ? undefined : t('sourcesList.managedSource')}
                          onActivateGlobal={isDormantGlobal ? () => void handleToggleGlobal(source, true) : undefined}
                          onDeactivateGlobal={isGlobalSource ? () => void handleToggleGlobal(source, false) : undefined}
                          onPromoteToGlobal={canPromote ? () => void handlePromoteToGlobal(source) : undefined}
                          onSendToWorkspace={hasOtherWorkspaces && isWorkspaceSource ? () => {
                            setSendResourceSlug(source.config.slug)
                            setSendResourceLabel(source.config.name)
                            setSendDialogOpen(true)
                          } : undefined}
                        />
                      </div>
                    </div>
                  )
                      })}
                    </div>
                    )}
                  </section>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
        <>
        {workspaceId && (
          <div className="flex shrink-0 items-center justify-end px-2 py-1">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-foreground"
              title={t('sourcesList.browseGlobal')}
            >
              <BookOpen className="size-3.5" />
              {t('sourcesList.library')}
            </button>
          </div>
        )}
    <EntityPanel<LoadedSource>
      items={filteredSources}
      getId={(s) => s.config.slug}
      selection={sourceSelection}
      selectedId={selectedSourceSlug}
      onItemClick={onSourceClick}
      className="min-h-0 flex-1"
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
        const statusConfig = source.tier === 'global-dormant' ? null : SOURCE_STATUS_CONFIG[connectionStatus]
        const tierConfig = SOURCE_TIER_CONFIG[source.tier ?? 'workspace']
        const subtitle = source.config.tagline || source.config.provider || ''
        const isWorkspaceSource = (source.tier ?? 'workspace') === 'workspace'
        const isGlobalSource = source.tier === 'global'
        const isDormantGlobal = source.tier === 'global-dormant'
        const canPromote = globalSourcesReady && isWorkspaceSource && !globalSlugSet.has(source.config.slug)
        return {
          icon: <SourceAvatar source={source} size="sm" />,
          title: source.config.name,
          badges: (
            <>
              {typeConfig && <EntityListBadge colorClass={typeConfig.colorClass}>{t(typeConfig.labelKey)}</EntityListBadge>}
              {tierConfig && <EntityListBadge colorClass={tierConfig.colorClass}>{t(tierConfig.labelKey)}</EntityListBadge>}
              {statusConfig && (
                <EntityListBadge colorClass={statusConfig.colorClass} tooltip={source.config.connectionError || undefined} className="cursor-default">
                  {t(statusConfig.labelKey)}
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
              onShowInFinder={source.folderPath ? () => window.electronAPI.showInFolder(source.folderPath) : undefined}
              onDelete={() => onDeleteSource(source.config.slug)}
              canDelete={isWorkspaceSource}
              deleteLabel={isWorkspaceSource ? undefined : t('sourcesList.managedSource')}
              onActivateGlobal={isDormantGlobal ? () => void handleToggleGlobal(source, true) : undefined}
              onDeactivateGlobal={isGlobalSource ? () => void handleToggleGlobal(source, false) : undefined}
              onPromoteToGlobal={canPromote ? () => void handlePromoteToGlobal(source) : undefined}
              onSendToWorkspace={hasOtherWorkspaces && isWorkspaceSource ? () => {
                setSendResourceSlug(source.config.slug)
                setSendResourceLabel(source.config.name)
                setSendDialogOpen(true)
              } : undefined}
            />
          ),
        }
      }}
    />
        </>
        )}
    </div>

    {workspaceId && (
      <GlobalSourcesLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        workspaceId={workspaceId}
        sources={globalSources}
        enabledSlugs={enabledGlobalSlugs}
        activeSources={sources}
        updatingSlug={updatingSlug}
        onToggle={handleToggleGlobal}
      />
    )}

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

interface GlobalSourcesLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  sources: LoadedSource[]
  enabledSlugs: Set<string>
  activeSources: LoadedSource[]
  updatingSlug: string | null
  onToggle: (source: LoadedSource, enabled: boolean) => void
}

function GlobalSourcesLibraryDialog({
  open,
  onOpenChange,
  sources,
  enabledSlugs,
  activeSources,
  updatingSlug,
  onToggle,
}: GlobalSourcesLibraryDialogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = React.useState('')
  const activeBySlug = React.useMemo(() => new Map(activeSources.map(source => [source.config.slug, source])), [activeSources])
  const filteredSources = React.useMemo(() => {
    const normalized = query.toLowerCase().trim()
    if (!normalized) return sources
    return sources.filter((source) => [
      source.config.slug,
      source.config.name,
      source.config.provider,
      source.config.tagline,
      source.config.type,
    ].filter(Boolean).join(' ').toLowerCase().includes(normalized))
  }, [query, sources])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-foreground/10 px-5 py-4">
          <DialogTitle className="text-base">{t('sourcesList.globalLibraryTitle')}</DialogTitle>
          <DialogDescription>{t('sourcesList.globalLibraryDescription')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5">
          <div className="mb-3 flex h-9 items-center gap-2 rounded-md border border-foreground/10 bg-background px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sourcesList.searchGlobal')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-md border border-foreground/10">
            {filteredSources.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('sourcesList.globalLibraryEmpty')}
              </div>
            ) : (
              filteredSources.map((source, index) => {
                const activeSource = activeBySlug.get(source.config.slug)
                const isEnabled = enabledSlugs.has(source.config.slug)
                const isLocalOverride = !!activeSource && activeSource.tier !== 'global'
                const isUpdating = updatingSlug === source.config.slug
                const typeConfig = SOURCE_TYPE_CONFIG[source.config.type]

                return (
                  <div
                    key={source.config.slug}
                    className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? 'border-t border-foreground/10' : ''}`}
                  >
                    <SourceAvatar source={source} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">{source.config.name}</div>
                        {isLocalOverride && (
                          <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('sourcesList.localOverride')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {source.config.tagline || source.config.provider || source.config.slug}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                        {typeConfig && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${typeConfig.colorClass}`}>
                            {t(typeConfig.labelKey)}
                          </span>
                        )}
                        <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] text-info">
                          {t('sourcesList.tier.global')}
                        </span>
                      </div>
                    </div>
                    <Switch
                      checked={isEnabled}
                      disabled={isUpdating || isLocalOverride}
                      onCheckedChange={(checked) => onToggle(source, checked)}
                      aria-label={`${isEnabled ? t('sourcesList.deactivate') : t('sourcesList.activate')} ${source.config.name}`}
                    />
                  </div>
                )
              })
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.done')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
