import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Layers,
  User,
  Clock,
  Globe,
  Sliders,
  ToggleLeft,
  ToggleRight,
  GripVertical,
  Copy,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  History,
  Loader2,
  AlertCircle,
  Zap,
  Shield,
  BookOpen,
  Cpu,
  HardDrive,
  Wifi,
  GitCompare,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { useAtomValue } from 'jotai'
import { activeSessionIdAtom, sessionMetaMapAtom } from '../../atoms/sessions'
import type { CompileOptions, CompileResult } from '@archstudio/shared/prompts/owner/types'
import { toast } from 'sonner'
import { diffLines, groupDiffHunks, type DiffLine } from './diffUtils'
import './PromptStudioPanel.css'

type LayerDef = {
  id: string
  name: string
  stability: 'stable' | 'volatile'
  enabled: boolean
}

const BUILT_IN_LAYERS: LayerDef[] = [
  { id: 'runtime-contract', name: 'Runtime & Environment', stability: 'stable', enabled: true },
  { id: 'owner-identity',   name: 'Owner Identity & Tone',   stability: 'stable',   enabled: true },
  { id: 'execution-policy', name: 'Execution Policy',         stability: 'stable',   enabled: true },
  { id: 'project-context',  name: 'Project Context',          stability: 'stable',   enabled: true },
  { id: 'skills',           name: 'Active Skills',            stability: 'volatile', enabled: true },
  { id: 'memory',           name: 'Retrieved Memory',         stability: 'volatile', enabled: true },
  { id: 'session-state',    name: 'Session State',            stability: 'volatile', enabled: true },
  { id: 'capabilities',     name: 'Capabilities & Tools',     stability: 'volatile', enabled: true },
]

type Profile = {
  name: string
  tz: string
  tone: string
  mode: string
}

/**
 * A row in `compactDiff`: either a real diff line, or a synthetic marker for a
 * collapsed run of unchanged lines. `ellipsis` is renderer-only — it never
 * comes back from `diffLines()`.
 */
type CompactDiffLine = {
  type: DiffLine['type'] | 'ellipsis'
  content: string
  hidden?: boolean
}

type VersionEntry = {
  id: string
  time: string
  timestamp: number
  layers: number
  tokens: number
  prompt: string
}

const LAYER_ICONS: Record<string, LucideIcon> = {
  'runtime-contract': Zap,
  'owner-identity': User,
  'execution-policy': Shield,
  'project-context': BookOpen,
  skills: Layers,
  memory: HardDrive,
  'session-state': Cpu,
  capabilities: Wifi,
}

