/**
 * MultiDiffPreviewOverlay - Overlay for multiple file changes (Edit/Write tools)
 *
 * Layout: All diffs stacked vertically, each with an inline file path badge + change stats.
 * No sidebar — every file section is visible in a single scrollable view.
 *
 * Features:
 * - Vertical stacked layout: [file badge + stats] → [diff] → [diff if multiple] → ...
 * - Consolidated view (group by file) or individual changes
 * - Unified/split diff viewer for each change
 * - Focused change support (scroll to specific change on open)
 * - Header shows file path for single file, "N edits" summary for multiple files
 */

import * as React from 'react'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { PencilLine, FilePlus, X, ChevronRight } from 'lucide-react'
import { parseDiffFromFile, type FileContents } from '@pierre/diffs'
import { ShikiDiffViewer, getDiffStats } from '../code-viewer/ShikiDiffViewer'
import { DiffViewerControls } from '../code-viewer/DiffViewerControls'
import { LANGUAGE_MAP } from '../code-viewer/language-map'
import { PreviewOverlay, type BadgeVariant } from './PreviewOverlay'
import { usePlatform } from '../../context/PlatformContext'
import { cn } from '../../lib/utils'

/**
 * A single file change (Edit or Write)
 */
export interface FileChange {
  /** Unique ID for this change */
  id: string
  /** Absolute file path */
  filePath: string
  /** Tool type: Edit or Write */
  toolType: 'Edit' | 'Write'
  /** For Edit: the old_string; For Write: empty or previous content if available */
  original: string
  /** For Edit: the new_string; For Write: the written content */
  modified: string
  /** Error message if the tool failed */
  error?: string
}

/**
 * Diff viewer display preferences
 * Passed from parent to avoid localStorage usage - all settings stored in preferences.json
 */
export interface DiffViewerSettings {
  diffStyle: 'unified' | 'split'
  disableBackground: boolean
}

export interface MultiDiffPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** List of file changes to display */
  changes: FileChange[]
  /** Whether to consolidate changes by file path (default: true) */
  consolidated?: boolean
  /** ID of change to focus on initially */
  focusedChangeId?: string
  /** Theme mode */
  theme?: 'light' | 'dark'
  /** Render inline without dialog (for playground) */
  embedded?: boolean
  /** Initial diff viewer settings (from user preferences) */
  diffViewerSettings?: Partial<DiffViewerSettings>
  /** Callback when diff viewer settings change (to persist to preferences) */
  onDiffViewerSettingsChange?: (settings: DiffViewerSettings) => void
}

// ============================================
// Helpers
// ============================================

/** A group of changes for a single file (or a single ungrouped change) */
interface FileSection {
  key: string
  filePath: string
  changes: FileChange[]
}

/**
 * Groups changes into file sections.
 * In consolidated mode, changes to the same file are grouped together.
 * In non-consolidated mode, each change is its own section.
 */
function createFileSections(changes: FileChange[], consolidated: boolean): FileSection[] {
  if (!consolidated) {
    return changes.map(change => ({
      key: change.id,
      filePath: change.filePath,
      changes: [change],
    }))
  }

  // Group by file path, preserving order of first occurrence
  const byPath = new Map<string, FileChange[]>()
  for (const change of changes) {
    const existing = byPath.get(change.filePath) || []
    existing.push(change)
    byPath.set(change.filePath, existing)
  }

  return Array.from(byPath.entries()).map(([filePath, fileChanges]) => ({
    key: filePath,
    filePath,
    changes: fileChanges,
  }))
}

/** Truncate file path to parent/filename for display */
function displayPath(filePath: string): string {
  const parts = filePath.split('/')
  const name = parts.pop() || filePath
  if (parts.length > 0) {
    const parent = parts.pop()
    return `${parent}/${name}`
  }
  return name
}

/** Compute diff stats for a single change */
function computeChangeStats(change: FileChange) {
  const ext = change.filePath.split('.').pop()?.toLowerCase() || ''
  const lang = LANGUAGE_MAP[ext] || 'text'
  const oldFile: FileContents = { name: change.filePath, contents: change.original, lang: lang as any }
  const newFile: FileContents = { name: change.filePath, contents: change.modified, lang: lang as any }
  const fileDiff = parseDiffFromFile(oldFile, newFile)
  return getDiffStats(fileDiff)
}

// ============================================
// DiffCardTitleBar - Collapsible title bar for each diff card
// ============================================

