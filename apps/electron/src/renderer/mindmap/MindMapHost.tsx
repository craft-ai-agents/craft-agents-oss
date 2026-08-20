/**
 * Mind map host — map mode uses SVG engine; outline mode uses nested list.
 * Optional split mode syncs selection across map + outline.
 * Pin (localStorage) + zen fullscreen are host chrome only — no entity writeback.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Columns2,
  FileDown,
  Maximize2,
  Minimize2,
  Network,
  Pin,
  PinOff,
  Search,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  createMindMapStarterGraph,
  createPinnedMap,
  entityPinKey,
  graphToMarkdown,
  isStale,
  materializeNoteTitle,
  MINDMAP_NOTES_FOLDER,
  type MindMapEntityRef,
  type MindMapGraph,
  type MindMapNodeId,
  type PinnedMap,
} from '@craft-agent/core/mindmap'
import { useAppShellContext } from '@/context/AppShellContext'
import { toast } from 'sonner'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { MindMapOutline } from './MindMapOutline'
import {
  SvgMindMapView,
  type SvgMindMapViewHandle,
} from './engine/svg-engine'
import { clearPinAsync, loadPinAsync, savePinAsync } from './pin-store'

const pinOperationChains = new Map<string, Promise<void>>()

function enqueuePinOperation(entityId: string, operation: () => Promise<void>): void {
  const previous = pinOperationChains.get(entityId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation)
  pinOperationChains.set(entityId, next)
  void next.then(
    () => {
      if (pinOperationChains.get(entityId) === next) pinOperationChains.delete(entityId)
    },
    () => {
      if (pinOperationChains.get(entityId) === next) pinOperationChains.delete(entityId)
    },
  )
}

export interface MindMapHostProps {
  entity: MindMapEntityRef
  graph: MindMapGraph | null
  loading?: boolean
  error?: string | null
  /** External tab mode from EntityViewTabs */
  mode?: 'map' | 'outline'
  selectedId?: MindMapNodeId | null
  onSelect?: (id: MindMapNodeId | null) => void
  onNavigate?: (source: { kind: string; id: string }) => void
  /** Optional workspace id override; defaults to active workspace. */
  workspaceId?: string
  /** Reserved for future FS pin path; unused (localStorage only). */
  workspaceRoot?: string
  /** Optional source excerpt for LLM enrich. */
  sourceExcerpt?: string
  /** Called when user accepts an enriched draft (after pin). */
  onAcceptDraft?: (graph: MindMapGraph) => void
  /** Optional live override when accepting draft. */
  onGraphOverride?: (graph: MindMapGraph) => void
  className?: string
}

function layoutFromCollapsed(collapsed: Set<MindMapNodeId>) {
  return { positions: {} as Record<MindMapNodeId, { x: number; y: number }>, collapsed: [...collapsed] }
}

