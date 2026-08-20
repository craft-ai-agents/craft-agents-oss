import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  compareSessions,
  DEFAULT_COLLECTION_FILTERS,
  dueBucket,
  filterSessionMeta,
  lexorankBetween,
  type CollectionDisplay,
  type CollectionFilters,
  type SessionPriority,
} from '@craft-agent/shared/sessions/collection'
import { useNavigation } from '@/contexts/NavigationContext'
import { useAppShellContext } from '@/context/AppShellContext'
import { routes } from '@/lib/navigate'
import {
  loadedSessionsAtom,
  refreshSessionsMetadataAtom,
  sessionMetaMapAtom,
  updateSessionMetaAtom,
  type SessionMeta,
} from '@/atoms/sessions'
import {
  collectionDisplayAtom,
  loadCollectionDisplayAtom,
  replaceCollectionDisplayAtom,
  setCollectionDisplayAtom,
} from '@/atoms/collection-display'
import { collectionFiltersAtom } from '@/atoms/collection-filters'
import { sessionSelection } from '@/hooks/useEntitySelection'
import type { SessionStatus } from '@/config/session-status-config'
import { CollectionViewToggle } from '../kanban/BoardListToggle'
import { CollectionOpsBar } from '../collection/CollectionOpsBar'
import { CollectionBulkBar } from '../collection/CollectionBulkBar'
import { SessionTableRow } from './SessionTableRow'
import { SessionTableGroupHeader } from './SessionTableGroupHeader'
import { crossGroupDropAction } from './table-drag'
import { flattenTableGroups, virtualTableWindow } from './table-virtualization'
import {
  emptyTableGroupBuckets,
  withEmptyTableGroups,
  type TableGroup,
  type TableGroupBucket,
} from './table-empty-groups'
import { isStaleRankNeighborsError, retryStaleRankReorder } from '@/lib/collection-reorder'

const PRIORITIES: SessionPriority[] = ['urgent', 'high', 'medium', 'low', 'none']


function bucketFor(
  meta: SessionMeta,
  groupBy: CollectionDisplay['groupBy'],
  statusById: Map<string, SessionStatus>,
  projectNameById: Map<string, string>,
  labelById: Map<string, string>,
  now: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): TableGroupBucket {
  switch (groupBy) {
    case 'status': {
      const id = meta.sessionStatus ?? 'todo'
      return { key: `status:${id}`, label: statusById.get(id)?.label ?? id, count: 0 }
    }
    case 'priority': {
      const p = meta.priority ?? 'none'
      return { key: `priority:${p}`, label: t(`priority.${p}`), count: 0 }
    }
    case 'project': {
      const pid = meta.projectId ?? ''
      return {
        key: `project:${pid}`,
        label: pid ? (projectNameById.get(pid) ?? pid) : t('collection.bulk.noProject'),
        count: 0,
      }
    }
    case 'dueDate': {
      const b = dueBucket(meta.dueDate ?? null, now)
      return { key: `due:${b}`, label: t(`collection.display.dueBucket.${b}`), count: 0 }
    }
    case 'label': {
      const first = (meta.labels ?? []).slice().sort((a, b) => a.localeCompare(b))[0]
      if (!first) return { key: 'label:none', label: t('collection.display.labelNone'), count: 0 }
      return { key: `label:${first}`, label: labelById.get(first) ?? first, count: 0 }
    }
    case 'none':
    default:
      return { key: '__all__', label: t('collection.display.groupBy.none'), count: 0 }
  }
}

const COLLAPSE_PREFERENCE_KEY = 'sessionTableCollapsedGroups'
const TABLE_ROW_HEIGHT = 40
const TABLE_GROUP_HEADER_HEIGHT = 32
const TABLE_OVERSCAN = 240

function parseCollapsedGroups(content: string): Set<string> {
  try {
    const preferences: unknown = JSON.parse(content)
    if (!preferences || typeof preferences !== 'object') return new Set()
    const value = (preferences as Record<string, unknown>)[COLLAPSE_PREFERENCE_KEY]
    return new Set(Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [])
  } catch (error) {
    console.error('[SessionTable] Failed to parse preferences:', error)
    return new Set()
  }
}

