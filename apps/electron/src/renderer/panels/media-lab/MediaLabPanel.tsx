import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { VariableSizeGrid, type VariableSizeGrid as VariableSizeGridType } from 'react-window'
import { Clapperboard, Image, Music, Video, FileText, Loader2, ExternalLink, Sparkles, Wand2, Download, EyeOff, Check, X, CheckSquare, FolderOpen, Power } from 'lucide-react'
import type {
  ComfyHealth,
  ComfyJobStatus,
  ComfyWorkflowSummary,
  MediaItem,
  MediaKind,
  MediaListPage,
  MediaListRequest,
} from '@archstudio/shared/protocol'
import { sessionMetaMapAtom } from '../../atoms/sessions'
import { useAppShellContext } from '../../context/AppShellContext'
import './MediaLabPanel.css'

const EXT: Record<MediaKind, string[]> = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'],
  video: ['.mp4', '.mov', '.webm', '.mkv', '.avi'],
  audio: ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'],
  doc: ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.md'],
}

const KIND_ICON: Record<MediaKind, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  doc: FileText,
}

/**
 * Default page size. Mirrors the server's `DEFAULT_LIMIT` so a single page
 * response is "what the user sees in roughly 3 viewports". The server also
 * accepts an explicit `limit` request field if a different size is needed.
 */
const PAGE_LIMIT = 200
/**
 * Prefetch the next server page when the virtualized grid approaches its
 * bottom. With ROW_HEIGHT = 196 this is roughly one viewport of cards so the
 * user never catches the loader mid-spin.
 */
const PREFETCH_ROWS = 2
/** Minimum card width — matches the existing `minmax(170px, 1fr)` CSS grid. */
const CARD_MIN_WIDTH = 170
/** Gap between cards, matches the existing CSS. */
const GAP = 14
/**
 * Fixed card height. Cards never wrap (both name + meta use
 * `white-space: nowrap`), so a deterministic rowHeight is safe and avoids
 * the per-row measurement cost of true variable sizing. The 196px value
 * covers the preview 110 + body ~52 + 1px border + ~33px slack for
 * line-height variance across platforms.
 */
const ROW_HEIGHT = 196
/** Approximate height of the "Loading more sessions…" pager block. */
const PAGER_HEIGHT_APPROX = 56
/** Approximate height of the "End of recent sessions" end-cap. */
const END_HEIGHT_APPROX = 56

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const ONE_HOUR_MS = 60 * 60 * 1000

function isRecentlyGenerated(mtime?: number): boolean {
  if (!mtime) return false
  return Date.now() - mtime < ONE_HOUR_MS
}

