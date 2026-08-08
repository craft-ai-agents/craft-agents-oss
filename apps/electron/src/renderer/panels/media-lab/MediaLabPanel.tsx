import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VariableSizeGrid, type VariableSizeGrid as VariableSizeGridType } from 'react-window'
import { Clapperboard, Image, Music, Video, FileText, Loader2, ExternalLink, Sparkles, Wand2, Download, EyeOff, X, CheckSquare, FolderOpen, Power, Cpu, Gauge, Clock3, Layers3, ChevronDown, RotateCcw, PlayCircle, Pause, Volume2, VolumeX, Maximize2, SkipBack, Scissors, Drum } from 'lucide-react'
import type {
  ComfyHealth,
  ComfyJobStatus,
  ComfyWorkflowSummary,
  MediaItem,
  MediaKind,
  MediaListPage,
  MediaListRequest,
} from '@archstudio/shared/protocol'
import { useAppShellContext } from '../../context/AppShellContext'
import { StemSplitterPanel } from './StemSplitterPanel'
import { BeatMakerPanel } from './BeatMakerPanel'
import { RemixTimelinePanel } from './RemixTimelinePanel'
import { MusicPlayer } from './MusicPlayer'
import './MediaLabPanel.css'
import './MusicStudio.css'

const KIND_ICON: Record<MediaKind, typeof Image> = {
  image: Image,
  video: Video,
  audio: Music,
  doc: FileText,
}

/** The media kinds the Create tab can generate. `doc` is library-only. */
type CreationKind = 'image' | 'video' | 'audio'

/**
 * Per-studio copy. A three-way branch inline at every call site was the
 * alternative; this keeps the wording for a mode in one place.
 *
 * `outputFolder` must match the server's namespacing in
 * `integrations/comfyui/workflow.ts` — note audio is `audio`, not `audios`,
 * so it cannot be derived by pluralising the kind.
 */
const STUDIO: Record<CreationKind, {
  label: string
  icon: typeof Image
  eyebrow: string
  heading: string
  promptPlaceholder: string
  outputFolder: string
}> = {
  image: {
    label: 'Image Studio',
    icon: Image,
    eyebrow: 'IMAGE',
    heading: 'Compose an image',
    promptPlaceholder: 'Describe the composition, subject, lighting and atmosphere…',
    outputFolder: 'images',
  },
  video: {
    label: 'Video Studio',
    icon: Video,
    eyebrow: 'VIDEO',
    heading: 'Direct a sequence',
    promptPlaceholder: 'Describe the action, camera movement, pacing and atmosphere…',
    outputFolder: 'videos',
  },
  audio: {
    label: 'Music Studio',
    icon: Music,
    eyebrow: 'AUDIO',
    heading: 'Score a track',
    promptPlaceholder: 'Describe the genre, instrumentation, tempo and mood…',
    outputFolder: 'audio',
  },
}