export function MindMapHost({
  entity,
  graph,
  loading,
  error,
  mode = 'map',
  selectedId: selectedProp = null,
  onSelect,
  onNavigate,
  workspaceId: workspaceIdProp,
  workspaceRoot: _workspaceRoot,
  sourceExcerpt,
  onAcceptDraft,
  onGraphOverride,
  className,
}: MindMapHostProps) {
  const { t } = useTranslation()
  const [selectedId, setSelectedId] = React.useState<MindMapNodeId | null>(selectedProp)
  const [search, setSearch] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState<Set<MindMapNodeId>>(() => new Set())
  const [split, setSplit] = React.useState(false)
  const [fitKey, setFitKey] = React.useState(0)
  const [zen, setZen] = React.useState(false)
  const [pin, setPin] = React.useState<PinnedMap | null>(null)
  const [pinLoaded, setPinLoaded] = React.useState(false)
  /** User dismissed a stale banner without rebuilding. */
  const [staleDismissed, setStaleDismissed] = React.useState(false)
  const [enrichDraft, setEnrichDraft] = React.useState<MindMapGraph | null>(null)
  const [enriching, setEnriching] = React.useState(false)
  const [materializing, setMaterializing] = React.useState(false)
  const { activeWorkspaceId } = useAppShellContext()
  const engineRef = React.useRef<SvgMindMapViewHandle | null>(null)

  React.useEffect(() => {
    setSelectedId(selectedProp)
  }, [selectedProp])

  React.useEffect(() => {
    if (mode === 'outline') setSplit(false)
  }, [mode])

  // Stable key — callers pass fresh entity object literals each render.
  const entityKey = entityPinKey(entity)
  const contentHash = graph?.contentHash ?? null
  const rootId = graph?.rootId ?? null

  const starterGraph = React.useMemo(() => {
    if (graph || pin) return null
    return createMindMapStarterGraph(entity, {
      input: t('settings.input.title'),
      plan: t('tasks.generatePlan'),
      execute: t('mode.execute'),
      review: t('knowledge.publish.step.review'),
      result: t('tasks.tabResults'),
    })
  }, [entity, graph, pin, t])

  // Load pin when entity/workspace changes (workspace FS + localStorage fallback).
  React.useEffect(() => {
    let cancelled = false
    setPin(null)
    setPinLoaded(false)
    setStaleDismissed(false)
    setEnrichDraft(null)
    const workspaceId = workspaceIdProp || activeWorkspaceId
    void loadPinAsync(entity, workspaceId)
      .then((loaded) => {
        if (!cancelled) setPin(loaded)
      })
      .finally(() => {
        if (!cancelled) setPinLoaded(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entityKey + workspace
  }, [entityKey, workspaceIdProp, activeWorkspaceId])

  React.useLayoutEffect(() => {
    if (!starterGraph || pin || !pinLoaded) return
    const next = createPinnedMap(
      starterGraph,
      layoutFromCollapsed(new Set()),
      Date.now(),
      starterGraph.contentHash,
    )
    enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
    setPin(next)
  }, [
    activeWorkspaceId,
    entityKey,
    pin,
    pinLoaded,
    starterGraph,
    workspaceIdProp,
  ])

  // Reset collapse on graph identity change; restore pin collapsed when fresh.
  React.useEffect(() => {
    if (contentHash == null || rootId == null) {
      setCollapsed(new Set())
      return
    }
    if (pin && !isStale(pin, contentHash)) {
      setCollapsed(new Set(pin.layout.collapsed ?? []))
      return
    }
    setCollapsed(new Set())
  }, [entityKey, contentHash, rootId, pin])

  const handleSelect = React.useCallback(
    (id: MindMapNodeId | null) => {
      setSelectedId(id)
      onSelect?.(id)
    },
    [onSelect],
  )

  const handleToggleCollapse = React.useCallback((id: MindMapNodeId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // When pinned (fresh), keep collapse layout in the pin snapshot.
  React.useEffect(() => {
    if (!graph || !pin) return
    if (isStale(pin, graph.contentHash)) return
    const prev = new Set(pin.layout.collapsed ?? [])
    if (prev.size === collapsed.size && [...collapsed].every((id) => prev.has(id))) {
      return
    }
    // Preserve pinned structure; only layout/collapse updates.
    const next: PinnedMap = {
      ...pin,
      layout: layoutFromCollapsed(collapsed),
      updatedAt: Date.now(),
    }
    enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
    setPin(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only collapse/layout
  }, [collapsed, activeWorkspaceId, entityKey, workspaceIdProp])

  const pinFresh = Boolean(pin && (!graph || !isStale(pin, graph.contentHash)))
  const pinStale = Boolean(pin && graph && isStale(pin, graph.contentHash) && !staleDismissed)
  // Draft > pin (fresh or Keep) > live > localized starter. Never write back to entity.
  const showPinnedStructure = Boolean(pin && (pinFresh || staleDismissed))
  const displayGraph =
    enrichDraft ?? (showPinnedStructure && pin ? pin.graph : graph ?? starterGraph)
  // Only the active persisted snapshot may receive structural changes.
  const isPinned = Boolean(pin && showPinnedStructure && !enrichDraft)

  const handleGraphChange = React.useCallback(
    (nextGraph: MindMapGraph) => {
      if (
        !pin ||
        !showPinnedStructure ||
        enrichDraft ||
        nextGraph.derivation !== 'pinned'
      ) {
        return
      }
      const next: PinnedMap = {
        ...pin,
        graph: nextGraph,
        layout: layoutFromCollapsed(collapsed),
        updatedAt: Date.now(),
      }
      enqueuePinOperation(entityKey, () =>
        savePinAsync(next, workspaceIdProp || activeWorkspaceId),
      )
      setPin(next)
    },
    [
      activeWorkspaceId,
      collapsed,
      enrichDraft,
      entityKey,
      pin,
      showPinnedStructure,
      workspaceIdProp,
    ],
  )


  const handleTogglePin = React.useCallback(() => {
    if (!graph) return
    // Unpin when a pin exists and we're treating it as active (fresh or kept).
    if (pin && ( !isStale(pin, graph.contentHash) || staleDismissed)) {
      enqueuePinOperation(entityKey, () => clearPinAsync(entity, workspaceIdProp || activeWorkspaceId))
      setPin(null)
      setEnrichDraft(null)
      setStaleDismissed(false)
      return
    }
    const base = displayGraph ?? graph
    const next = createPinnedMap(
      base,
      layoutFromCollapsed(collapsed),
      Date.now(),
      graph.contentHash, // track live source
    )
    enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
    setPin(next)
    setStaleDismissed(false)
  }, [activeWorkspaceId, collapsed, displayGraph, entity, graph, pin, staleDismissed, workspaceIdProp])

  const handleRebuildPin = React.useCallback(() => {
    if (!graph) return
    const nextCollapsed = new Set<MindMapNodeId>()
    const next = createPinnedMap(
      graph,
      layoutFromCollapsed(nextCollapsed),
      Date.now(),
      graph.contentHash,
    )
    enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
    setCollapsed(nextCollapsed)
    setPin(next)
    setEnrichDraft(null)
    setStaleDismissed(false)
  }, [activeWorkspaceId, entityKey, graph, workspaceIdProp])

  const handleKeepStale = React.useCallback(() => {
    setStaleDismissed(true)
  }, [])

  const handleEnrich = React.useCallback(async () => {
    if (!graph || enriching) return
    const workspaceId = workspaceIdProp || activeWorkspaceId
    if (!workspaceId) {
      toast.error(t('mindmap.enrichNoWorkspace'))
      return
    }
    setEnriching(true)
    try {
      const api = window.electronAPI?.enrichMindMap
      if (typeof api !== 'function') {
        toast.error(t('mindmap.enrichUnavailable'))
        return
      }
      const base = displayGraph ?? graph
      const result = await api({
        workspaceId,
        entity,
        graph: base,
        sourceExcerpt,
      })
      if (result?.ok && result.graph) {
        setEnrichDraft(result.graph)
        setFitKey((k) => k + 1)
      } else {
        toast.error(
          result && 'error' in result && result.error
            ? result.error
            : t('mindmap.enrichFailed'),
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('mindmap.enrichFailed'))
    } finally {
      setEnriching(false)
    }
  }, [activeWorkspaceId, displayGraph, enriching, entity, graph, sourceExcerpt, t, workspaceIdProp])

  const handleAcceptEnrich = React.useCallback(() => {
    if (!enrichDraft || !graph) return
    const next = createPinnedMap(
      enrichDraft,
      layoutFromCollapsed(collapsed),
      Date.now(),
      graph.contentHash, // stay fresh vs live until source changes again
    )
    enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
    setPin(next)
    setStaleDismissed(false)
    onAcceptDraft?.(enrichDraft)
    onGraphOverride?.(enrichDraft)
    setEnrichDraft(null)
    toast.success(t('mindmap.enrichAccepted'))
  }, [activeWorkspaceId, collapsed, enrichDraft, graph, onAcceptDraft, onGraphOverride, t, workspaceIdProp])

  const handleDiscardEnrich = React.useCallback(() => {
    setEnrichDraft(null)
  }, [])

  const handleMaterialize = React.useCallback(async () => {
    const g = displayGraph ?? graph
    if (!g || materializing) return
    const workspaceId = workspaceIdProp || activeWorkspaceId
    if (!workspaceId) {
      toast.error(t('mindmap.enrichNoWorkspace'))
      return
    }
    setMaterializing(true)
    try {
      const title = materializeNoteTitle(g)
      const markdown = graphToMarkdown(g)
      const created = await window.electronAPI.createNote(
        workspaceId,
        title,
        MINDMAP_NOTES_FOLDER,
      )
      await window.electronAPI.saveNote(workspaceId, created.id, markdown)
      // Keep a pin of what we saved
      const next = createPinnedMap(
        g,
        layoutFromCollapsed(collapsed),
        Date.now(),
        graph?.contentHash ?? g.contentHash,
      )
      enqueuePinOperation(entityKey, () => savePinAsync(next, workspaceIdProp || activeWorkspaceId))
      setPin(next)
      toast.success(t('mindmap.materializeDone'))
      navigate(routes.view.notes(created.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('mindmap.materializeFailed'))
    } finally {
      setMaterializing(false)
    }
  }, [
    activeWorkspaceId,
    collapsed,
    displayGraph,
    graph,
    materializing,
    t,
    workspaceIdProp,
  ])

  React.useEffect(() => {
    if (!zen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setZen(false)
        window.dispatchEvent(new CustomEvent('craft-mindmap-zen', { detail: { zen: false } }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zen])

  if (loading) {
    return (
      <div
        className={cn(
          'flex-1 flex items-center justify-center text-sm text-muted-foreground',
          className,
        )}
      >
        {t('mindmap.loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center',
          className,
        )}
      >
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!displayGraph) {
    return (
      <div
        className={cn(
          'flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center',
          className,
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/5 text-muted-foreground">
          <Network className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-sm text-muted-foreground">{t('mindmap.empty')}</p>
      </div>
    )
  }

  const childCount = Object.keys((displayGraph ?? graph).nodes).length
  // A pinned root-only graph must still render so users can add the first custom node.
  const onlyRoot = childCount <= 1 && !isPinned
  const showMapChrome = mode === 'map' && !onlyRoot

  const renderMap = () => (
    <SvgMindMapView
      ref={engineRef}
      graph={displayGraph!}
      layout="auto"
      readOnlyStructure={!isPinned}
      searchQuery={search}
      selectedId={selectedId}
      collapsed={collapsed}
      onGraphChange={isPinned ? handleGraphChange : undefined}
      onSelect={handleSelect}
      onNavigate={onNavigate}
      onToggleCollapse={handleToggleCollapse}
      fitRequestKey={fitKey}
    />
  )

  const renderOutline = () => (
    <MindMapOutline
      graph={displayGraph!}
      selectedId={selectedId}
      onSelect={handleSelect}
      onNavigate={onNavigate}
    />
  )

  const body = (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 text-[11px] text-muted-foreground shrink-0">
        <span className="inline-flex items-center rounded-full bg-foreground/5 px-2 py-0.5 font-medium text-foreground/80">
          {enriching
            ? t('mindmap.enriching')
            : enrichDraft
              ? t('mindmap.enrichReady')
              : showPinnedStructure
                ? t('mindmap.pinned')
                : t('mindmap.live')}
        </span>
        <span className="truncate">
          {mode === 'outline' && !split
            ? t('entityView.outline')
            : split
              ? t('mindmap.split')
              : t('entityView.map')}
          {' · '}
          {childCount} {t('mindmap.nodes')}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          {showMapChrome ? (
            <>
              <button
                type="button"
                className="h-7 w-7 grid place-items-center rounded-[6px] hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                title={t('mindmap.fit')}
                aria-label={t('mindmap.fit')}
                onClick={() => {
                  engineRef.current?.fitView()
                  setFitKey((k) => k + 1)
                }}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="h-7 w-7 grid place-items-center rounded-[6px] hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                title={t('menu.zoomIn')}
                aria-label={t('menu.zoomIn')}
                onClick={() => engineRef.current?.zoomBy(1.1)}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="h-7 w-7 grid place-items-center rounded-[6px] hover:bg-foreground/5 text-muted-foreground hover:text-foreground"
                title={t('menu.zoomOut')}
                aria-label={t('menu.zoomOut')}
                onClick={() => engineRef.current?.zoomBy(1 / 1.1)}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={cn(
                  'h-7 w-7 grid place-items-center rounded-[6px] hover:bg-foreground/5',
                  split
                    ? 'text-foreground bg-foreground/5'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                title={t('mindmap.split')}
                aria-label={t('mindmap.split')}
                aria-pressed={split}
                onClick={() => setSplit((v) => !v)}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : null}

          <button
            type="button"
            className={cn(
              'h-7 inline-flex items-center gap-1 rounded-[6px] px-1.5 hover:bg-foreground/5',
              showPinnedStructure
                ? 'text-foreground bg-foreground/5'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={showPinnedStructure ? t('mindmap.unpin') : t('mindmap.pin')}
            aria-label={showPinnedStructure ? t('mindmap.unpin') : t('mindmap.pin')}
            aria-pressed={showPinnedStructure}
            onClick={handleTogglePin}
          >
            {showPinnedStructure ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            <span className="text-[11px] font-medium">
              {showPinnedStructure ? t('mindmap.pinned') : t('mindmap.pin')}
            </span>
          </button>

          <button
            type="button"
            className={cn(
              'h-7 inline-flex items-center gap-1 rounded-[6px] px-1.5 hover:bg-foreground/5',
              zen
                ? 'text-foreground bg-foreground/5'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={t('mindmap.zen')}
            aria-label={t('mindmap.zen')}
            aria-pressed={zen}
            onClick={() => {
              setZen((v) => {
                const next = !v
                window.dispatchEvent(new CustomEvent('craft-mindmap-zen', { detail: { zen: next } }))
                return next
              })
            }}
          >
            {zen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span className="text-[11px] font-medium">{t('mindmap.zen')}</span>
          </button>

                    <button
            type="button"
            className={cn(
              'h-7 inline-flex items-center gap-1 rounded-[6px] px-1.5 hover:bg-foreground/5 text-muted-foreground hover:text-foreground',
              materializing && 'opacity-60',
            )}
            title={t('mindmap.materialize')}
            aria-label={t('mindmap.materialize')}
            disabled={materializing || !graph}
            onClick={() => void handleMaterialize()}
          >
            <FileDown className={cn('h-3.5 w-3.5', materializing && 'animate-pulse')} />
            <span className="text-[11px] font-medium">
              {materializing ? t('mindmap.materializing') : t('mindmap.materialize')}
            </span>
          </button>

<button
            type="button"
            className={cn(
              'h-7 inline-flex items-center gap-1 rounded-[6px] px-1.5 hover:bg-foreground/5',
              enrichDraft
                ? 'text-foreground bg-foreground/5'
                : 'text-muted-foreground hover:text-foreground',
              enriching && 'opacity-60',
            )}
            title={t('mindmap.enrich')}
            aria-label={t('mindmap.enrich')}
            disabled={enriching || !graph}
            onClick={() => void handleEnrich()}
          >
            <Sparkles className={cn('h-3.5 w-3.5', enriching && 'animate-pulse')} />
            <span className="text-[11px] font-medium">
              {enriching ? t('mindmap.enriching') : t('mindmap.enrich')}
            </span>
          </button>

          <button
            type="button"
            className={cn(
              'h-7 w-7 grid place-items-center rounded-[6px] hover:bg-foreground/5',
              searchOpen
                ? 'text-foreground bg-foreground/5'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title={t('common.search')}
            aria-label={t('common.search')}
            aria-pressed={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {enrichDraft ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/60 text-[11px] text-foreground shrink-0">
          <span className="flex-1 truncate">{t('mindmap.enrichDraftBanner')}</span>
          <button
            type="button"
            className="h-6 rounded-[6px] px-2 font-medium hover:bg-foreground/5"
            onClick={handleDiscardEnrich}
          >
            {t('mindmap.enrichDiscard')}
          </button>
          <button
            type="button"
            className="h-6 rounded-[6px] bg-foreground/90 px-2 font-medium text-background hover:bg-foreground"
            onClick={handleAcceptEnrich}
          >
            {t('mindmap.enrichAccept')}
          </button>
        </div>
      ) : null}

      {pinStale ? (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/60 text-[11px] text-foreground shrink-0">
          <span className="flex-1 truncate">{t('mindmap.staleBanner')}</span>
          <button
            type="button"
            className="h-6 rounded-[6px] px-2 font-medium hover:bg-foreground/5"
            onClick={handleKeepStale}
          >
            {t('mindmap.keepPin')}
          </button>
          <button
            type="button"
            className="h-6 rounded-[6px] bg-foreground/90 px-2 font-medium text-background hover:bg-foreground"
            onClick={handleRebuildPin}
          >
            {t('mindmap.rebuildPin')}
          </button>
        </div>
      ) : null}

      {searchOpen ? (
        <div className="px-3 py-1.5 border-b border-border/20 shrink-0">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="w-full h-8 rounded-[8px] border border-border/50 bg-background px-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-foreground/30 placeholder:text-muted-foreground"
          />
        </div>
      ) : null}

      {onlyRoot ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {t('mindmap.empty')}
        </div>
      ) : mode === 'outline' ? (
        renderOutline()
      ) : split ? (
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={62} minSize={30}>
            <div className="flex h-full min-h-0 flex-col">{renderMap()}</div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={38} minSize={20}>
            <div className="flex h-full min-h-0 flex-col border-l border-border/30">
              {renderOutline()}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        renderMap()
      )}
    </>
  )

  if (zen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 shrink-0">
          <span className="text-[11px] font-medium text-muted-foreground">{t('mindmap.zen')}</span>
          <div className="ml-auto">
            <button
              type="button"
              className="h-7 inline-flex items-center gap-1 rounded-[6px] px-2 text-[11px] font-medium text-foreground hover:bg-foreground/5"
              aria-label={t('common.close')}
              onClick={() => {
                setZen(false)
                window.dispatchEvent(new CustomEvent('craft-mindmap-zen', { detail: { zen: false } }))
              }}
            >
              <Minimize2 className="h-3.5 w-3.5" />
              {t('common.close')}
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0">{body}</div>
      </div>
    )
  }

  return <div className={cn('flex-1 flex flex-col min-h-0', className)}>{body}</div>
}