async function persistCollapsedGroups(collapsed: Set<string>): Promise<void> {
  const { content } = await window.electronAPI.readPreferences()
  let preferences: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed && typeof parsed === 'object') preferences = parsed as Record<string, unknown>
  } catch (error) {
    console.error('[SessionTable] Preferences were malformed; replacing table setting:', error)
  }

  const result = await window.electronAPI.writePreferences(
    JSON.stringify({ ...preferences, [COLLAPSE_PREFERENCE_KEY]: [...collapsed], updatedAt: Date.now() }, null, 2),
  )
  if (!result.success) throw new Error(result.error ?? 'Unable to save preferences')
}

function groupTableRows(
  metaMap: ReadonlyMap<string, SessionMeta>,
  filters: CollectionFilters,
  display: CollectionDisplay,
  statusById: Map<string, SessionStatus>,
  projectNameById: Map<string, string>,
  labelById: Map<string, string>,
  t: (key: string, options?: Record<string, unknown>) => string,
): TableGroup<SessionMeta>[] {
  const now = Date.now()
  const list: SessionMeta[] = []
  for (const meta of metaMap.values()) {
    if (meta.hidden || meta.isArchived || meta.parentSessionId || meta.taskDraft) continue
    if (!filterSessionMeta(meta, filters, { showCompleted: display.showCompleted, now, statusById })) continue
    list.push(meta)
  }
  list.sort((a, b) => compareSessions(a, b, display.orderBy, display.orderDir))

  if (display.groupBy === 'none') return [{ bucket: null, items: list }]

  const buckets = new Map<string, SessionMeta[]>()
  for (const meta of list) {
    const bucket = bucketFor(meta, display.groupBy, statusById, projectNameById, labelById, now, t)
    const items = buckets.get(bucket.key) ?? []
    items.push(meta)
    buckets.set(bucket.key, items)
  }
  const populatedGroups: TableGroup<SessionMeta>[] = []
  for (const items of buckets.values()) {
    const first = items[0]
    if (!first) continue
    const bucket = bucketFor(first, display.groupBy, statusById, projectNameById, labelById, now, t)
    populatedGroups.push({ bucket: { ...bucket, count: items.length }, items })
  }
  const groups = withEmptyTableGroups(
    populatedGroups,
    display.showEmptyGroups,
    emptyTableGroupBuckets({
      groupBy: display.groupBy,
      priorities: PRIORITIES,
      statusById,
      projectNameById,
      labelById,
      t,
    }),
  )
  if (display.groupBy === 'dueDate') {
    const order = ['due:overdue', 'due:today', 'due:this_week', 'due:later', 'due:none']
    groups.sort((a, b) => order.indexOf(a.bucket!.key) - order.indexOf(b.bucket!.key))
  } else {
    groups.sort((a, b) => a.bucket!.label.localeCompare(b.bucket!.label))
  }
  return groups
}