export function MediaLabPanel() {
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const { onOpenFile } = useAppShellContext()
  const [kindFilter, setKindFilter] = useState<MediaKind | 'all'>('all')
  const [creationTab, setCreationTab] = useState<'create' | 'library'>('create')
  const [comfyHealth, setComfyHealth] = useState<ComfyHealth | null>(null)
  const [comfyWorkflows, setComfyWorkflows] = useState<ComfyWorkflowSummary[]>([])
  const [comfyRejectedCount, setComfyRejectedCount] = useState(0)
  const [creationKind, setCreationKind] = useState<'image' | 'video'>('image')
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [workflowValues, setWorkflowValues] = useState<Record<string, string | number>>({})
  const [comfyLoading, setComfyLoading] = useState(true)
  const [comfyError, setComfyError] = useState<string | null>(null)
  const [comfyJob, setComfyJob] = useState<ComfyJobStatus | null>(null)
  const [comfySubmitting, setComfySubmitting] = useState(false)
  const [comfyStarting, setComfyStarting] = useState(false)

  /**
   * `topId` — renderer's coarse "the most recent session has changed"
   * trigger. Server's `media:list` already orders by lastMessageAt desc,
   * so a brand-new top-of-list session means the next page could carry
   * media we haven't seen yet. The server has its own ordering and
   * cursor; we mirror that with a cheap derive just to know when to
   * reset the cursor.
   */
  const topId = useMemo(() => {
    let newest: { lastMessageAt: number; id: string } | null = null
    for (const m of metaMap.values()) {
      if (m.hidden || m.isArchived) continue
      const ts = m.lastMessageAt ?? m.createdAt ?? 0
      if (!newest || ts > newest.lastMessageAt) newest = { lastMessageAt: ts, id: m.id }
    }
    return newest?.id ?? ''
  }, [metaMap])

  useEffect(() => {
    let cancelled = false
    const loadComfyUI = async () => {
      setComfyLoading(true)
      setComfyError(null)
      try {
        const [health, workflowList] = await Promise.all([
          window.electronAPI.comfyHealth(),
          window.electronAPI.comfyWorkflows(),
        ])
        if (cancelled) return
        setComfyHealth(health)
        setComfyWorkflows(workflowList.workflows)
        setComfyRejectedCount(workflowList.rejectedCount)
        if (!health.connected) setComfyError(health.error ?? 'ComfyUI is offline')
      } catch (loadError) {
        if (!cancelled) setComfyError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setComfyLoading(false)
      }
    }
    void loadComfyUI()
    return () => { cancelled = true }
  }, [])

  const creationWorkflows = useMemo(
    () => comfyWorkflows.filter((workflow) => workflow.kind === creationKind),
    [comfyWorkflows, creationKind],
  )
  const selectedWorkflow = useMemo(
    () => creationWorkflows.find((workflow) => workflow.id === selectedWorkflowId) ?? creationWorkflows[0] ?? null,
    [creationWorkflows, selectedWorkflowId],
  )

  useEffect(() => {
    if (!selectedWorkflow) {
      setSelectedWorkflowId('')
      setWorkflowValues({})
      return
    }
    setSelectedWorkflowId(selectedWorkflow.id)
    setWorkflowValues(Object.fromEntries(selectedWorkflow.parameters.map((parameter) => [parameter.id, parameter.value])))
  }, [selectedWorkflow?.id])

  useEffect(() => {
    if (!comfyJob || !['queued', 'running', 'unknown'].includes(comfyJob.state)) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = await window.electronAPI.comfyStatus({ promptId: comfyJob.promptId })
        if (!cancelled) setComfyJob(next)
      } catch (pollError) {
        if (!cancelled) setComfyError(pollError instanceof Error ? pollError.message : String(pollError))
      }
    }
    const timer = setInterval(() => { void poll() }, 1200)
    void poll()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [comfyJob?.promptId, comfyJob?.state])

  const runComfyWorkflow = useCallback(async () => {
    if (!selectedWorkflow) return
    setComfySubmitting(true)
    setComfyError(null)
    try {
      const result = await window.electronAPI.comfyRun({
        workflowId: selectedWorkflow.id,
        parameters: workflowValues,
      })
      setComfyJob({ promptId: result.promptId, state: 'queued' })
    } catch (runError) {
      setComfyError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setComfySubmitting(false)
    }
  }, [selectedWorkflow, workflowValues])

  const cancelComfyJob = useCallback(async () => {
    if (!comfyJob) return
    try {
      await window.electronAPI.comfyCancel()
      setComfyJob({ promptId: comfyJob.promptId, state: 'failed' })
    } catch (cancelError) {
      setComfyError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    }
  }, [comfyJob])

  const startComfyUI = useCallback(async () => {
    if (comfyStarting || comfyHealth?.connected) return
    setComfyStarting(true)
    setComfyError(null)
    try {
      const health = await window.electronAPI.comfyStart()
      setComfyHealth(health)
      const workflowList = await window.electronAPI.comfyWorkflows()
      setComfyWorkflows(workflowList.workflows)
      setComfyRejectedCount(workflowList.rejectedCount)
    } catch (startError) {
      setComfyError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setComfyStarting(false)
    }
  }, [comfyHealth?.connected, comfyStarting])

  // ---------- Virtualization plumbing (unchanged from prior refactor) ----------

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<VariableSizeGridType | null>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerSize((prev) => {
        const width = entry.contentRect.width
        const height = entry.contentRect.height
        if (prev.width === width && prev.height === height) return prev
        return { width, height }
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [creationTab])

  // ---------- Data state (the part that changed) ----------

  const [items, setItems] = useState<MediaItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Multi-select state ─────────────────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [selectAnchorIdx, setSelectAnchorIdx] = useState<number | null>(null)

  // ── Context menu state ───────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: MediaItem
  } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const itemKey = useCallback((item: MediaItem) => `${item.sessionId}::${item.path}`, [])

  // Declared before the selection callbacks below, whose dependency arrays are
  // evaluated during render and would otherwise read `open` in its TDZ.
  const open = useCallback((item: MediaItem) => {
    onOpenFile(item.path)
  }, [onOpenFile])


  // Declared before the selection callbacks below: their dependency arrays are
  // evaluated during render, so a later `const visible` would be in its TDZ and
  // throw "Cannot access 'visible' before initialization".
  const visible = useMemo(
    () => (kindFilter === 'all' ? items : items.filter((i) => i.kind === kindFilter)),
    [items, kindFilter],
  )

  const toggleItem = useCallback((index: number) => {
    const item = visible[index]
    if (!item) return
    const key = itemKey(item)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setSelectAnchorIdx(index)
  }, [visible, itemKey])

  const selectRange = useCallback((from: number, to: number) => {
    const start = Math.min(from, to)
    const end = Math.max(from, to)
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      for (let i = start; i <= end; i++) {
        const item = visible[i]
        if (item) next.add(itemKey(item))
      }
      return next
    })
    setSelectAnchorIdx(to)
  }, [visible, itemKey])

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set())
    setSelectAnchorIdx(null)
  }, [])

  // Escape key clears selection — uses ref to avoid re-subscribing on every toggle
  const selectedCountRef = useRef(0)
  selectedCountRef.current = selectedKeys.size
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCountRef.current > 0) {
        clearSelection()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearSelection])

  // Reset selection on kind filter change
  useEffect(() => {
    clearSelection()
  }, [kindFilter, clearSelection])

  // Handle card click — supports Ctrl/Cmd toggle and Shift range
  const handleCardClick = useCallback((e: React.MouseEvent, index: number) => {
    if (e.shiftKey && selectAnchorIdx !== null) {
      e.preventDefault()
      selectRange(selectAnchorIdx, index)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      toggleItem(index)
      return
    }
    // Plain click with active selection: toggle the item instead of opening
    if (selectedKeys.size > 0) {
      toggleItem(index)
      return
    }
    // Plain click, nothing selected: open the item
    const item = visible[index]
    if (item) open(item)
  }, [selectAnchorIdx, selectedKeys, visible, selectRange, toggleItem, open])

  // AbortController for the in-flight `media:list` call. Replaced on every
  // reset (topId change, kindFilter change, unmount) so the server's
  // recursive `scanSessionDirectory` bails out instead of running to
  // completion after the UI has moved on.
  const loadAbortRef = useRef<AbortController | null>(null)
  // Bumped every reset. Stale page-completions bail on mismatch.
  const loadRunRef = useRef(0)

  // Reset + initial-page trigger. Runs once per topId OR kindFilter change.
  useEffect(() => {
    loadRunRef.current += 1
    const runId = loadRunRef.current
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    setItems([])
    setCursor(null)
    setHasMore(false)
    setError(null)
    setInitialLoading(true)
    void loadPage({ limit: PAGE_LIMIT }, runId, controller.signal)
    return () => {
      // Top-of-list changed again (or panel unmounted) — cancel this run.
      controller.abort()
    }
    // loadPage / topId+kindFilter is the dependency we intentionally want
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId, kindFilter])

  /** Fetch one server page and merge its classified items into state. */
  async function loadPage(request: MediaListRequest, runId: number, signal: AbortSignal): Promise<void> {
    const kindFilterForRequest = kindFilter === 'all' ? undefined : kindFilter
    try {
      const page: MediaListPage = await window.electronAPI.mediaList(
        { ...request, kind: kindFilterForRequest },
        signal,
      )
      // Stale runId: a reset fired mid-flight and we don't own the cursor
      // anymore. Drop the result silently.
      if (runId !== loadRunRef.current) return
      if (signal.aborted) return

      setItems((prev) => {
        const seen = new Set(prev.map((i) => `${i.sessionId}::${i.path}`))
        const additions: MediaItem[] = []
        for (const next of page.items) {
          const key = `${next.sessionId}::${next.path}`
          if (seen.has(key)) continue
          seen.add(key)
          additions.push(next)
        }
        return [...prev, ...additions]
      })
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
      setError(null)
    } catch (err) {
      if (runId !== loadRunRef.current) return
      // AbortError is expected on reset/unmount — silently swallow.
      if ((err as { name?: string } | null)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (runId === loadRunRef.current) {
        setPageLoading(false)
        setInitialLoading(false)
      }
    }
  }

  // Prefetch the next server page when the grid approaches the bottom.
  // `loadNextPage` re-creates whenever the cursor/hasMore flags flip so the
  // overscan callback always reads the freshest values.
  const loadNextPage = useCallback(() => {
    if (!hasMore || pageLoading || initialLoading) return
    if (!cursor) return
    const signal = loadAbortRef.current?.signal
    if (!signal) return
    setPageLoading(true)
    void loadPage({ cursor, limit: PAGE_LIMIT }, loadRunRef.current, signal)
  }, [hasMore, pageLoading, initialLoading, cursor])

  // ---------- Filter counts (derived from accumulated items, matches prior) ----------

  const counts = useMemo(() => {
    const map = new Map<MediaKind, number>()
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1)
    return map
  }, [items])

  // ---------- Responsive column derivation (unchanged) ----------

  const columnCount = useMemo(() => {
    if (containerSize.width <= 0) return 1
    return Math.max(1, Math.floor((containerSize.width + GAP) / (CARD_MIN_WIDTH + GAP)))
  }, [containerSize.width])
  const columnWidth = useMemo(() => {
    if (containerSize.width <= 0 || columnCount <= 0) return CARD_MIN_WIDTH
    return Math.max(1, Math.floor(containerSize.width / columnCount))
  }, [containerSize.width, columnCount])
  const rowCount = Math.max(1, Math.ceil(visible.length / columnCount))

  // Clear react-window's measurement cache when columns flip (window resize).
  useEffect(() => {
    gridRef.current?.resetAfterIndices({
      columnIndex: 0,
      rowIndex: 0,
    })
  }, [containerSize.width, columnCount])

  const handleItemsRendered = useCallback(
    ({ overscanRowStopIndex }: { overscanRowStopIndex: number }) => {
      if (initialLoading || pageLoading || !hasMore) return
      if (overscanRowStopIndex >= rowCount - PREFETCH_ROWS) {
        loadNextPage()
      }
    },
    [initialLoading, pageLoading, hasMore, rowCount, loadNextPage],
  )

  // ---------- Footer (pager + end-of-list) — same innerElementType pattern ----------

  const pagerNode = (
    <div className="media-panel__pager" role="status" aria-live="polite">
      <Loader2 size={14} className="media-panel__pager-spin" />
      <span>Loading more sessions…</span>
    </div>
  )
  const endNode = (
    <div className="media-panel__end" role="presentation">
      End of recent sessions
    </div>
  )

  const footerNode = useMemo(
    () => (
      <>
        {pageLoading && !initialLoading && pagerNode}
        {!hasMore && !initialLoading && items.length > 0 && endNode}
      </>
    ),
    [pageLoading, initialLoading, hasMore, items.length],
  )

  const footerHeight = useMemo(() => {
    let h = 0
    if (pageLoading && !initialLoading) h += PAGER_HEIGHT_APPROX
    if (!hasMore && !initialLoading && items.length > 0) h += END_HEIGHT_APPROX
    return h
  }, [pageLoading, initialLoading, hasMore, items.length])

  const footerRef = useRef<{ node: React.ReactNode; height: number }>({ node: null, height: 0 })
  footerRef.current = { node: footerNode, height: footerHeight }

  const InnerWithFooter = useMemo(
    () =>
      React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
        function InnerWithFooter(props, ref) {
          const baseHeight = typeof props.style?.height === 'number' ? props.style.height : 0
          return (
            <div
              ref={ref}
              {...props}
              style={{
                ...props.style,
                height: baseHeight + footerRef.current.height,
              }}
            >
              {props.children}
              {footerRef.current.node}
            </div>
          )
        },
      ),
    [],
  )

  // ── Context menu handlers ──────────────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault()
      e.stopPropagation()
      const item = visible[index]
      if (!item) return
      setContextMenu({ x: e.clientX, y: e.clientY, item })
    },
    [visible],
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleShowInFolder = useCallback(() => {
    if (!contextMenu?.item) return
    window.electronAPI.showInFolder(contextMenu.item.path).catch(() => {})
    closeContextMenu()
  }, [contextMenu, closeContextMenu])

  const handleOpenFromContext = useCallback(() => {
    if (!contextMenu?.item) return
    open(contextMenu.item)
    closeContextMenu()
  }, [contextMenu, open, closeContextMenu])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu()
    }
    // Delay listener registration so the right-click that opened it doesn't close it immediately
    const tick = setTimeout(() => {
      document.addEventListener('mousedown', handleClick)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)
    return () => {
      clearTimeout(tick)
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu, closeContextMenu])

  const batchDownload = useCallback(async () => {
    const selected = items.filter((i) => selectedKeys.has(itemKey(i)))
    if (selected.length === 0) return
    // Open each selected file via the shell — the OS handles the download/save dialog
    for (const item of selected) {
      try {
        onOpenFile(item.path)
      } catch {
        // best-effort: some files may fail to open
      }
    }
    clearSelection()
  }, [items, selectedKeys, itemKey, onOpenFile, clearSelection])

  /**
   * Hide the selected items from this view. This is a VIEW-LOCAL operation:
   * nothing is written, moved, or removed on disk, and the items reappear on
   * the next load. That is the intended behaviour — the button is labelled
   * "Hide" — but it was previously wearing a trash-can icon and destructive
   * red styling, which read as "delete these files".
   *
   * There is deliberately no delete here. Media items are session artifacts
   * resolved server-side from workspace session directories; a real delete
   * needs its own path-validated RPC (see the handoff plan) rather than a
   * renderer-side call that could be handed an arbitrary path.
   */
  const batchHide = useCallback(async () => {
    const selected = items.filter((i) => selectedKeys.has(itemKey(i)))
    if (selected.length === 0) return
    const keysToRemove = new Set(selected.map(itemKey))
    setItems((prev) => prev.filter((i) => !keysToRemove.has(itemKey(i))))
    clearSelection()
  }, [items, selectedKeys, itemKey, clearSelection])

  const isLibraryLoading = creationTab === 'library' && initialLoading

  return (
    <div className="media-panel">
      <div className="media-panel__header">
        <div className="media-panel__title">
          <Clapperboard size={20} />
          <h2>Media Lab</h2>
          {isLibraryLoading ? (
            <Loader2 size={15} className="media-panel__spinner" />
          ) : (
            creationTab === 'library' && (
              <span
                className="media-panel__count"
                title={
                  kindFilter === 'all'
                    ? `${items.length} media`
                    : `${visible.length} of ${items.length} filtered media`
                }
              >
                {visible.length}
                {hasMore && <span className="media-panel__count-detail">+</span>}
              </span>
            )
          )}
        </div>
        <div className="media-panel__tabs">
          <button
            type="button"
            className={`media-tab media-tab--service${comfyHealth?.connected ? ' is-online' : ''}`}
            disabled={comfyStarting || comfyHealth?.connected}
            onClick={() => void startComfyUI()}
            title={comfyHealth?.connected ? 'ComfyUI is running' : 'Start local ComfyUI'}
          >
            {comfyStarting ? <Loader2 size={14} className="media-panel__spinner" /> : <Power size={14} />}
            {comfyStarting ? 'Starting…' : comfyHealth?.connected ? 'ComfyUI Online' : 'Start ComfyUI'}
          </button>
          <button
            type="button"
            className={`media-tab${creationTab === 'create' ? ' is-active' : ''}`}
            onClick={() => setCreationTab('create')}
          >
            <Sparkles size={14} /> Create
          </button>
          <button
            type="button"
            className={`media-tab${creationTab === 'library' ? ' is-active' : ''}`}
            onClick={() => setCreationTab('library')}
          >
            <FileText size={14} /> Library
          </button>
        </div>
      </div>

      {creationTab === 'create' ? (
        <div className="media-create">
          <div className="media-create__hero">
            <Wand2 size={32} />
            <h3>ComfyUI Creation Station</h3>
            <p>Run your existing local and Agnes workflows without leaving ARCHstudio.</p>
            <div className={`media-create__health${comfyHealth?.connected ? ' is-online' : ''}`}>
              <span />
              {comfyLoading
                ? 'Connecting to ComfyUI…'
                : comfyHealth?.connected
                  ? `ComfyUI ${comfyHealth.version ?? ''} · ${comfyHealth.device ?? 'Ready'}`
                  : 'ComfyUI offline'}
            </div>
          </div>

          <div className="media-create__workspace">
            <div className="media-create__kinds" role="tablist" aria-label="Generation type">
              <button
                type="button"
                role="tab"
                aria-selected={creationKind === 'image'}
                className={creationKind === 'image' ? 'is-active' : ''}
                onClick={() => setCreationKind('image')}
              >
                <Image size={16} /> Image <span>{comfyWorkflows.filter((workflow) => workflow.kind === 'image').length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={creationKind === 'video'}
                className={creationKind === 'video' ? 'is-active' : ''}
                onClick={() => setCreationKind('video')}
              >
                <Video size={16} /> Video <span>{comfyWorkflows.filter((workflow) => workflow.kind === 'video').length}</span>
              </button>
            </div>

            {comfyError && <div className="media-create__error">{comfyError}</div>}

            {!comfyLoading && creationWorkflows.length === 0 ? (
              <div className="media-create__empty">No compatible {creationKind} workflows were found.</div>
            ) : selectedWorkflow ? (
              <div className="media-create__form">
                <label className="media-create__field media-create__field--wide">
                  <span>Workflow</span>
                  <select
                    value={selectedWorkflow.id}
                    onChange={(event) => setSelectedWorkflowId(event.target.value)}
                  >
                    {creationWorkflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
                    ))}
                  </select>
                </label>

                <div className="media-create__parameters">
                  {selectedWorkflow.parameters.map((parameter) => (
                    <label
                      key={parameter.id}
                      className={`media-create__field${parameter.kind === 'text' ? ' media-create__field--wide' : ''}`}
                    >
                      <span>{parameter.label}</span>
                      {parameter.kind === 'text' ? (
                        <textarea
                          rows={4}
                          value={String(workflowValues[parameter.id] ?? '')}
                          onChange={(event) => setWorkflowValues((values) => ({ ...values, [parameter.id]: event.target.value }))}
                        />
                      ) : (
                        <input
                          type={['number', 'seed'].includes(parameter.kind) ? 'number' : 'text'}
                          value={workflowValues[parameter.id] ?? ''}
                          onChange={(event) => setWorkflowValues((values) => ({
                            ...values,
                            [parameter.id]: ['number', 'seed'].includes(parameter.kind)
                              ? Number(event.target.value)
                              : event.target.value,
                          }))}
                        />
                      )}
                    </label>
                  ))}
                </div>

                <div className="media-create__actions">
                  <button
                    type="button"
                    className="media-create__run"
                    disabled={!comfyHealth?.connected || comfySubmitting || !!comfyJob && ['queued', 'running', 'unknown'].includes(comfyJob.state)}
                    onClick={() => void runComfyWorkflow()}
                  >
                    {comfySubmitting ? <Loader2 size={15} className="media-panel__spinner" /> : <Sparkles size={15} />}
                    Run {creationKind} workflow
                  </button>
                  {comfyJob && ['queued', 'running', 'unknown'].includes(comfyJob.state) && (
                    <button type="button" className="media-create__cancel" onClick={() => void cancelComfyJob()}>
                      <X size={15} /> Cancel
                    </button>
                  )}
                  {comfyJob && (
                    <span className={`media-create__job is-${comfyJob.state}`}>
                      {comfyJob.state} · {comfyJob.promptId.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <p className="media-create__note">
            {comfyRejectedCount > 0 && `${comfyRejectedCount} non-API JSON files were safely excluded. `}
            Outputs remain under D:\Comfyui\output.
          </p>
        </div>
      ) : (
        <>
          <div className="media-panel__filters">
            <button
              type="button"
              className={`media-chip${kindFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setKindFilter('all')}
            >
              All <span>{items.length}</span>
            </button>
            {(Object.keys(EXT) as MediaKind[])
              .filter((kind) => counts.get(kind))
              .map((kind) => {
                const Icon = KIND_ICON[kind]
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`media-chip${kindFilter === kind ? ' is-active' : ''}`}
                    onClick={() => setKindFilter(kind)}
                  >
                    <Icon size={13} />
                    {kind} <span>{counts.get(kind)}</span>
                  </button>
                )
              })}
          </div>

          <div className="media-panel__viewport" ref={viewportRef}>
            {/* Floating action bar when items are selected */}
            {selectedKeys.size > 0 && (
              <div className="media-panel__actions">
                <div className="media-panel__actions-info">
                  <CheckSquare size={16} />
                  <span className="media-panel__actions-count">{selectedKeys.size} selected</span>
                </div>
                <div className="media-panel__actions-buttons">
                  <button
                    type="button"
                    className="media-action-btn"
                    onClick={() => void batchDownload()}
                    title="Open all selected files"
                  >
                    <Download size={14} />
                    Download ({selectedKeys.size})
                  </button>
                  {/* Not destructive — hides from this view only, nothing is
                      touched on disk. Uses EyeOff rather than a trash can, and
                      no --danger styling, so the affordance matches what it
                      actually does. */}
                  <button
                    type="button"
                    className="media-action-btn"
                    onClick={() => void batchHide()}
                    title="Hide from this view — files are not deleted"
                  >
                    <EyeOff size={14} />
                    Hide ({selectedKeys.size})
                  </button>
                  <button
                    type="button"
                    className="media-action-btn media-action-btn--clear"
                    onClick={clearSelection}
                    title="Clear selection"
                  >
                    <X size={14} />
                    Done
                  </button>
                </div>
              </div>
            )}
            {/* Context menu */}
            {contextMenu && (
              <div
                ref={contextMenuRef}
                className="media-context-menu"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                <button
                  type="button"
                  className="media-context-menu__item"
                  onClick={handleOpenFromContext}
                >
                  <ExternalLink size={13} />
                  Open File
                </button>
                <button
                  type="button"
                  className="media-context-menu__item"
                  onClick={handleShowInFolder}
                >
                  <FolderOpen size={13} />
                  Show in Folder
                </button>
              </div>
            )}

            {error ? (
              <div className="media-panel__error">{error}</div>
            ) : initialLoading ? (
              <div className="media-panel__loading">
                <Loader2 size={20} className="media-panel__spinner" />
              </div>
            ) : visible.length === 0 ? (
              <div className="media-panel__empty">
                <Clapperboard size={48} />
                <p>No media found</p>
                <span>Images, video, audio and documents produced by your sessions appear here.</span>
              </div>
            ) : containerSize.width > 0 && containerSize.height > 0 ? (
              <VariableSizeGrid
                ref={gridRef}
                columnCount={columnCount}
                rowCount={rowCount}
                columnWidth={() => columnWidth}
                rowHeight={() => ROW_HEIGHT}
                width={containerSize.width}
                height={containerSize.height}
                overscanRowCount={4}
                innerElementType={InnerWithFooter}
                onItemsRendered={handleItemsRendered}
              >
                {({
                  columnIndex,
                  rowIndex,
                  style,
                }: {
                  columnIndex: number
                  rowIndex: number
                  style: React.CSSProperties
                }) => {
                  const item = visible[rowIndex * columnCount + columnIndex]
                  if (!item) return null
                  const isLastCol = columnIndex === columnCount - 1
                  const isLastRow = rowIndex === rowCount - 1
                  const Icon = KIND_ICON[item.kind]
                  return (
                    <div
                      style={{
                        ...style,
                        paddingRight: isLastCol ? 0 : GAP,
                        paddingBottom: isLastRow ? 0 : GAP,
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        className={[
                          'media-card',
                          selectedKeys.has(itemKey(item)) && 'media-card--selected',
                        ].filter(Boolean).join(' ')}
                        onClick={(e) => handleCardClick(e, rowIndex * columnCount + columnIndex)}
                        onContextMenu={(e) => handleContextMenu(e, rowIndex * columnCount + columnIndex)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleCardClick(e as unknown as React.MouseEvent, rowIndex * columnCount + columnIndex)
                          }
                        }}
                        title={item.path}
                        role="option"
                        aria-selected={selectedKeys.has(itemKey(item))}
                        tabIndex={0}
                      >
                        <div className={`media-card__preview is-${item.kind}`}>
                          {item.kind === 'image' ? (
                            <img src={`file://${item.path}`} alt={item.name} loading="lazy" />
                          ) : (
                            <Icon size={28} />
                          )}
                          {/* Selection checkbox overlay */}
                          <div className="media-card__select-overlay">
                            <div className="media-card__checkbox">
                              {selectedKeys.has(itemKey(item)) ? (
                                <CheckSquare size={18} className="media-card__checkbox-checked" />
                              ) : (
                                <div className="media-card__checkbox-ring" />
                              )}
                            </div>
                          </div>
                        </div>                          <div className="media-card__body">
                            <span className="media-card__name">
                              {item.name}
                              {isRecentlyGenerated(item.mtime) && (
                                <span className="media-card__badge-recent">
                                  <Sparkles size={11} />
                                  Recently generated
                                </span>
                              )}
                            </span>
                            <span className="media-card__meta">
                              {formatSize(item.size)}
                              {item.size ? ' · ' : ''}
                              {item.sessionTitle}
                            </span>
                          </div>
                        <ExternalLink size={13} className="media-card__open" />
                      </div>
                    </div>
                  )
                }}
              </VariableSizeGrid>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