interface DiffCardTitleBarProps {
  /** File path to show as a badge in the title bar (omit for plain "Diff" label) */
  filePath?: string
  /** Diff stats shown alongside file path badge */
  additions?: number
  deletions?: number
  /** Whether collapse/expand is enabled (disabled for single-item views) */
  collapsible: boolean
  /** Whether the card content is collapsed (only title bar visible) */
  collapsed: boolean
  /** Toggle collapse state */
  onToggleCollapse: () => void
}

/**
 * Collapsible title bar for a diff card. Two modes:
 * - With filePath: collapse chevron | [clickable file badge] [-N +M] (for multi-edit)
 * - Without filePath: collapse chevron | "Diff" label (for single edit, info is in overlay header)
 *
 * The chevron rotates 90deg when expanded (matches codebase convention).
 * File badge matches PreviewHeaderBadge styling (bg-background shadow-minimal).
 * Clicking the badge opens the file in the system default editor via PlatformContext.
 */
function DiffCardTitleBar({ filePath, additions, deletions, collapsible, collapsed, onToggleCollapse }: DiffCardTitleBarProps) {
  const { onOpenFileExternal } = usePlatform()

  // Non-collapsible (single item): centered title, no chevron, not clickable
  if (!collapsible) {
    return (
      <div className="flex justify-center items-center px-4 py-3 border-b border-foreground/7 select-none shrink-0">
        <div className="text-xs font-semibold tracking-wider text-foreground/30">
          Diff
        </div>
      </div>
    )
  }

  // Collapsible: chevron + badges, entire bar is clickable
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-foreground/7 select-none shrink-0 cursor-pointer"
      onClick={onToggleCollapse}
      role="button"
      aria-label={collapsed ? 'Expand diff' : 'Collapse diff'}
    >
      {/* Collapse/expand chevron — rotates 90deg when expanded */}
      <ChevronRight
        className={cn(
          "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 shrink-0",
          !collapsed && "rotate-90"
        )}
      />

      {filePath ? (
        // Multi-edit mode: clickable file path badge + per-file diff stats
        <div className="flex items-center gap-2">
          <button
            className="flex items-center h-[26px] px-2.5 rounded-[6px] font-sans text-[13px] font-medium bg-background shadow-minimal text-foreground/70 min-w-0 cursor-pointer group"
            title={filePath}
            onClick={(e) => { e.stopPropagation(); onOpenFileExternal?.(filePath) }}
          >
            <span className="truncate group-hover:underline">{displayPath(filePath)}</span>
          </button>
          <div className="flex items-center gap-2 text-[13px] font-medium font-mono shrink-0">
            <span className="text-destructive">-{deletions ?? 0}</span>
            <span className="text-success">+{additions ?? 0}</span>
          </div>
        </div>
      ) : (
        // Plain label (overlay header shows file + stats)
        <div className="text-xs font-semibold tracking-wider text-foreground/30">
          Diff
        </div>
      )}
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export function MultiDiffPreviewOverlay({
  isOpen,
  onClose,
  changes,
  consolidated = true,
  focusedChangeId,
  theme = 'light',
  embedded,
  diffViewerSettings,
  onDiffViewerSettingsChange,
}: MultiDiffPreviewOverlayProps) {
  // Ref map for scroll-to-focused-change support
  const changeRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Track which cards are collapsed (by change ID). Collapsed cards show only the title bar.
  // When entering from a specific turn card item (focusedChangeId set), collapse all other
  // cards so the user immediately sees only the relevant diff expanded.
  const [collapsedCards, setCollapsedCards] = useState<Set<string>>(() => {
    if (!focusedChangeId) return new Set()
    return new Set(changes.filter(c => c.id !== focusedChangeId).map(c => c.id))
  })
  const toggleCollapsed = useCallback((changeId: string) => {
    setCollapsedCards(prev => {
      const next = new Set(prev)
      if (next.has(changeId)) {
        next.delete(changeId)
      } else {
        next.add(changeId)
      }
      return next
    })
  }, [])

  // Build file sections (grouped or ungrouped)
  const fileSections = useMemo(() => {
    return createFileSections(changes, consolidated)
  }, [changes, consolidated])

  // ── Fade-in reveal ──────────────────────────────────────────────────
  // Content starts invisible (opacity 0) while ShikiDiffViewers load and
  // scroll position is achieved. Once all diffs fire onReady AND scroll is
  // done, we reveal with a CSS transition. If everything is ready within
  // the first frame (~50ms), we skip the transition for an instant show.
  // Only count visible (non-error, non-collapsed) diffs — collapsed cards don't render
  // ShikiDiffViewer so their onReady never fires; excluding them prevents a stalled reveal.
  const diffCount = useMemo(() => changes.filter(c => !c.error && !collapsedCards.has(c.id)).length, [changes, collapsedCards])
  const readyCountRef = useRef(0)
  const scrollDoneRef = useRef(!focusedChangeId) // no scroll needed → already done
  const revealedRef = useRef(false)
  const mountedAtRef = useRef(performance.now())
  const [contentVisible, setContentVisible] = useState(false)
  const [animateReveal, setAnimateReveal] = useState(true)

  const checkReveal = useCallback(() => {
    if (revealedRef.current) return
    if (readyCountRef.current >= diffCount && scrollDoneRef.current) {
      revealedRef.current = true
      // If all conditions met within first frame, show instantly (no transition)
      const elapsed = performance.now() - mountedAtRef.current
      if (elapsed < 50) setAnimateReveal(false)
      setContentVisible(true)
    }
  }, [diffCount])

  const handleDiffReady = useCallback(() => {
    readyCountRef.current++
    checkReveal()
  }, [checkReveal])

  // Check reveal on mount — handles edge cases like diffCount=0 (all errors)
  useEffect(() => {
    checkReveal()
  }, [checkReveal])

  // Diff viewer controls state — initialized from props (user preferences)
  // Settings are persisted via onDiffViewerSettingsChange callback to preferences.json
  const [diffStyle, setDiffStyleInternal] = useState<'unified' | 'split'>(
    diffViewerSettings?.diffStyle ?? 'unified'
  )
  const [disableBackground, setDisableBackgroundInternal] = useState(
    diffViewerSettings?.disableBackground ?? false
  )

  // Wrap setters to also call the persistence callback
  const setDiffStyle = useCallback((style: 'unified' | 'split') => {
    setDiffStyleInternal(style)
    onDiffViewerSettingsChange?.({ diffStyle: style, disableBackground })
  }, [disableBackground, onDiffViewerSettingsChange])

  const setDisableBackground = useCallback((disabled: boolean) => {
    setDisableBackgroundInternal(disabled)
    onDiffViewerSettingsChange?.({ diffStyle, disableBackground: disabled })
  }, [diffStyle, onDiffViewerSettingsChange])

  // Compute per-section stats and total stats
  const { sectionStats, totalStats } = useMemo(() => {
    let totalAdd = 0
    let totalDel = 0
    const perSection = new Map<string, { additions: number; deletions: number }>()

    for (const section of fileSections) {
      let secAdd = 0
      let secDel = 0
      for (const change of section.changes) {
        // Skip errored changes — they have no meaningful diff content
        if (change.error) continue
        const stats = computeChangeStats(change)
        secAdd += stats.additions
        secDel += stats.deletions
      }
      perSection.set(section.key, { additions: secAdd, deletions: secDel })
      totalAdd += secAdd
      totalDel += secDel
    }

    return {
      sectionStats: perSection,
      totalStats: { additions: totalAdd, deletions: totalDel },
    }
  }, [fileSections])

  // Scroll to focused change after mount, then signal scroll completion for reveal
  useEffect(() => {
    if (!focusedChangeId) {
      scrollDoneRef.current = true
      checkReveal()
      return
    }

    // Small delay to allow ShikiDiffViewer to render (async syntax highlighting)
    const timer = setTimeout(() => {
      const el = changeRefs.current.get(focusedChangeId)
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'start' })
      }
      scrollDoneRef.current = true
      checkReveal()
    }, 150)

    return () => clearTimeout(timer)
  }, [focusedChangeId, checkReveal])

  // Determine header content based on single vs. multiple files
  const isMultiFile = fileSections.length > 1
  const totalChangeCount = fileSections.reduce((acc, s) => acc + s.changes.length, 0)

  // Type badge: for single file, show Edit/Write; for multi-file, show edit count
  const typeBadge = useMemo((): { icon: typeof PencilLine; label: string; variant: BadgeVariant } => {
    const hasWrite = changes.some(c => c.toolType === 'Write' && !c.error)
    if (isMultiFile) {
      return {
        icon: hasWrite ? FilePlus : PencilLine,
        label: `${totalChangeCount} edit${totalChangeCount !== 1 ? 's' : ''}`,
        variant: hasWrite ? 'green' : 'orange',
      }
    }
    // Single file — show tool type and count if multiple changes
    const firstSection = fileSections[0]
    if (!firstSection) return { icon: PencilLine, label: 'Edit', variant: 'orange' }
    const sectionHasWrite = firstSection.changes.some(c => c.toolType === 'Write')
    const count = firstSection.changes.length
    return {
      icon: sectionHasWrite ? FilePlus : PencilLine,
      label: count > 1
        ? `${count} ${sectionHasWrite ? 'Write' : 'Edit'}s`
        : (sectionHasWrite ? 'Write' : 'Edit'),
      variant: sectionHasWrite ? 'green' : 'orange',
    }
  }, [changes, isMultiFile, totalChangeCount, fileSections])

  // Header file path (single file) or summary title (multi-file)
  const headerFilePath = !isMultiFile ? fileSections[0]?.filePath : undefined
  const headerTitle = isMultiFile
    ? `${totalChangeCount} edit${totalChangeCount !== 1 ? 's' : ''} across ${fileSections.length} file${fileSections.length !== 1 ? 's' : ''}`
    : undefined

  // Header actions: total diff stats + viewer controls
  const headerActions = (
    <DiffViewerControls
      additions={totalStats.additions}
      deletions={totalStats.deletions}
      diffStyle={diffStyle}
      onDiffStyleChange={setDiffStyle}
      disableBackground={disableBackground}
      onBackgroundChange={setDisableBackground}
    />
  )

  // Ref callback to register each change element for scroll-to support
  const setChangeRef = useCallback((changeId: string, el: HTMLDivElement | null) => {
    if (el) {
      changeRefs.current.set(changeId, el)
    } else {
      changeRefs.current.delete(changeId)
    }
  }, [])

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={typeBadge}
      filePath={headerFilePath}
      title={headerTitle}
      headerActions={headerActions}
      embedded={embedded}
      className="bg-foreground-3"
    >
      {/* Scrollable column of diff cards — hidden until diffs are loaded + scroll position achieved */}
      <div
        className={cn(
          "absolute inset-0 flex pt-6 px-6 overflow-auto",
          animateReveal && "transition-opacity duration-150"
        )}
        style={{ opacity: contentVisible ? 1 : 0, scrollPaddingTop: 24 }}
      >
        <div className="m-auto" style={{ width: 'max-content', maxWidth: '100%', minWidth: 'min(850px, 100%)' }}>
          <div className="flex flex-col gap-8 pb-6">
            {fileSections.map((section) => {
              const stats = sectionStats.get(section.key)
              // Show file badges in card title bar when there are multiple edits;
              // for a single edit the PreviewOverlay header already shows file + stats
              const showPerCardBadges = isMultiFile || section.changes.length > 1

              return (
                <div key={section.key} className="flex flex-col gap-4">
                  {section.changes.map((change) => {
                    const isCollapsed = collapsedCards.has(change.id)
                    // Only apply minHeight to non-error, non-collapsed cards
                    const cardMinHeight = !change.error && !isCollapsed ? 200 : undefined

                    return (
                      <div
                        key={change.id}
                        ref={(el) => setChangeRef(change.id, el)}
                        className="flex flex-col rounded-xl overflow-hidden backdrop-blur-sm shadow-middle bg-background"
                        style={{ minHeight: cardMinHeight, borderRadius: 12 }}
                      >
                        <DiffCardTitleBar
                          filePath={showPerCardBadges ? section.filePath : undefined}
                          additions={!change.error && showPerCardBadges ? stats?.additions : undefined}
                          deletions={!change.error && showPerCardBadges ? stats?.deletions : undefined}
                          collapsible={totalChangeCount > 1}
                          collapsed={isCollapsed}
                          onToggleCollapse={() => toggleCollapsed(change.id)}
                        />
                        {/* Card content — hidden when collapsed */}
                        {!isCollapsed && (
                          change.error ? (
                            // Errored change — show tinted error banner instead of diff
                            <div className="px-4 py-4">
                              <div
                                className="flex items-start gap-3 px-4 py-3 rounded-[8px] bg-[color-mix(in_oklab,var(--destructive)_5%,var(--background))] shadow-tinted"
                                style={{ '--shadow-color': 'var(--destructive-rgb)' } as React.CSSProperties}
                              >
                                <X className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-semibold text-destructive/70 mb-0.5">
                                    {change.toolType} Failed
                                  </div>
                                  <p className="text-sm text-destructive whitespace-pre-wrap break-words">
                                    {change.error}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <ShikiDiffViewer
                              original={change.original}
                              modified={change.modified}
                              filePath={change.filePath}
                              diffStyle={diffStyle}
                              disableBackground={disableBackground}
                              theme={theme}
                              onReady={handleDiffReady}
                            />
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </PreviewOverlay>
  )
}