const CREATION_KINDS = Object.keys(STUDIO) as CreationKind[]

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
/** Approximate height of the "Loading more creations…" pager block. */
const PAGER_HEIGHT_APPROX = 56
/** Approximate height of the output-library end-cap. */
const END_HEIGHT_APPROX = 56

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatVram(bytes?: number): string {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function workflowProvider(workflow: ComfyWorkflowSummary | null): string {
  if (!workflow) return 'ComfyUI'
  return workflow.nodeClasses.some((name) => name.toLowerCase().includes('agnes')) ? 'Agnes' : 'Local'
}

const ONE_HOUR_MS = 60 * 60 * 1000

function isRecentlyGenerated(mtime?: number): boolean {
  if (!mtime) return false
  return Date.now() - mtime < ONE_HOUR_MS
}

function MediaVideoPlayer({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.readFileDataUrl(item.path)
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [item.path])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="media-video-overlay" role="dialog" aria-modal="true" aria-label={`Playing ${item.name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="media-video-overlay__panel">
        <div className="media-video-overlay__header">
          <div><span>MEDIA LAB / VIDEO</span><strong>{item.name}</strong></div>
          <button type="button" onClick={onClose} aria-label="Close video"><X size={17} /></button>
        </div>
        <div ref={stageRef} className="media-video-overlay__stage">
          {error ? <div className="media-panel__error">{error}</div> : src ? (
            <video
              ref={videoRef}
              src={src}
              autoPlay
              playsInline
              muted={muted}
              onClick={() => playing ? videoRef.current?.pause() : void videoRef.current?.play()}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onError={() => setError('Chromium could not decode this video file.')}
            />
          ) : <Loader2 size={24} className="media-panel__spinner" />}
          {src && (
            <div className="media-video-controls">
              <input
                className="media-video-controls__timeline"
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={currentTime}
                aria-label="Video position"
                style={{ '--media-progress': `${duration ? currentTime / duration * 100 : 0}%` } as React.CSSProperties}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (videoRef.current) videoRef.current.currentTime = value
                  setCurrentTime(value)
                }}
              />
              <div className="media-video-controls__row">
                <button type="button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = 0 }} aria-label="Restart video"><SkipBack size={16} /></button>
                <button type="button" className="is-primary" onClick={() => playing ? videoRef.current?.pause() : void videoRef.current?.play()} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <PlayCircle size={18} />}</button>
                <button type="button" onClick={() => { const next = !muted; setMuted(next); if (videoRef.current) videoRef.current.muted = next }} aria-label={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
                <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume" onChange={(event) => { const value = Number(event.target.value); setVolume(value); setMuted(value === 0); if (videoRef.current) { videoRef.current.volume = value; videoRef.current.muted = value === 0 } }} />
                <span className="media-video-controls__time">{formatElapsed(currentTime * 1000)} <i>/</i> {formatElapsed(duration * 1000)}</span>
                <span className="media-video-controls__spacer" />
                <span className="media-video-controls__badge">MP4</span>
                <button type="button" onClick={() => void stageRef.current?.requestFullscreen()} aria-label="Fullscreen"><Maximize2 size={16} /></button>
              </div>
            </div>
          )}
        </div>
        <div className="media-video-overlay__footer">
          <div><span>LOCAL CREATION</span><strong>{formatSize(item.size)} · {item.sessionTitle}</strong></div>
          <button type="button" onClick={() => window.electronAPI.showInFolder(item.path)}><FolderOpen size={14} /> Reveal output</button>
        </div>
      </div>
    </div>
  )
}

function MediaImageThumbnail({ item }: { item: MediaItem }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)
    window.electronAPI.readFilePreviewDataUrl(item.path, 256)
      .then((value) => { if (!cancelled) setSrc(value) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [item.path])

  if (failed) return <Image size={28} />
  if (!src) return <Loader2 size={20} className="media-panel__spinner" />
  return <img src={src} alt={item.name} loading="lazy" />
}

export function MediaLabPanel() {
  const { onOpenFile } = useAppShellContext()
  const [kindFilter, setKindFilter] = useState<MediaKind | 'all'>('all')
  const [previewVideo, setPreviewVideo] = useState<MediaItem | null>(null)
  const [creationTab, setCreationTab] = useState<'create' | 'library' | 'stems' | 'beats' | 'remix'>('create')
  const [comfyHealth, setComfyHealth] = useState<ComfyHealth | null>(null)
  const [comfyWorkflows, setComfyWorkflows] = useState<ComfyWorkflowSummary[]>([])
  const [comfyRejectedCount, setComfyRejectedCount] = useState(0)
  const [creationKind, setCreationKind] = useState<CreationKind>('image')
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')
  const [workflowValues, setWorkflowValues] = useState<Record<string, string | number>>({})
  const [comfyLoading, setComfyLoading] = useState(true)
  const [comfyError, setComfyError] = useState<string | null>(null)
  const [comfyJob, setComfyJob] = useState<ComfyJobStatus | null>(null)
  const [comfySubmitting, setComfySubmitting] = useState(false)
  const [comfyStarting, setComfyStarting] = useState(false)
  const [comfyStopping, setComfyStopping] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [recentArtifacts, setRecentArtifacts] = useState<MediaItem[]>([])
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0)
  const artifactRefreshKey = comfyJob?.state === 'completed' ? comfyJob.promptId : ''

  useEffect(() => {
    if (creationTab !== 'library') return
    const timer = setInterval(() => setArtifactRefreshTick((tick) => tick + 1), 5_000)
    return () => clearInterval(timer)
  }, [creationTab])

  useEffect(() => {
    if (!comfyHealth?.connected) return
    const refresh = async () => {
      try {
        const health = await window.electronAPI.comfyHealth()
        setComfyHealth(health)
      } catch {
        // The main status surface handles connection failures on its next poll.
      }
    }
    const timer = setInterval(() => void refresh(), 2_500)
    return () => clearInterval(timer)
  }, [comfyHealth?.connected])

  useEffect(() => {
    if (!comfyJob || !['queued', 'running', 'unknown'].includes(comfyJob.state)) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [comfyJob?.state])

  useEffect(() => {
    if (creationTab !== 'create') return
    let cancelled = false
    const refresh = async () => {
      try {
        const page = await window.electronAPI.comfyArtifacts({ limit: 6 })
        if (!cancelled) setRecentArtifacts(page.items)
      } catch {
        // Recent output is secondary; primary creation controls remain usable.
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [creationTab, artifactRefreshKey])

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
  const promptParameter = selectedWorkflow?.parameters.find((parameter) => parameter.kind === 'text') ?? null
  const essentialParameters = selectedWorkflow?.parameters.filter((parameter) =>
    parameter.id !== promptParameter?.id && ['model', 'select'].includes(parameter.kind),
  ).slice(0, 4) ?? []
  const advancedParameters = selectedWorkflow?.parameters.filter((parameter) =>
    parameter.id !== promptParameter?.id && !essentialParameters.some((essential) => essential.id === parameter.id),
  ) ?? []
  const vramUsed = Math.max(0, (comfyHealth?.vramTotal ?? 0) - (comfyHealth?.vramFree ?? 0))
  const vramPercent = comfyHealth?.vramTotal ? Math.min(100, Math.round(vramUsed / comfyHealth.vramTotal * 100)) : 0
  const jobActive = !!comfyJob && ['queued', 'running', 'unknown'].includes(comfyJob.state)
  const elapsedFrom = comfyJob?.startedAt ?? jobStartedAt
  const elapsed = elapsedFrom ? formatElapsed((comfyJob?.finishedAt ?? now) - elapsedFrom) : '00:00'

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
      const startedAt = Date.now()
      setJobStartedAt(startedAt)
      setNow(startedAt)
      setComfyJob({ promptId: result.promptId, state: 'queued', stage: 'queued', startedAt })
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

  const stopComfyUI = useCallback(async () => {
    if (comfyStopping || !comfyHealth?.connected) return
    setComfyStopping(true)
    setComfyError(null)
    try {
      const health = await window.electronAPI.comfyStop()
      setComfyHealth(health)
    } catch (stopError) {
      setComfyError(stopError instanceof Error ? stopError.message : String(stopError))
    } finally {
      setComfyStopping(false)
    }
  }, [comfyHealth?.connected, comfyStopping])

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
    if (item.kind === 'video') {
      setPreviewVideo(item)
      return
    }
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
    if (creationTab !== 'library') return
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
  }, [creationTab, artifactRefreshKey, artifactRefreshTick, kindFilter])

  /** Fetch one server page and merge its classified items into state. */
  async function loadPage(request: MediaListRequest, runId: number, signal: AbortSignal): Promise<void> {
    const kindFilterForRequest = kindFilter === 'all' ? undefined : kindFilter
    try {
      const page: MediaListPage = await window.electronAPI.comfyArtifacts(
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
      <span>Loading more creations…</span>
    </div>
  )
  const endNode = (
    <div className="media-panel__end" role="presentation">
      End of ComfyUI creations
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
   * There is deliberately no delete here. Media items are ComfyUI artifacts
   * resolved server-side from the configured output directory; a real delete
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

  const isAudioStudio = creationKind === 'audio'
  const isLibraryLoading = creationTab === 'library' && initialLoading

  return (
    <div className="media-panel">
      {previewVideo && <MediaVideoPlayer item={previewVideo} onClose={() => setPreviewVideo(null)} />}
      <div className="media-console-header">
        <div className="media-console-header__identity">
          <span className="media-console-header__mark"><Clapperboard size={18} /></span>
          <div>
            <h2>Media Lab</h2>
            <p>{isAudioStudio ? 'Music production studio' : 'ComfyUI production console'}</p>
          </div>
        </div>
        {!isAudioStudio && (
        <div className="media-console-header__signals">
          <div className={`media-signal${comfyHealth?.connected ? ' is-live' : ' is-offline'}`}>
            <span className="media-signal__pulse" />
            <div><small>Engine</small><strong>{comfyHealth?.connected ? 'Online' : 'Offline'}</strong></div>
          </div>
          <div className="media-signal media-signal--gpu" title={comfyHealth?.device}>
            <Cpu size={15} />
            <div><small>GPU</small><strong>{comfyHealth?.device?.replace('NVIDIA GeForce ', '') ?? 'Unavailable'}</strong></div>
          </div>
          <div className="media-signal media-signal--vram">
            <Gauge size={15} />
            <div>
              <small>VRAM <b>{vramPercent}%</b></small>
              <strong>{formatVram(vramUsed)} / {formatVram(comfyHealth?.vramTotal)}</strong>
              <span className="media-vram-track"><i style={{ width: `${vramPercent}%` }} /></span>
            </div>
          </div>
          <div className="media-signal">
            <Layers3 size={15} />
            <div><small>Queue</small><strong>{comfyHealth?.queueRunning ?? 0} active · {comfyHealth?.queuePending ?? 0} waiting</strong></div>
          </div>
        </div>
        )}
        {isAudioStudio && (
        <div className="media-console-header__signals">
          <div className="media-signal is-live">
            <span className="media-signal__pulse" />
            <div><small>Audio engine</small><strong>Python + Demucs</strong></div>
          </div>
          <div className="media-signal">
            <Music size={15} />
            <div><small>Tracks</small><strong>{recentArtifacts.filter((i) => i.kind === 'audio').length} available</strong></div>
          </div>
        </div>
        )}
        <div className="media-panel__tabs">
          {!isAudioStudio && (
            <>
            {comfyHealth?.connected ? (
              <button type="button" className="media-tab media-tab--service is-online" disabled={comfyStopping} onClick={() => void stopComfyUI()}>
                {comfyStopping ? <Loader2 size={14} className="media-panel__spinner" /> : <Power size={14} />}
                {comfyStopping ? 'Stopping…' : 'Stop engine'}
              </button>
            ) : (
              <button type="button" className="media-tab media-tab--service" disabled={comfyStarting} onClick={() => void startComfyUI()}>
                {comfyStarting ? <Loader2 size={14} className="media-panel__spinner" /> : <Power size={14} />}
                {comfyStarting ? 'Starting…' : 'Start engine'}
              </button>
            )}
            </>
          )}
          <button type="button" className={`media-tab${creationTab === 'create' ? ' is-active' : ''}`} onClick={() => setCreationTab('create')}>
            <Sparkles size={14} /> {isAudioStudio ? 'Player' : 'Create'}
          </button>
          <button type="button" className={`media-tab${creationTab === 'library' ? ' is-active' : ''}`} onClick={() => setCreationTab('library')}>
            {isAudioStudio ? <Music size={14} /> : <Video size={14} />} Library
            {isLibraryLoading ? <Loader2 size={12} className="media-panel__spinner" /> : recentArtifacts.length > 0 && <span>{isAudioStudio ? recentArtifacts.filter((i) => i.kind === 'audio').length : recentArtifacts.length}</span>}
          </button>
          {isAudioStudio && (
            <>
              <button type="button" className={`media-tab${creationTab === 'stems' ? ' is-active' : ''}`} onClick={() => setCreationTab('stems')}>
                <Scissors size={14} /> Stems
              </button>
              <button type="button" className={`media-tab${creationTab === 'beats' ? ' is-active' : ''}`} onClick={() => setCreationTab('beats')}>
                <Drum size={14} /> Beats
              </button>
              <button type="button" className={`media-tab${creationTab === 'remix' ? ' is-active' : ''}`} onClick={() => setCreationTab('remix')}>
                <Layers3 size={14} /> Remix
              </button>
            </>
          )}
        </div>
      </div>

      {creationTab === 'stems' && <StemSplitterPanel />}
      {creationTab === 'beats' && <BeatMakerPanel />}
      {creationTab === 'remix' && <RemixTimelinePanel />}

      {creationTab === 'create' ? (
        <div className="media-studio">
          <aside className="media-studio__rail">
            <div className="media-studio__rail-label">Studio mode</div>
            {CREATION_KINDS.map((kind) => {
              const studio = STUDIO[kind]
              const ModeIcon = studio.icon
              const count = comfyWorkflows.filter((workflow) => workflow.kind === kind).length
              return (
                <button
                  key={kind}
                  type="button"
                  className={creationKind === kind ? 'is-active' : ''}
                  onClick={() => { setCreationKind(kind); if (kind === 'audio') setKindFilter('audio') }}
                >
                  <span className={`media-studio__mode-icon is-${kind}`}><ModeIcon size={18} /></span>
                  <div><strong>{studio.label}</strong><small>{count} workflows</small></div>
                </button>
              )
            })}
            <div className="media-studio__rail-foot">
              <span>Output namespace</span>
              <code>ARCHstudio/{STUDIO[creationKind].outputFolder}</code>
              <small>{comfyRejectedCount} incompatible workflow files excluded</small>
            </div>
          </aside>

          <main className="media-studio__main">
            {creationKind === 'audio' ? (
              <MusicPlayer />
            ) : (
            <>
            <section className="media-composer">
              <div className="media-composer__eyebrow">
                <span>{STUDIO[creationKind].eyebrow} / {workflowProvider(selectedWorkflow).toUpperCase()}</span>
                <span className={comfyHealth?.connected ? 'is-ready' : 'is-offline'}>{comfyHealth?.connected ? 'READY TO CREATE' : 'ENGINE OFFLINE'}</span>
              </div>
              <div className="media-composer__heading">
                <div>
                  <h3>{STUDIO[creationKind].heading}</h3>
                  <p>Choose a proven workflow, describe the result, then monitor every stage below.</p>
                </div>
                <label className="media-composer__workflow">
                  <span>Workflow</span>
                  <select value={selectedWorkflow?.id ?? ''} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
                    {creationWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
                  </select>
                </label>
              </div>

              {comfyError && <div className="media-create__error">{comfyError}</div>}
              {!comfyLoading && !selectedWorkflow ? (
                <div className="media-create__empty">No compatible {creationKind} workflows were found.</div>
              ) : selectedWorkflow ? (
                <>
                  {promptParameter && (
                    <label className="media-prompt-field">
                      <span>Creative direction</span>
                      <textarea
                        rows={6}
                        placeholder={STUDIO[creationKind].promptPlaceholder}
                        value={String(workflowValues[promptParameter.id] ?? '')}
                        onChange={(event) => setWorkflowValues((values) => ({ ...values, [promptParameter.id]: event.target.value }))}
                      />
                    </label>
                  )}
                  {essentialParameters.length > 0 && (
                    <div className="media-essential-grid">
                      {essentialParameters.map((parameter) => (
                        <label key={parameter.id} className="media-create__field">
                          <span>{parameter.label}</span>
                          {parameter.options?.length ? (
                            <select value={workflowValues[parameter.id] ?? ''} onChange={(event) => setWorkflowValues((values) => ({ ...values, [parameter.id]: event.target.value }))}>
                              {parameter.options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : (
                            <input value={workflowValues[parameter.id] ?? ''} onChange={(event) => setWorkflowValues((values) => ({ ...values, [parameter.id]: event.target.value }))} />
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                  {advancedParameters.length > 0 && (
                    <div className="media-advanced">
                      <button type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                        <span><Gauge size={14} /> Advanced controls <small>{advancedParameters.length} parameters</small></span>
                        <ChevronDown size={15} className={advancedOpen ? 'is-open' : ''} />
                      </button>
                      {advancedOpen && (
                        <div className="media-create__parameters">
                          {advancedParameters.map((parameter) => (
                            <label key={parameter.id} className="media-create__field">
                              <span>{parameter.label}</span>
                              {parameter.options?.length ? (
                                <select value={workflowValues[parameter.id] ?? ''} onChange={(event) => setWorkflowValues((values) => ({ ...values, [parameter.id]: event.target.value }))}>
                                  {parameter.options.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                              ) : (
                                <input
                                  type={['number', 'seed'].includes(parameter.kind) ? 'number' : 'text'}
                                  value={workflowValues[parameter.id] ?? ''}
                                  onChange={(event) => setWorkflowValues((values) => ({ ...values, [parameter.id]: ['number', 'seed'].includes(parameter.kind) ? Number(event.target.value) : event.target.value }))}
                                />
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="media-composer__actions">
                    <button type="button" className="media-create__run" disabled={!comfyHealth?.connected || comfySubmitting || jobActive} onClick={() => void runComfyWorkflow()}>
                      {comfySubmitting ? <Loader2 size={16} className="media-panel__spinner" /> : <Sparkles size={16} />}
                      {jobActive ? 'Generation in progress' : `Generate ${creationKind}`}
                    </button>
                    <span>{!comfyHealth?.connected ? 'Start ComfyUI to enable generation' : `${workflowProvider(selectedWorkflow)} workflow � outputs stay on D:`}</span>
                  </div>
                </>
              ) : null}
            </section>

            <section className={`media-live-stage${jobActive ? ' is-active' : ''}${comfyJob?.state === 'failed' ? ' is-failed' : ''}${comfyJob?.state === 'completed' ? ' is-complete' : ''}`}>
              <div className="media-live-stage__visual">
                <span className="media-live-stage__orbit"><i /><i /><i /></span>
                {comfyJob?.state === 'completed' ? <CheckSquare size={28} /> : comfyJob?.state === 'failed' ? <X size={28} /> : <Wand2 size={28} />}
              </div>
              <div className="media-live-stage__content">
                <div className="media-live-stage__topline">
                  <span>LIVE GENERATION</span>
                  {comfyJob && <code>{comfyJob.promptId.slice(0, 8)}</code>}
                </div>
                <h4>{!comfyJob ? 'No active generation' : comfyJob.state === 'queued' ? 'Waiting for an execution slot' : comfyJob.state === 'running' || comfyJob.state === 'unknown' ? 'ComfyUI is executing your workflow' : comfyJob.state === 'completed' ? 'Creation completed' : 'Generation stopped'}</h4>
                <p>{comfyJob?.error ?? (comfyJob?.currentNode ? `Current node: ${comfyJob.currentNode}` : jobActive ? `${selectedWorkflow?.name ?? 'Workflow'} is active. Progress updates automatically.` : 'Your next run will appear here with queue, execution and completion state.')}</p>
                {jobActive && <span className="media-live-stage__progress"><i style={{ width: comfyJob?.progress ? `${comfyJob.progress}%` : '38%' }} /></span>}
              </div>
              <div className="media-live-stage__stats">
                <div><Clock3 size={14} /><span>Elapsed</span><strong>{elapsed}</strong></div>
                <div><Layers3 size={14} /><span>Stage</span><strong>{comfyJob?.stage ?? comfyJob?.state ?? 'Idle'}</strong></div>
                {jobActive && <button type="button" onClick={() => void cancelComfyJob()}><X size={14} /> Interrupt</button>}
                {comfyJob && !jobActive && selectedWorkflow && <button type="button" onClick={() => void runComfyWorkflow()}><RotateCcw size={14} /> Run again</button>}
              </div>
            </section>

            <section className="media-recent">
              <div className="media-recent__header">
                <div><span>RECENT OUTPUT</span><h4>Your latest creations</h4></div>
                <button type="button" onClick={() => setCreationTab('library')}>Open full library <ExternalLink size={13} /></button>
              </div>
              <div className="media-recent__grid">
                {recentArtifacts.filter((item) => item.kind === creationKind).length === 0 ? <p>No ARCHstudio {creationKind} creations found yet.</p> : recentArtifacts.filter((item) => item.kind === creationKind).slice(0, 6).map((item) => {
                  const Icon = KIND_ICON[item.kind]
                  return (
                    <button type="button" key={item.path} className="media-recent-card" onClick={() => open(item)}>
                      <span className={`media-recent-card__preview is-${item.kind}`}>
                        {item.kind === 'image' ? <MediaImageThumbnail item={item} /> : <><Icon size={24} /><PlayCircle size={30} className="media-recent-card__play" /></>}
                      </span>
                      <strong>{item.name}</strong><small>{item.kind} � {formatSize(item.size)}</small>
                    </button>
                  )
                })}
              </div>
            </section>
            </>
            )}
          </main>
        </div>
      ) : (
        <>
          <div className="media-panel__filters">
            <button
              type="button"
              className={`media-chip${kindFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setKindFilter('all')}
            >
              {isAudioStudio ? 'Audio' : 'All'} <span>{isAudioStudio ? (counts.get('audio') ?? 0) : items.length}</span>
            </button>
            {(['image', 'video', 'audio'] as const)
              .filter((kind) => !isAudioStudio || kind === 'audio')
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
                <p>No ComfyUI creations found</p>
                <span>Creations generated through this app appear under D:\Comfyui\output\ARCHstudio.</span>
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
                            <MediaImageThumbnail item={item} />
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