export function PromptStudioPanel() {
  const [layers, setLayers] = useState<LayerDef[]>(() => JSON.parse(JSON.stringify(BUILT_IN_LAYERS)))
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const sessionMeta = activeSessionId ? sessionMetaMap.get(activeSessionId) : undefined
  const [profile, setProfile] = useState<Profile>({
    name: 'Owner',
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    tone: 'Direct and technical',
    mode: 'owner-auto',
  })
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [compiledPrompt, setCompiledPrompt] = useState<string>('')
  const [totalTokens, setTotalTokens] = useState(0)
  const [activeLayerCount, setActiveLayerCount] = useState(0)
  const [compiling, setCompiling] = useState(false)
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false)
  const [profilePaneOpen, setProfilePaneOpen] = useState(true)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [memories, setMemories] = useState<{ title: string; content: string; score: number }[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const compileVersionRef = useRef(0)

  // Split view state
  const [splitPos, setSplitPos] = useState(60) // percentage for top section
  const [draggingDivider, setDraggingDivider] = useState(false)

  // Live mode: 'immediate' compiles on every session event, 'batched' throttles to 5s
  const [liveMode, setLiveMode] = useState<'immediate' | 'batched'>('immediate')
  const lastBatchCompileRef = useRef(0)
  const BATCH_INTERVAL = 5000

  // Re-compile tracking
  const prevSessionIdRef = useRef(activeSessionId)

  // Diff state
  const prevPromptRef = useRef('')
  const [diffResult, setDiffResult] = useState<DiffLine[]>([])
  const [showDiff, setShowDiff] = useState(false)

  // Project context: working directory and files found (AGENTS.md / CLAUDE.md)
  const [projectContext, setProjectContext] = useState<{
    workingDirectory?: string
    contextFiles?: { filename: string; content: string }[]
  } | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextPaneOpen, setContextPaneOpen] = useState(false)

  // Fetch workspace context on mount and after invalidate/reload
  const resolveContext = useCallback(async () => {
    if (!window.electronAPI?.resolveWorkspaceContext) return
    setContextLoading(true)
    try {
      const result = await window.electronAPI.resolveWorkspaceContext()
      setProjectContext(result)
    } catch {
      setProjectContext(null)
    } finally {
      setContextLoading(false)
    }
  }, [])

  useEffect(() => {
    resolveContext()
  }, [resolveContext])

  // Tracks whether session data has changed since the last compile.
  // When true, the Live dot turns yellow to warn the user the preview is stale.
  const [sessionStale, setSessionStale] = useState(false)

  // Ref holding the latest session-aware memories, read at compile-call time
  // (bypasses React state staleness so effects that fetch fresh memories can
  // pass them directly to compile() in the same microtask).
  const sessionMemoriesRef = useRef<{ title: string; content: string; score: number }[]>([])

  // Compile the prompt via real IPC.
  // Accepts an optional `externalMemories` parameter so callers (like the
  // session-switch path) can pass freshly fetched memories before React
  // state catches up. When omitted, falls back to `sessionMemoriesRef.current`
  // (the most recently fetched session-aware results), then to React state.
  const compile = useCallback(async (
    externalMemories?: { title: string; content: string; score: number }[],
  ) => {
    const version = ++compileVersionRef.current
    setCompiling(true)
    setError(null)
    try {
      const enabledLayers = layers.filter((l) => l.enabled)
      const layerOrder = enabledLayers.map((l) => l.id)

      // Fetch real session state — active session ID, real permission mode,
      // and real home directory for plans/data paths. All fetches are
      // non-fatal — the compiler provides sensible defaults if IPC fails.
      let sessionState: CompileOptions['sessionState'] | undefined
      try {
        const [mode, realHome] = await Promise.all([
          window.electronAPI.getWindowMode().catch(() => undefined),
          window.electronAPI.getHomeDir().catch(() => undefined),
        ])
        const basePath = realHome ?? sessionMeta?.workingDirectory
        sessionState = {
          sessionId: activeSessionId ?? 'studio-inspect',
          permissionMode: mode ?? 'owner-auto',
          plansFolderPath: basePath ? `${basePath}/plans` : '/tmp/plans',
          dataFolderPath: basePath ? `${basePath}/data` : '/tmp/data',
        }
      } catch {
        // Non-fatal — compiler has defaults
      }

      // Use external memories (fresh from fetch) or the ref (last fetched),
      // falling back to React state as a safety net.
      const activeMemories = externalMemories ?? sessionMemoriesRef.current
      const activeMemoriesFinal = activeMemories.length > 0 ? activeMemories : memories

      const compileOptions: CompileOptions = {
        layerOrder,
        ownerProfile: {
          name: profile.name,
          aliases: [],
          locale: 'en',
          timezone: profile.tz,
          tone: profile.tone,
          verbosity: 3,
          bannedPhrases: [],
        },
        executionPolicy: {
          defaultMode: profile.mode,
          askOnlyWhen: ['filesystem-write', 'config-write', 'memory-write'],
          allowedRoots: [],
        },
        sessionState,
        // Only pass memories if we have real ones from FTS5
        ...(activeMemoriesFinal.length > 0 ? { memories: activeMemoriesFinal } : {}),
      }

      const result: CompileResult = await window.electronAPI.compilePrompt(compileOptions)
      if (version !== compileVersionRef.current) return // stale

      const snapshot = result.snapshot

      // Compute diff against previous version before overwriting
      const prev = prevPromptRef.current
      if (prev && prev !== snapshot.prompt) {
        setDiffResult(groupDiffHunks(diffLines(prev, snapshot.prompt)))
      } else {
        setDiffResult([])
      }
      prevPromptRef.current = snapshot.prompt

      setCompiledPrompt(snapshot.prompt)
      setTotalTokens(snapshot.estimatedTokens)
      setActiveLayerCount(snapshot.layers.length)
      setSessionStale(false)
      addVersion(snapshot.prompt, snapshot.layers.length, snapshot.estimatedTokens)
    } catch (err) {
      console.error('Prompt compilation failed:', err)
      setError(err instanceof Error ? err.message : 'Prompt compilation failed')
      setCompiledPrompt('')
      setTotalTokens(0)
      setActiveLayerCount(0)
    } finally {
      if (version === compileVersionRef.current) {
        setCompiling(false)
      }
    }
  }, [layers, profile, memories, sessionMeta?.workingDirectory])

  // Auto-compile when layers or profile change (debounced)
  useEffect(() => {
    const handle = setTimeout(() => { compile() }, 150)
    return () => clearTimeout(handle)
  }, [compile])

  // Fetch session-aware memories and compile — fired on mount, session switch,
  // and title regeneration. A single effect consolidates two previously separate
  // effects to avoid a duplicate IPC call on session switch.
  useEffect(() => {
    const sessionChanged = activeSessionId !== prevSessionIdRef.current
    if (sessionChanged) {
      prevSessionIdRef.current = activeSessionId
    }

    const query = sessionMeta?.name ?? activeSessionId ?? ''
    if (!query) {
      sessionMemoriesRef.current = []
      setMemories([])
      setMemoriesLoading(false)
      if (sessionChanged) compile()
      return
    }

    let cancelled = false
    setMemoriesLoading(true)

    window.electronAPI.searchMemories({ query, limit: 10 })
      .then((results) => {
        if (cancelled) return
        const mapped = results.map((r) => ({
          title: r.memory.title ?? 'Memory',
          content: r.memory.content ?? '',
          score: r.score ?? 0,
        }))
        sessionMemoriesRef.current = mapped
        setMemories(mapped)
        setMemoriesLoading(false)

        // On session switch, immediately compile with fresh session-aware memories
        if (sessionChanged) compile(mapped)
      })
      .catch(() => {
        if (cancelled) return
        sessionMemoriesRef.current = []
        setMemories([])
        setMemoriesLoading(false)
        if (sessionChanged) compile([])
      })

    return () => { cancelled = true }
  }, [activeSessionId, sessionMeta?.name, sessionMeta?.workingDirectory])

  // Subscribe to session events for live updates.
  // In 'immediate' mode: re-compiles on every session event.
  // In 'batched' mode: throttles to one compile per BATCH_INTERVAL (5s).
  useEffect(() => {
    const cleanup = window.electronAPI?.onSessionEvent?.((event) => {
      if (event.sessionId !== activeSessionId) return

      // Mark stale — the compiled preview no longer matches live session state
      setSessionStale(true)

      if (liveMode === 'immediate') {
        compile()
      } else {
        const now = Date.now()
        if (now - lastBatchCompileRef.current >= BATCH_INTERVAL) {
          lastBatchCompileRef.current = now
          compile()
        }
      }
    })
    return () => cleanup?.()
  }, [activeSessionId, compile, liveMode])

  // Subscribe to workspace/project/source changes so the prompt re-compiles
  // when project context files (AGENTS.md/CLAUDE.md) or source configurations
  // change on disk. Shares the same batch throttle as session events so rapid
  // changes across sources are batched into a single compile.
  useEffect(() => {
    // Shared handler that defers to the same live-mode/batch logic
    const handleWorkspaceChange = ({ reResolveContext }: { reResolveContext?: boolean } = {}) => {
      // Re-read AGENTS.md/CLAUDE.md from disk for the Project Context pane
      if (reResolveContext) resolveContext()

      setSessionStale(true)
      if (liveMode === 'immediate') {
        compile()
      } else {
        const now = Date.now()
        if (now - lastBatchCompileRef.current >= BATCH_INTERVAL) {
          lastBatchCompileRef.current = now
          compile()
        }
      }
    }

    const cleanups: (() => void)[] = []

    if (window.electronAPI?.onSourcesChanged) {
      cleanups.push(window.electronAPI.onSourcesChanged(() => handleWorkspaceChange()))
    }
    if (window.electronAPI?.onProjectsChanged) {
      cleanups.push(window.electronAPI.onProjectsChanged(() => handleWorkspaceChange()))
    }
    // Context files changed — also re-resolve the project context display
    if (window.electronAPI?.onContextFilesChanged) {
      cleanups.push(window.electronAPI.onContextFilesChanged(() => handleWorkspaceChange({ reResolveContext: true })))
    }

    return () => cleanups.forEach((fn) => fn())
  }, [compile, liveMode, resolveContext])

  const addVersion = useCallback((prompt: string, layerCount: number, tokens: number) => {
    const now = new Date()
    const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setVersions((prev) => {
      const next = [
        { id: `v${prev.length + 1}`, time, timestamp: Date.now(), layers: layerCount, tokens, prompt },
        ...prev,
      ]
      return next.slice(0, 20)
    })
  }, [])

  // Toggle a single layer
  const toggleLayer = useCallback((index: number) => {
    setLayers((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], enabled: !next[index].enabled }
      return next
    })
  }, [])

  // Toggle all layers
  const toggleAll = useCallback((enabled: boolean) => {
    setLayers((prev) => prev.map((l) => ({ ...l, enabled })))
  }, [])

  // Reset to defaults
  const resetAll = useCallback(() => {
    setLayers(JSON.parse(JSON.stringify(BUILT_IN_LAYERS)))
    setProfile({ name: 'Owner', tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', tone: 'Direct and technical', mode: 'owner-auto' })
    setVersions([])
    setCompiledPrompt('')
    setTotalTokens(0)
    setActiveLayerCount(0)
    setSessionStale(false)
    setDiffResult([])
    setShowDiff(false)
    prevPromptRef.current = ''
  }, [])

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null)
      setDragOverIdx(null)
      return
    }
    setLayers((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx!, 1)
      next.splice(dropIdx, 0, moved)
      return next
    })
    setDragIdx(null)
    setDragOverIdx(null)
  }, [dragIdx])

  const handleDragEnd = useCallback(() => {
    setDragIdx(null)
    setDragOverIdx(null)
  }, [])

  // Copy to clipboard
  const handleCopy = useCallback(() => {
    if (!compiledPrompt) return
    navigator.clipboard.writeText(compiledPrompt).catch(() => {
      const ta = document.createElement('textarea')
      ta.value = compiledPrompt
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    })
  }, [compiledPrompt])

  // Restore a previous version
  const restoreVersion = useCallback((idx: number) => {
    const v = versions[idx]
    if (!v) return
    // Compute diff against the compiled prompt we're replacing
    try {
      const prev = compiledPrompt
      if (prev && prev !== v.prompt) {
        setDiffResult(groupDiffHunks(diffLines(prev, v.prompt)))
      } else {
        setDiffResult([])
      }
    } catch {
      setDiffResult([])
    }
    prevPromptRef.current = v.prompt
    setCompiledPrompt(v.prompt)
    setTotalTokens(v.tokens)
    setActiveLayerCount(v.layers)
  }, [versions, compiledPrompt])

  // Update profile field
  const updateProfile = useCallback((field: keyof Profile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }))
  }, [])

  // Merge unchanged lines in the diff for more compact display (show first 3 of each unchanged run)
  const compactDiff = useMemo<CompactDiffLine[]>(() => {
    if (diffResult.length === 0) return []
    const result: CompactDiffLine[] = []
    let unchangedRun = 0
    for (const line of diffResult) {
      if (line.type === 'unchanged') {
        unchangedRun++
        if (unchangedRun > 3) {
          const last = result[result.length - 1]
          if (!last || last.type !== 'ellipsis') {
            result.push({ type: 'ellipsis', content: '', hidden: true })
          }
          continue
        }
      } else {
        unchangedRun = 0
      }
      result.push(line)
    }
    return result
  }, [diffResult])

  // Divider mouse handler — tracks drag on the horizontal split
  const dividerRef = useRef<HTMLDivElement>(null)

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.userSelect = 'none'
    setDraggingDivider(true)
  }, [])

  useEffect(() => {
    if (!draggingDivider) return
    const bodyEl = dividerRef.current
    if (!bodyEl) return
    const container = bodyEl

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100))
      setSplitPos(pct)
    }
    const handleMouseUp = () => {
      document.body.style.userSelect = ''
      setDraggingDivider(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingDivider])

  // Memoize the compiled prompt display — renders as raw text in a mono font
  const compiledDisplay = useMemo(() => {
    if (!compiledPrompt) return null
    return <pre className="ps-prompt__raw">{compiledPrompt}</pre>
  }, [compiledPrompt])

  return (
    <div className="ps-panel">
      {/* Sidebar — layer list */}
      <aside className="ps-sidebar">
        <div className="ps-sidebar__header">
          <div className="ps-sidebar__title">
            <Layers size={18} />
            <span>Prompt Studio</span>
            <span className="ps-sidebar__count">{layers.length}</span>
          </div>
          <div className="ps-sidebar__actions">
            <button type="button" className="ps-btn ps-btn--icon" onClick={() => void compile()} disabled={compiling} title="Compile prompt">
              {compiling ? <Loader2 size={14} className="ps-spin" /> : <Zap size={14} />}
            </button>
            <button
              type="button"
              className="ps-btn ps-btn--icon"
              onClick={async () => {
                try {
                  const result = await window.electronAPI.invalidatePromptCache()
                  if (result.success) {
                    toast.success('Context files reloaded', { duration: 2000 })
                    resolveContext()
                    compile()
                  }
                } catch (e) {
                  console.error('Failed to invalidate prompt cache:', e)
                  toast.error('Failed to reload context files')
                }
              }}
              disabled={compiling}
              title="Reload context files: re-scans AGENTS.md/CLAUDE.md from disk, invalidates compiler cache, re-compiles"
            >
              <FileText size={14} />
            </button>
            <button type="button" className="ps-btn ps-btn--icon" onClick={resetAll} title="Reset to defaults">
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        {/* Owner profile pane */}
        <div className="ps-profile-pane">
          <button
            type="button"
            className="ps-profile-pane__header"
            onClick={() => setProfilePaneOpen((v) => !v)}
          >
            {profilePaneOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <User size={12} />
            <span>Owner Profile</span>
          </button>
          {profilePaneOpen && (
            <div className="ps-profile-pane__fields">
              <div className="ps-profile-row">
                <label>Name</label>
                <input type="text" value={profile.name} onChange={(e) => updateProfile('name', e.target.value)} placeholder="Owner name" />
              </div>
              <div className="ps-profile-row">
                <label><Globe size={12} /></label>
                <input type="text" value={profile.tz} onChange={(e) => updateProfile('tz', e.target.value)} placeholder="Timezone" />
              </div>
              <div className="ps-profile-row">
                <label>Tone</label>
                <input type="text" value={profile.tone} onChange={(e) => updateProfile('tone', e.target.value)} placeholder="Communication style" />
              </div>
              <div className="ps-profile-row">
                <label><Sliders size={12} /></label>
                <select value={profile.mode} onChange={(e) => updateProfile('mode', e.target.value)}>
                  <option value="owner-auto">Owner Auto</option>
                  <option value="explore">Explore</option>
                  <option value="unrestricted">Unrestricted</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Project Context pane */}
        <div className="ps-context-pane">
          <button
            type="button"
            className="ps-context-pane__header"
            onClick={() => setContextPaneOpen((v) => !v)}
          >
            {contextPaneOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <BookOpen size={12} />
            <span>Project Context</span>
            <span className="ps-context-pane__count">
              {projectContext?.contextFiles?.length ?? 0}
            </span>
            <button
              type="button"
              className="ps-context-pane__reload"
              onClick={(e) => { e.stopPropagation(); resolveContext() }}
              title="Re-scan for AGENTS.md/CLAUDE.md"
            >
              <RotateCcw size={10} />
            </button>
          </button>
          {contextPaneOpen && (
            <div className="ps-context-pane__body">
              {contextLoading ? (
                <div className="ps-context-pane__loading">
                  <Loader2 size={12} className="ps-spin" />
                  <span>Scanning workspace…</span>
                </div>
              ) : !projectContext ? (
                <div className="ps-context-pane__empty">No workspace context resolved</div>
              ) : (
                <>
                  <div className="ps-context-pane__path">
                    <span className="ps-context-pane__path-label">Working directory</span>
                    <span className="ps-context-pane__path-value">
                      {projectContext.workingDirectory ?? 'Unknown'}
                    </span>
                  </div>
                  {(!projectContext.contextFiles || projectContext.contextFiles.length === 0) ? (
                    <div className="ps-context-pane__empty">
                      No AGENTS.md or CLAUDE.md found at this path
                    </div>
                  ) : (
                    projectContext.contextFiles.map((file) => (
                      <div key={file.filename} className="ps-context-file">
                        <div className="ps-context-file__header">
                          <FileText size={12} />
                          <span className="ps-context-file__name">{file.filename}</span>
                          <span className="ps-context-file__size">
                            {file.content.length.toLocaleString()} B
                          </span>
                        </div>
                        <pre className="ps-context-file__preview">
                          {file.content.slice(0, 500)}
                          {file.content.length > 500 ? '…' : ''}
                        </pre>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Layer list */}
        <div className="ps-layer-list">
          {layers.map((layer, i) => {
            const Icon = LAYER_ICONS[layer.id] || Layers
            const isDragOver = dragOverIdx === i && dragIdx !== i
            return (
              <div
                key={`${layer.id}-${i}`}
                className={[
                  'ps-layer-card',
                  !layer.enabled && 'ps-layer-card--disabled',
                  dragIdx === i && 'ps-layer-card--dragging',
                  isDragOver && 'ps-layer-card--drag-over',
                ].filter(Boolean).join(' ')}
                draggable
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={(e) => handleDrop(e, i)}
                onDragEnd={handleDragEnd}
                data-index={i}
              >
                {/* Drag handle */}
                <div className="ps-layer-card__drag" onMouseDown={(e) => e.preventDefault()}>
                  <GripVertical size={14} />
                </div>

                {/* Layer icon */}
                <div className="ps-layer-card__icon">
                  <Icon size={14} />
                </div>

                {/* Content */}
                <div className="ps-layer-card__body">
                  <div className="ps-layer-card__header">
                    <span className="ps-layer-card__name">{layer.name}</span>
                    <span className={`ps-layer-card__badge ps-layer-card__badge--${layer.stability}`}>
                      {layer.stability}
                    </span>
                  </div>
                </div>

                {/* Toggle */}
                <button
                  type="button"
                  className="ps-layer-card__toggle"
                  onClick={() => toggleLayer(i)}
                  title={layer.enabled ? 'Disable layer' : 'Enable layer'}
                >
                  {layer.enabled ? (
                    <ToggleRight size={16} className="ps-layer-card__toggle-on" />
                  ) : (
                    <ToggleLeft size={16} className="ps-layer-card__toggle-off" />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* Bottom actions */}
        <div className="ps-sidebar__footer">
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => toggleAll(true)}>
            Enable All
          </button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => toggleAll(false)}>
            Disable All
          </button>
        </div>
      </aside>

      {/* Main — compiled prompt preview */}        <main className="ps-main">
        <header className="ps-main__header">
          <div className="ps-main__title">
            <Zap size={16} />
            <span>Compiled Prompt</span>
          </div>
          <div className="ps-main__stats">
            <span className="ps-stat-badge">
              <Clock size={12} />
              <strong>{totalTokens.toLocaleString()}</strong> tokens
            </span>
            <span className="ps-stat-badge">
              <Layers size={12} />
              <strong>{activeLayerCount}</strong> layers
            </span>
            {activeSessionId && (
              <button
                type="button"
                className={`ps-stat-badge ps-stat-badge--live ${liveMode === 'batched' ? 'ps-stat-badge--live-batched' : ''} ${sessionStale ? 'ps-stat-badge--live-stale' : ''}`}
                onClick={() => {
                    if (sessionStale) {
                      // Stale: force an immediate recompile
                      compile()
                    } else {
                      // Not stale: toggle live mode
                      setLiveMode((m) => (m === 'immediate' ? 'batched' : 'immediate'))
                    }
                  }}
                title={
                  sessionStale
                    ? '⚠ Session updated — click to compile now'
                    : (liveMode === 'immediate'
                        ? 'Immediate: recompiles on every session event. Click to switch to 5s batch mode.'
                        : 'Batched (5s): throttles recompiles. Click to switch to immediate mode.'
                      )
                }
              >
                <span className={`ps-live-dot ${liveMode === 'batched' ? 'ps-live-dot--batched' : ''} ${sessionStale ? 'ps-live-dot--stale' : ''}`} />
                <span>{sessionStale ? 'Stale' : 'Live'}</span>
                {liveMode === 'batched' && <span className="ps-live-badge">5s</span>}
              </button>
            )}
            <button
              type="button"
              className={`ps-btn ${showDiff ? 'ps-btn--active' : ''}`}
              onClick={() => setShowDiff((v) => !v)}
              disabled={!compiledPrompt}
              title="Toggle diff panel"
            >
              <GitCompare size={12} />
              Diff
              {diffResult.length > 0 && (
                <span className="ps-main__diff-count">
                  {diffResult.filter((l) => l.type !== 'unchanged').length}
                </span>
              )}
            </button>
            <button type="button" className="ps-btn" onClick={handleCopy} disabled={!compiledPrompt}>
              <Copy size={12} />
              Copy
            </button>
          </div>
        </header>

        <div className="ps-main__body" ref={dividerRef}>
          {error && (
            <div className="ps-main__error">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Top section — compiled prompt */}
          <div
            className="ps-main__split-top"
            style={{ height: showDiff ? `${splitPos}%` : '100%' }}
          >
            {compiledPrompt ? (
              <div className="ps-prompt">
                {compiledDisplay}
              </div>
            ) : (
              !error ? (
                <div className="ps-main__empty">
                  {compiling ? (
                    <>
                      <Loader2 size={32} className="ps-spin" />
                      <p>Compiling prompt…</p>
                    </>
                  ) : (
                    <>
                      <Zap size={48} className="ps-main__empty-icon" />
                      <p>Toggle layers on the left to build your prompt</p>
                    </>
                  )}
                </div>
              ) : null
            )}
          </div>

          {/* Divider drag handle — only visible when diff panel is open */}
          {showDiff && (
            <div
              className="ps-main__divider"
              onMouseDown={handleDividerMouseDown}
            >
              <div className="ps-main__divider-knob" />
            </div>
          )}

          {/* Bottom section — diff panel */}
          {showDiff && (
            <div
              className="ps-main__split-bottom"
              style={{ height: `${100 - splitPos}%` }}
            >
              <div className="ps-diff-panel">
                <header className="ps-diff-panel__header">
                  <GitCompare size={13} />
                  <span>Changes from previous version</span>
                  {diffResult.length > 0 && (
                    <span className="ps-diff-panel__summary">
                      <span className="ps-diff-panel__summary-added">
                        +{diffResult.filter((l) => l.type === 'added').length}
                      </span>
                      <span className="ps-diff-panel__summary-removed">
                        -{diffResult.filter((l) => l.type === 'removed').length}
                      </span>
                    </span>
                  )}
                </header>
                <div className="ps-diff-panel__body">
                  {compactDiff.length === 0 ? (
                    <div className="ps-diff-panel__empty">
                      No changes — this is the first version.
                    </div>
                  ) : (
                    <div className="ps-diff-panel__lines">
                      {compactDiff.map((line, i) => {
                        if (line.type === 'ellipsis') {
                          return (
                            <div key={i} className="ps-diff-line ps-diff-line--ellipsis">
                              <span className="ps-diff-line__prefix">⋯</span>
                              <span className="ps-diff-line__content"></span>
                            </div>
                          )
                        }
                        return (
                          <div
                            key={i}
                            className={`ps-diff-line ps-diff-line--${line.type}`}
                          >
                            <span className="ps-diff-line__prefix">
                              {line.type === 'added' ? '+'
                               : line.type === 'removed' ? '-'
                               : ' '}
                            </span>
                            <span className="ps-diff-line__content">{line.content}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Version history */}
        <div className="ps-version-history">
          <button
            type="button"
            className="ps-version-history__header"
            onClick={() => setVersionHistoryOpen((v) => !v)}
          >
            <div className="ps-version-history__title">
              <History size={12} />
              <span>Version History</span>
              <span className="ps-version-history__count">({versions.length})</span>
            </div>
            {versionHistoryOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {versionHistoryOpen && (
            <div className="ps-version-history__body">
              {versions.length === 0 ? (
                <div className="ps-version-history__empty">No versions yet</div>
              ) : (
                versions.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`ps-version-item ${i === 0 ? 'ps-version-item--active' : ''}`}
                    onClick={() => restoreVersion(i)}
                  >
                    <span className="ps-version-item__indicator" />
                    <span className="ps-version-item__time">{v.time}</span>
                    <span>{v.layers} layers</span>
                    <span className="ps-version-item__tokens">{v.tokens.toLocaleString()} tok</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