export function SessionTableHost() {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { activeWorkspaceId, sessionStatuses = [], projects = [], labels: labelConfigs } =
    useAppShellContext()
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const loadedSessionIds = useAtomValue(loadedSessionsAtom)
  const updateMeta = useSetAtom(updateSessionMetaAtom)
  const refreshMetadata = useSetAtom(refreshSessionsMetadataAtom)
  const display = useAtomValue(collectionDisplayAtom)
  const setDisplay = useSetAtom(setCollectionDisplayAtom)
  const replaceDisplay = useSetAtom(replaceCollectionDisplayAtom)
  const loadDisplay = useSetAtom(loadCollectionDisplayAtom)
  const filters = useAtomValue(collectionFiltersAtom)
  const setFilters = useSetAtom(collectionFiltersAtom)
  const { toggle, selectRange, selectAll, clearMultiSelect, isSelected } = sessionSelection.useSelection()

  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())


  React.useEffect(() => {
    let cancelled = false
    void window.electronAPI.readPreferences()
      .then(({ content }) => {
        if (!cancelled) setCollapsed(parseCollapsedGroups(content))
      })
      .catch((error) => {
        console.error('[SessionTable] Failed to load collapsed groups:', error)
        if (!cancelled) {
          toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
        }
      })
    return () => { cancelled = true }
  }, [t])

  const toggleCollapsedGroup = React.useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      void persistCollapsedGroups(next).catch((error) => {
        console.error('[SessionTable] Failed to save collapsed groups:', error)
        toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
      })
      return next
    })
  }, [t])

  React.useEffect(() => {
    void loadDisplay(activeWorkspaceId)
  }, [activeWorkspaceId, loadDisplay])

  React.useEffect(() => {
    if (!activeWorkspaceId || typeof window === 'undefined') return
    const api = window.electronAPI
    if (!api?.onCollectionDisplayChanged) return
    return api.onCollectionDisplayChanged((workspaceId, next) => {
      if (workspaceId !== activeWorkspaceId) return
      replaceDisplay(next)
    })
  }, [activeWorkspaceId, replaceDisplay])

  const handleDisplayChange = React.useCallback(
    (next: CollectionDisplay) => {
      void setDisplay({ display: next, workspaceId: activeWorkspaceId })
    },
    [setDisplay, activeWorkspaceId],
  )

  const statusById = React.useMemo(() => {
    const map = new Map<string, SessionStatus>()
    for (const s of sessionStatuses) map.set(s.id, s)
    return map
  }, [sessionStatuses])

  const projectNameById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.name)
    return map
  }, [projects])

  const labelById = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const l of labelConfigs ?? []) map.set(l.id, l.name)
    return map
  }, [labelConfigs])

  const projectOptions = React.useMemo(
    () => projects.map((p) => ({ id: p.id, name: p.name })),
    [projects],
  )
  const labelOptions = React.useMemo(
    () => (labelConfigs ?? []).map((l) => ({ id: l.id, name: l.name })),
    [labelConfigs],
  )

  const rows = React.useMemo(
    () => groupTableRows(metaMap, filters, display, statusById, projectNameById, labelById, t),
    [metaMap, filters, display, statusById, projectNameById, labelById, t],
  )

  const totalRows = rows.reduce((acc, g) => acc + g.items.length, 0)
  const visibleRows = React.useMemo<SessionMeta[]>(
    () => rows.flatMap((group) => (group.bucket == null || !collapsed.has(group.bucket.key) ? group.items : [])),
    [rows, collapsed],
  )
  const visibleIds = React.useMemo(() => visibleRows.map((meta) => meta.id), [visibleRows])
  const visibleIndexById = React.useMemo(
    () => new Map(visibleRows.map((meta, index) => [meta.id, index])),
    [visibleRows],
  )
  const allSelectedVisible = visibleIds.length > 0 && visibleIds.every((id) => isSelected(id))

  const showGrip = display.orderBy === 'rank'
  const showCol = (prop: string) => display.visibleProperties.includes(prop as never)

  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const tableHeaderRef = React.useRef<HTMLDivElement>(null)
  const [scrollMetrics, setScrollMetrics] = React.useState({ scrollTop: 0, height: 0, headerHeight: 0 })
  const virtualRows = React.useMemo(
    () =>
      flattenTableGroups(rows, collapsed, {
        getItemKey: (meta) => meta.id,
        rowHeight: TABLE_ROW_HEIGHT,
        headerHeight: TABLE_GROUP_HEADER_HEIGHT,
      }),
    [rows, collapsed],
  )
  const virtualWindow = React.useMemo(
    () =>
      virtualTableWindow(
        virtualRows.entries,
        Math.max(0, scrollMetrics.scrollTop - scrollMetrics.headerHeight),
        Math.max(0, scrollMetrics.height - scrollMetrics.headerHeight),
        TABLE_OVERSCAN,
      ),
    [scrollMetrics, virtualRows.entries],
  )
  const renderedVirtualRows = React.useMemo(
    () => virtualRows.entries.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [virtualRows.entries, virtualWindow],
  )
  const updateScrollMetrics = React.useCallback(() => {
    const element = scrollContainerRef.current
    if (!element) return
    const next = {
      scrollTop: element.scrollTop,
      height: element.clientHeight,
      headerHeight: tableHeaderRef.current?.offsetHeight ?? 0,
    }
    setScrollMetrics((previous) =>
      previous.scrollTop === next.scrollTop &&
      previous.height === next.height &&
      previous.headerHeight === next.headerHeight
        ? previous
        : next,
    )
  }, [])

  React.useLayoutEffect(() => {
    updateScrollMetrics()
    const container = scrollContainerRef.current
    const header = tableHeaderRef.current
    if (!container) return
    const observer = new ResizeObserver(updateScrollMetrics)
    observer.observe(container)
    if (header) observer.observe(header)
    return () => observer.disconnect()
  }, [updateScrollMetrics])

  // B5: rank drag reorder via HTML5 DnD when orderBy === 'rank'.
  const dragIdRef = React.useRef<string | null>(null)
  const [dropTarget, setDropTarget] = React.useState<{ sessionId: string; before: boolean } | null>(null)

  const handleRowDragStart = React.useCallback((id: string) => {
    dragIdRef.current = id
  }, [])

  const handleRowDragOver = React.useCallback(
    (id: string, e: React.DragEvent) => {
      if (!showGrip) return

      const dragId = dragIdRef.current
      if (dragId) {
        const dragMeta = metaMap.get(dragId)
        const targetMeta = metaMap.get(id)
        if (dragMeta && targetMeta) {
          const now = Date.now()
          const dragBucket = bucketFor(
            dragMeta,
            display.groupBy,
            statusById,
            projectNameById,
            labelById,
            now,
            t,
          )
          const targetBucket = bucketFor(
            targetMeta,
            display.groupBy,
            statusById,
            projectNameById,
            labelById,
            now,
            t,
          )
          if (
            dragBucket.key !== targetBucket.key &&
            !crossGroupDropAction(display.groupBy, targetBucket.key)
          ) {
            setDropTarget(null)
            e.dataTransfer.dropEffect = 'none'
            return
          }
        }
      }

      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const before = e.clientY < rect.top + rect.height / 2
      setDropTarget({ sessionId: id, before })
    },
    [display.groupBy, labelById, metaMap, projectNameById, showGrip, statusById, t],
  )

  const finalizeReorder = React.useCallback(
    async (targetId: string, before: boolean) => {
      const dragId = dragIdRef.current
      dragIdRef.current = null
      setDropTarget(null)
      if (!dragId || dragId === targetId || !showGrip) return

      const dragMeta = metaMap.get(dragId)
      const targetMeta = metaMap.get(targetId)
      if (!dragMeta || !targetMeta) return
      let rankMetaMap: ReadonlyMap<string, SessionMeta> = metaMap

      const now = Date.now()
      const dragBucket = bucketFor(
        dragMeta,
        display.groupBy,
        statusById,
        projectNameById,
        labelById,
        now,
        t,
      )
      const targetBucket = bucketFor(
        targetMeta,
        display.groupBy,
        statusById,
        projectNameById,
        labelById,
        now,
        t,
      )

      if (dragBucket.key !== targetBucket.key) {
        const action = crossGroupDropAction(display.groupBy, targetBucket.key)
        if (!action) return

        const previousMetadataPatch =
          action.command.type === 'setSessionStatus'
            ? { sessionStatus: dragMeta.sessionStatus }
            : action.command.type === 'setPriority'
              ? { priority: dragMeta.priority }
              : { projectId: dragMeta.projectId }

        try {
          updateMeta(dragId, action.metadataPatch)
          await window.electronAPI.sessionCommand(dragId, action.command)
          const nextMetaMap = new Map(rankMetaMap)
          nextMetaMap.set(dragId, { ...dragMeta, ...action.metadataPatch })
          rankMetaMap = nextMetaMap
        } catch (error) {
          console.error('[SessionTable] Failed to move session between groups:', error)
          updateMeta(dragId, previousMetadataPatch)
          toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
          return
        }
      }

      const rankRequestFor = (currentMetaMap: ReadonlyMap<string, SessionMeta>) => {
        const currentDragMeta = currentMetaMap.get(dragId)
        const currentTargetMeta = currentMetaMap.get(targetId)
        if (!currentDragMeta || !currentTargetMeta) return null
        const currentTargetBucket = bucketFor(
          currentTargetMeta,
          display.groupBy,
          statusById,
          projectNameById,
          labelById,
          Date.now(),
          t,
        )
        const currentRows = groupTableRows(
          currentMetaMap,
          filters,
          display,
          statusById,
          projectNameById,
          labelById,
          t,
        )
        const peers = currentRows
          .find((group) => (group.bucket?.key ?? '__all__') === currentTargetBucket.key)
          ?.items.filter((meta) => meta.id !== dragId) ?? []
        const targetIndex = peers.findIndex((meta) => meta.id === targetId)
        if (targetIndex < 0) return null
        const insertAt = before ? targetIndex : targetIndex + 1
        const previous = insertAt > 0 ? peers[insertAt - 1] : undefined
        const next = insertAt < peers.length ? peers[insertAt] : undefined
        return { sessionId: dragId, prevId: previous?.id, nextId: next?.id, previous, next }
      }

      const initial = rankRequestFor(rankMetaMap)
      if (!initial) return
      const previousRank = dragMeta.rank
      updateMeta(dragId, { rank: lexorankBetween(initial.previous?.rank, initial.next?.rank) })

      let refreshedMetaMap: ReadonlyMap<string, SessionMeta> = rankMetaMap
      const refreshRankMetadata = async () => {
        const sessions = await window.electronAPI.getSessions()
        refreshedMetaMap = refreshMetadata({ sessions, loadedSessionIds, removeMissing: false })
      }

      try {
        await retryStaleRankReorder(
          initial,
          ({ sessionId, prevId, nextId }) => window.electronAPI.sessionCommand(sessionId, { type: 'reorderRank', prevId, nextId }),
          refreshRankMetadata,
          () => {
            const refreshed = rankRequestFor(refreshedMetaMap)
            if (refreshed) {
              updateMeta(dragId, { rank: lexorankBetween(refreshed.previous?.rank, refreshed.next?.rank) })
            }
            return refreshed
          },
        )
      } catch (error) {
        if (isStaleRankNeighborsError(error)) {
          await refreshRankMetadata().catch((refreshError) => {
            console.error('[SessionTable] Failed to reload ranks after stale retry:', refreshError)
          })
        }
        console.error('[SessionTable] Failed to reorder rank:', error)
        updateMeta(dragId, { rank: previousRank })
        toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
      }
    },
    [display, filters, labelById, loadedSessionIds, metaMap, projectNameById, refreshMetadata, showGrip, statusById, t, updateMeta],
  )

  const handleTableDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (dropTarget) {
        void finalizeReorder(dropTarget.sessionId, dropTarget.before)
      } else {
        dragIdRef.current = null
        setDropTarget(null)
      }
    },
    [dropTarget, finalizeReorder],
  )

  const handleTableDragEnd = React.useCallback(() => {
    dragIdRef.current = null
    setDropTarget(null)
  }, [])

  return (
    <div className="flex h-full flex-col bg-background">
      <CollectionOpsBar
        display={display}
        filters={filters}
        onDisplayChange={handleDisplayChange}
        onFiltersChange={setFilters}
        statuses={sessionStatuses as unknown as SessionStatus[]}
        priorities={PRIORITIES}
        projects={projectOptions}
        labels={labelOptions}
        trailing={
          <CollectionViewToggle
            value="table"
            onChange={(view) => {
              if (view === 'list') navigate(routes.view.allSessions())
              else if (view === 'board') navigate(routes.view.board())
            }}
          />
        }
        className="border-b border-border/50"
      />

      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={updateScrollMetrics}
        onDrop={handleTableDrop}
        onDragOver={(e) => {
          if (showGrip) e.preventDefault()
        }}
        onDragEnd={handleTableDragEnd}
      >
        <div ref={tableHeaderRef} className="sticky top-0 z-10 flex items-center gap-2 border-b border-border/40 bg-background/95 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground backdrop-blur">
          <span className="w-6 shrink-0">
            <input
              type="checkbox"
              checked={allSelectedVisible}
              onChange={() => {
                if (allSelectedVisible) clearMultiSelect()
                else selectAll(visibleIds)
              }}
              aria-label={t('collection.table.selectAll')}
            />
          </span>
          {showGrip && <span className="w-4 shrink-0" />}
          <span className="min-w-0 flex-1">{t('collection.table.column.title')}</span>
          {showCol('status') && <span className="w-28 shrink-0">{t('collection.table.column.status')}</span>}
          {showCol('priority') && <span className="w-20 shrink-0">{t('collection.table.column.priority')}</span>}
          {showCol('project') && <span className="w-28 shrink-0">{t('collection.table.column.project')}</span>}
          {showCol('labels') && <span className="w-32 shrink-0">{t('collection.table.column.labels')}</span>}
          {showCol('dueDate') && <span className="w-24 shrink-0">{t('collection.table.column.dueDate')}</span>}
          {showCol('model') && <span className="w-24 shrink-0">{t('collection.table.column.model')}</span>}
          {showCol('updated') && <span className="w-20 shrink-0">{t('collection.table.column.updated')}</span>}
          {showCol('created') && <span className="w-20 shrink-0">{t('collection.table.column.created')}</span>}
          {showCol('flag') && <span className="w-8 shrink-0" />}
        </div>

        {totalRows === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <p className="text-sm">{t('collection.table.empty')}</p>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-foreground/[0.03]"
              onClick={() => setFilters({ ...DEFAULT_COLLECTION_FILTERS })}
            >
              {t('collection.table.clearFilters')}
            </button>
          </div>
        ) : (
          <ul
            className="relative"
            style={{ height: virtualRows.totalHeight }}
          >
            {renderedVirtualRows.map((entry) => {
              const style: React.CSSProperties = {
                position: 'absolute',
                top: entry.offset,
                left: 0,
                right: 0,
                height: entry.height,
              }

              if (entry.kind === 'header') {
                return (
                  <SessionTableGroupHeader
                    key={entry.key}
                    bucket={entry.bucket}
                    collapsed={collapsed.has(entry.bucket.key)}
                    onToggle={() => toggleCollapsedGroup(entry.bucket.key)}
                    style={style}
                  />
                )
              }

              const meta = entry.item
              return (
                <SessionTableRow
                  key={entry.key}
                  meta={meta}
                  statuses={sessionStatuses}
                  projectNameById={projectNameById}
                  labelById={labelById}
                  selected={isSelected(meta.id)}
                  onSelect={(_checked, shiftKey) => {
                    const globalIndex = visibleIndexById.get(meta.id) ?? 0
                    if (shiftKey) selectRange(globalIndex, visibleIds)
                    else toggle(meta.id, globalIndex)
                  }}
                  onOpen={(id) => navigate(routes.view.allSessions(id))}
                  onUpdate={(partial) => {
                    updateMeta(meta.id, partial)
                    const api = window.electronAPI
                    const send = async (command: unknown): Promise<void> => {
                      try {
                        await api.sessionCommand(meta.id, command as never)
                      } catch (error) {
                        console.error('[SessionTable] Failed to update row:', error)
                        updateMeta(meta.id, meta)
                        toast.error(t('collection.bulk.failed', { message: error instanceof Error ? error.message : String(error) }))
                      }
                    }
                    if (partial.priority !== undefined) void send({ type: 'setPriority', priority: partial.priority })
                    if (partial.dueDate !== undefined) void send({ type: 'setDueDate', dueDate: partial.dueDate })
                    if (partial.sessionStatus !== undefined) void send({ type: 'setSessionStatus', state: partial.sessionStatus })
                    if (partial.isFlagged !== undefined) void send({ type: partial.isFlagged ? 'flag' : 'unflag' })
                  }}
                  showGrip={showGrip}
                  showStatus={showCol('status')}
                  showPriority={showCol('priority')}
                  showProject={showCol('project')}
                  showLabels={showCol('labels')}
                  showDue={showCol('dueDate')}
                  showModel={showCol('model')}
                  showUpdated={showCol('updated')}
                  showCreated={showCol('created')}
                  showFlag={showCol('flag')}
                  onDragStartRow={handleRowDragStart}
                  onDragOverRow={handleRowDragOver}
                  dropIndicator={
                    dropTarget?.sessionId === meta.id
                      ? dropTarget.before
                        ? 'before'
                        : 'after'
                      : null
                  }
                  style={style}
                />
              )
            })}
          </ul>
        )}
      </div>

      <CollectionBulkBar
        workspaceId={activeWorkspaceId}
        visibleSessionIds={visibleIds}
        statuses={sessionStatuses as unknown as SessionStatus[]}
        projects={projectOptions}
        labels={labelOptions}
      />
    </div>
  )
}
