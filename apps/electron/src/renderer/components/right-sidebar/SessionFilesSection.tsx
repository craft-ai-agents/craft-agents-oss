/**
 * SessionFilesSection - Displays files in the session directory as a tree view
 *
 * Features:
 * - Recursive tree view with expandable folders (matches sidebar styling)
 * - File watcher for auto-refresh when files change
 * - Click to preview in-app, double-click to open
 * - Right-click context menu with "Open" / "Show in {file manager}" actions
 * - Persisted expanded folder state per session
 *
 * Styling matches LeftSidebar patterns:
 * - Chevron hidden by default, shown on hover
 * - Vertical connector lines for nested items
 * - 14x14px icons, 8px gaps, 6px radius
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, useRef, memo, useId } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import { File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight, ExternalLink, AlertTriangle, ListCollapse } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { restoreSessionFileWatch } from './session-files-watch'
import { ThumbnailHoverPreview } from './ThumbnailHoverPreview'
import { shouldGateManualExpand, trimExpandedByCount, Tooltip, TooltipTrigger, TooltipContent } from '@archstudio/ui'
import { toast } from 'sonner'

/**
 * Stagger animation variants for child items - matches LeftSidebar pattern
 * Creates a pleasing "cascade" effect when expanding folders
 */
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.01,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
}

export interface SessionFilesSectionProps {
  sessionId?: string
  className?: string
  /** Absolute session folder path for header actions (e.g. View in Finder) */
  sessionFolderPath?: string
  /** Hide section header when embedded inside compact containers (e.g. popovers) */
  hideHeader?: boolean
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Collect all directory paths up to a given depth so the tree respects the depth cap on first load. */
function collectDirectoryPathsUpToDepth(entries: SessionFile[], maxDepth: number): string[] {
  const directories: string[] = []
  const visit = (items: SessionFile[], depth: number) => {
    if (depth >= maxDepth) return
    for (const item of items) {
      if (item.type === 'directory') {
        directories.push(item.path)
        if (item.children && item.children.length > 0) {
          visit(item.children, depth + 1)
        }
      }
    }
  }
  visit(entries, 0)
  return directories
}

/**
 * Get icon for file based on name/type (14x14px matching sidebar)
 */
function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = "h-3.5 w-3.5 text-muted-foreground"

  if (file.type === 'directory') {
    return isExpanded
      ? <FolderOpen className={iconClass} />
      : <Folder className={iconClass} />
  }

  const ext = file.name.split('.').pop()?.toLowerCase()

  if (ext === 'md' || ext === 'markdown') {
    return <FileText className={iconClass} />
  }

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext || '')) {
    return <Image className={iconClass} />
  }

  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }

  return <File className={iconClass} />
}

/**
 * Extensions that have thumbnail previews via the thumbnail:// protocol.
 * Matches the ALL_PREVIEWABLE set in thumbnail-protocol.ts.
 */
const PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
  'pdf', 'svg', 'psd', 'ai',
])

/**
 * Extensions that get lightweight image previews in web mode.
 * Excludes pdf/psd/ai/svg — not rendered as <img> thumbnails here.
 */
const WEB_PREVIEWABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
])

/** True when running in web UI (browser) rather than Electron. */
const isWebMode = typeof window !== 'undefined' && window.electronAPI?.getRuntimeEnvironment?.() === 'web'

/**
 * Constructs a thumbnail:// protocol URL for a given file path.
 * The path is URI-encoded so it can be embedded safely in a URL.
 * Works cross-platform (macOS paths start with /, Windows with C:\).
 */
function getThumbnailUrl(filePath: string): string {
  return `thumbnail://thumb/${encodeURIComponent(filePath)}`
}

/**
 * FileThumbnail — Renders an image thumbnail with cross-fade from icon fallback.
 *
 * In Electron: loads via the custom thumbnail:// protocol (efficient 64x64 resize).
 * In Web mode: loads via readFilePreviewDataUrl RPC (server-side resized preview).
 *
 * Shows the Lucide icon immediately, then cross-fades to the thumbnail on load.
 * If loading fails, the icon stays visible — no layout shift, no error state.
 */
const FileThumbnail = memo(function FileThumbnail({ file }: { file: SessionFile }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  // Reset state when file changes (e.g. watcher triggered re-render)
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
    setDataUrl(null)
  }, [file.path])

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const previewableSet = isWebMode ? WEB_PREVIEWABLE_EXTENSIONS : PREVIEWABLE_EXTENSIONS
  const canPreview = previewableSet.has(ext)

  // Web mode: load a small preview via RPC as a base64 data URL
  useEffect(() => {
    if (!isWebMode || !canPreview || failed) return
    let cancelled = false
    window.electronAPI.readFilePreviewDataUrl(file.path, 64).then((url) => {
      if (!cancelled) setDataUrl(url)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [file.path, canPreview, failed])

  // Fall back to regular icon if not previewable or thumbnail failed
  if (!canPreview || failed) {
    return getFileIcon(file)
  }

  const imgSrc = isWebMode ? dataUrl : getThumbnailUrl(file.path)

  return (
    <>
      {/* Fallback icon — visible initially, fades out when thumbnail loads */}
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
          loaded ? 'opacity-0' : 'opacity-100'
        )}
      >
        {getFileIcon(file)}
      </span>
      {/* Thumbnail — fades in on successful load */}
      {imgSrc && (
        <img
          src={imgSrc}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 h-full w-full rounded-[2px] object-cover transition-opacity duration-200',
            loaded ? 'opacity-100' : 'opacity-0'
          )}
        />
      )}
    </>
  )
})

interface FileTreeItemProps {
  file: SessionFile
  depth: number
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onFileDoubleClick: (file: SessionFile) => void
  onRevealInFileManager: (path: string) => void
  /** Whether this item is inside an expanded folder (for stagger animation) */
  isNested?: boolean
  /** Depth cap value from the parent selector (undefined = no cap). */
  expandDepth?: number
  /** Root path for depth computation (same as sessionFolderPath). */
  rootPath?: string
  /**
   * Paths the user has drilled past the depth cap.  Surfaced on the
   * row as a `data-drilled` attribute so:
   *   1. tests can verify drill entry/exit without coupling to internal
   *      React state,
   *   2. future CSS can dim/accent drilled rows without re-deriving the
   *      decision from props.
   */
  drilledPaths?: Set<string>
}

/**
 * Recursive file tree item component
 * Matches LeftSidebar styling patterns exactly:
 * - Vertical line on container level (not per-item)
 * - Framer-motion staggered animation for expand/collapse
 * - Chevron shown on hover, icon hidden
 */
function FileTreeItem({
  file,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  onFileDoubleClick,
  onRevealInFileManager,
  isNested,
  expandDepth,
  rootPath,
  drilledPaths,
}: FileTreeItemProps) {
  const { t } = useTranslation()
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const hasChildren = isDirectory && file.children && file.children.length > 0

  // ── useId() for collision-free banner id ──────────────────────────
  // Mirrors the Working Directory tree's TreeRow pattern.  React
  // guarantees useId() is unique across the tree.
  const gateBannerId = useId()

  // Compute whether this directory's forward-expansion would be gated
  // by the shared depth-cap contract.  Uses the same helper as the
  // Working Directory tree (shouldGateManualExpand from @archstudio/ui).
  const isGated = isDirectory
    && hasChildren
    && !isExpanded
    && rootPath != null
    && expandDepth != null
    && shouldGateManualExpand(rootPath, file.path, expandDepth, false).kind === 'gate-forward'

  // Whether the user has drilled this row past the depth cap.  Surfaced as
  // `data-drilled` (the drill test surface) — drill entry is ephemeral state
  // owned by the parent, so a row is "drilled" only while its path is in
  // drilledPaths.
  const isDrilled = drilledPaths?.has(file.path) ?? false

  // Only wrap with hover preview for image-previewable files; non-image
  // files (code, text, JSON, etc.) fall through to the plain icon.
  const fileExt = file.name.split('.').pop()?.toLowerCase() || ''
  const previewableSet = isWebMode ? WEB_PREVIEWABLE_EXTENSIONS : PREVIEWABLE_EXTENSIONS
  const isPreviewableImage = !isDirectory && previewableSet.has(fileExt)

  const handleClick = () => {
    if (isDirectory && hasChildren) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleDoubleClick = () => {
    onFileDoubleClick(file)
  }

  // Handle chevron click separately to toggle expand
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hasChildren) {
      onToggleExpand(file.path)
    }
  }

  // The bare button — Tooltip and ContextMenu are composed around it
  // in innerContent below.  Both Radix triggers use asChild forwarding
  // so the button receives hover (TooltipTrigger) and right-click
  // (ContextMenuTrigger) events through the same DOM node.
  const buttonElement = (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      aria-describedby={isGated ? gateBannerId : undefined}
      // Gate affordance test surface — tests verify the cap enforcement
      // via this attribute (the chevron dims, the banner tooltip fires,
      // and `handleToggleExpand` will refuse the click).  See
      // SessionFilesSection.gate-enforcement.test.tsx.
      data-gated={isGated ? 'true' : undefined}
      data-drilled={isDrilled ? 'true' : undefined}
      className={cn(
        // Base styles matching LeftSidebar exactly
        // min-w-0 and overflow-hidden required for truncation to work in grid context
        "group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left",
        "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "hover:bg-sidebar-hover transition-colors",
        // Same padding for all items - nested indentation handled by container
        "px-2"
      )}
      title={`${file.path}\n${file.type === 'file' ? formatFileSize(file.size) : 'Directory'}\n\nClick to ${hasChildren ? 'expand' : 'reveal'}, double-click to open`}
    >
      {/* Icon container with hover-revealed chevron for expandable items */}
      <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        {hasChildren ? (
          <>
            {/* Main icon - hidden on hover */}
            <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
              {getFileIcon(file, isExpanded)}
            </span>
            {/* Toggle chevron — shown on hover, dimmed when gated.
                When gated, the chevron is wrapped in a focusable span
                that acts as the TooltipTrigger (Radix asChild), so
                the depth-cap explanation is anchored to the visual
                sentinel of the gate — the chevron is the primary cue,
                and the explanation lives with it.

                Two-span structure (outer + nested trigger) is
                intentional:

                  • Outer span owns the visibility/animation CSS,
                    the row-button-click stop-propagation (via
                    onClick={handleChevronClick}), the data-gated
                    flag for the dim styling, and cursor-pointer.

                  • Inner span is the TooltipTrigger.  Computing
                    it inline (with tabIndex={0}, aria-label, focus
                    ring, flex h-full w-full) keeps the chevron's
                    hover/focus state and the Radix trigger on the
                    same DOM element — sighted keyboard users
                    (Tab + Enter) activate the chevron's onClick
                    via the cloned trigger, and the visible focus
                    ring matches the row button's pattern.

                Radix details worth knowing:

                  • `forceMount` lives on TooltipContent (not the
                    Tooltip root) — Radix types the prop on the leaf
                    primitive.  This keeps the banner div mounted so
                    the row button's aria-describedby reference is
                    always resolvable, even when the popover is
                    closed.  Without it, the aria-describedby would
                    dangle (silent screen-reader fail).

                  • `side="left"` — SessionFilesSection rows live in
                    the right sidebar; right-extending tooltips would
                    push off-screen.  Matches the row-level
                    tooltip's positioning. */}
            <span
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer motion-reduce:transition-none data-[gated=true]:opacity-45 data-[gated=true]:hover:opacity-75"
              onClick={handleChevronClick}
              data-gated={isGated ? 'true' : undefined}
            >
              {isGated ? (
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      aria-label={`Expand ${file.name} (capped at ${expandDepth} levels)`}
                      className="flex h-full w-full items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                          isExpanded && "rotate-90"
                        )}
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    forceMount
                    side="left"
                    align="start"
                    sideOffset={6}
                    className="arch-tree-tooltip-wrap"
                  >
                    {/* Banner id is the anchor for the row button's
                        aria-describedby — the screen-reader
                        explanation stays resolvable even when the
                        popover is closed, thanks to forceMount on
                        TooltipContent. */}
                    <div
                      id={gateBannerId}
                      className="wd-files-gated-banner"
                    >
                      <AlertTriangle
                        size={12}
                        aria-hidden="true"
                        className="wd-files-gated-banner__icon"
                      />
                      <span>
                        Capped at {expandDepth} levels — bump the selector to drill in.
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                    isExpanded && "rotate-90"
                  )}
                />
              )}
            </span>
          </>
        ) : isPreviewableImage ? (
          /* Image file: small thumbnail (FileThumbnail) wrapped in a
             hover-preview that shows a larger popover on hover. The popover
             auto-closes on mouseleave and cancels its hide timer when the
             cursor crosses onto the popover itself so users can inspect
             the larger image without flicker. */
          <ThumbnailHoverPreview file={{ path: file.path, name: file.name }}>
            <FileThumbnail file={file} />
          </ThumbnailHoverPreview>
        ) : (
          /* Non-image files: icon only, no hover preview. */
          <FileThumbnail file={file} />
        )}
      </span>

      {/* File/folder name - min-w-0 required for truncate to work in flex container */}
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
    </button>
  )

  const fileManagerName = getFileManagerName()

  // Inner content: Tooltip wrapping ContextMenu wrapping the button.
  // Tooltip MUST be outside ContextMenu so both Radix asChild layers
  // forward to the same DOM button — TooltipTrigger passes hover props
  // and ContextMenuTrigger passes right-click props.
  const innerContent = (
    <div className="group/section min-w-0">
    <Tooltip delayDuration={400}>
        <ContextMenu>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              {buttonElement}
            </ContextMenuTrigger>
          </TooltipTrigger>
        <StyledContextMenuContent>
          {/* Open — files only (folders just show "Show in file manager") */}
          {file.type !== 'directory' && (
            <StyledContextMenuItem onSelect={() => onFileClick(file)}>
              <ExternalLink className="h-3.5 w-3.5" />
              {t("chat.openFile")}
            </StyledContextMenuItem>
          )}
          {/* Show in file manager */}
          <StyledContextMenuItem
            onSelect={() => onRevealInFileManager(file.path)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("chat.showInFileManager", { fileManager: fileManagerName })}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
          </ContextMenu>
      <TooltipContent
        side="left"
        align="start"
        sideOffset={6}
        className="arch-tree-tooltip-wrap"
      >
        {/* Gate affordance moved out: in this revision the gate banner
            lives on the chevron's own Tooltip (fired only on chevron
            hover, anchored visually to the chevron) rather than the
            row-level tooltip.  The aria-describedby on the button
            below still points to gateBannerId, which the chevron's
            TooltipContent now hosts — so screen-reader navigation
            across the row picks up the gate explanation without
            burying it inside file metadata. */}
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          <div className="truncate max-w-[200px]" title={file.path}>{file.path}</div>
          {file.type === 'file' && file.size != null && (
            <div>{formatFileSize(file.size)}</div>
          )}
          {file.type === 'directory' && <div>Directory</div>}
          <div className="text-[10px] opacity-60 mt-0.5">
            {hasChildren ? 'Click to expand, double-click to open' : 'Click to reveal, double-click to open'}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
      {/* Expandable children with framer-motion animation - matches LeftSidebar exactly */}
      {hasChildren && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              {/* Wrapper div matches LeftSidebar recursive structure - min-w-0 allows shrinking */}
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {/* Vertical line at container level - matches LeftSidebar pattern */}
                  <div
                    className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
                    aria-hidden="true"
                  />
                  {file.children!.map((child) => (
                    <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                      <FileTreeItem
                        file={child}
                        depth={depth + 1}
                        expandedPaths={expandedPaths}
                        onToggleExpand={onToggleExpand}
                        onFileClick={onFileClick}
                        onFileDoubleClick={onFileDoubleClick}
                        onRevealInFileManager={onRevealInFileManager}
                        isNested={true}
                        expandDepth={expandDepth}
                        rootPath={rootPath}
                        drilledPaths={drilledPaths}
                      />
                    </motion.div>
                  ))}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )

  // For nested items, the parent already wraps in motion.div for stagger
  // Root items use Fragment to avoid extra wrapper (matches LeftSidebar exactly)
  return <>{innerContent}</>
}

/**
 * Section displaying session files as a tree
 */
export function SessionFilesSection({ sessionId, className, sessionFolderPath, hideHeader = false }: SessionFilesSectionProps) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<SessionFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [hasSavedExpandedState, setHasSavedExpandedState] = useState(false)

  // Save expanded paths to storage when they change.
  // Declared EARLY (before the count-cap useEffect) so the count-cap
  // effect's dependency-array reference resolves at TS evaluation time.
  // saveExpandedPaths is stable for the lifetime of the sessionId, so
  // putting it first doesn't alter the count-cap effect's behavior.
  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (sessionId) {
      storage.set(storage.KEYS.sessionFilesExpandedFolders, Array.from(paths), sessionId)
    }
  }, [sessionId])

  // ── Cumulative open-directory cap ──────────────────────────────────
  // Mirrors the Working Directory tree's count-cap contract.
  // When expandedPaths exceeds MAX_SESSION_DIRS, leaf-most entries
  // are silently collapsed until back under the limit.
  // depth=N + count=K compose into a single guardrail.
  const MAX_SESSION_DIRS = 50
  useEffect(() => {
    if (!sessionFolderPath) return
    if (expandedPaths.size <= MAX_SESSION_DIRS) {
      // Dropped back under the limit — reset for next crossing.
      countCapToastedRef.current = false
      return
    }
    const { keep, dropped } = trimExpandedByCount(
      expandedPaths,
      sessionFolderPath,
      MAX_SESSION_DIRS,
    )
    if (keep.size !== expandedPaths.size) {
      setExpandedPaths(keep)
      saveExpandedPaths(keep)
      // Only toast on the first crossing, not every subsequent trim.
      if (!countCapToastedRef.current && dropped.length > 0) {
        countCapToastedRef.current = true
        toast.info(
          `Collapsed ${dropped.length} director${dropped.length !== 1 ? 'ies' : 'y'} to stay within the ${MAX_SESSION_DIRS} open-dir limit`,
          { duration: 4_000 },
        )
      }
    }
  }, [expandedPaths.size, sessionFolderPath, saveExpandedPaths])

  // Depth cap for the "depth=N means N levels" contract shared with
  // the Working Directory tree.  Infinity = no cap ("All").
  const [expandDepth, setExpandDepth] = useState<number>(2)

  const mountedRef = useRef(true)
  // Tracks whether we've already toasted for the current count-cap
  // crossing.  Prevents toast spam when rapid expansions fire the
  // trim multiple times in quick succession.
  const countCapToastedRef = useRef(false)

  // ── Drill mode ───────────────────────────────────────────────────────
  // Per-row transient bypass of the depth cap.  When the user clicks
  // a gated chevron (forward expansion past the cap), drill mode
  // expands the row by one extra level for that subtree only — it
  // does NOT change the global expandDepth selector.  Drill markers
  // auto-revert on:
  //   • collapse of the drilled row                       (handleToggleExpand)
  //   • Collapse-all                                       (handleCollapseAll)
  //   • session switch                                     (useEffect above)
  //   • count-cap trim removes the expanded row           (prune useEffect)
  // Drill state is ephemeral (in-memory only) — it does not persist
  // across app restarts.  The point of drill is "I can see the cap;
  // let me past it for this one row" without globally lifting the cap.
  const [drilledPaths, setDrilledPaths] = useState<Set<string>>(new Set())

  // Ref-mirror of drilledPaths.  handleToggleExpand reads from this
  // ref for the idempotent-check + sync-update sequence so rapid
  // clicks within the same render cycle correctly observe the prior
  // click's marker (the captured drilledPaths closure would be stale
  // until React commits the next render).  Mirrors the count-cap's
  // countCapToastedRef pattern for the same spam-prevention reason.
  const drilledPathsRef = useRef<Set<string>>(drilledPaths)
  useEffect(() => {
    drilledPathsRef.current = drilledPaths
  }, [drilledPaths])

  // Prune drilledPaths against expandedPaths.  Without this, a row
  // that was drilled and then trimmed by the count-cap useEffect would
  // leave an orphaned drill marker with no UI affordance to clear it
  // (the Collapse-all button hides when expandedPaths.size === 0).
  // Runs whenever expandedPaths or drilledPaths changes; the early
  // return on empty drilledPaths avoids infinite re-runs.
  useEffect(() => {
    if (drilledPaths.size === 0) return
    let changed = false
    const next = new Set<string>()
    for (const p of drilledPaths) {
      if (expandedPaths.has(p)) {
        next.add(p)
      } else {
        changed = true
      }
    }
    if (changed) {
      setDrilledPaths(next)
    }
  }, [expandedPaths, drilledPaths])

  // Load expanded paths from storage when session changes.
  // If no value exists yet, we default to "expand all" after files load.
  // Drilled paths are session-scoped and reset alongside expandedPaths
  // (drill markers don't survive the session; this is intentional).
  useEffect(() => {
    if (sessionId) {
      const raw = storage.getRaw(storage.KEYS.sessionFilesExpandedFolders, sessionId)
      if (raw !== null) {
        const saved = storage.get<string[]>(storage.KEYS.sessionFilesExpandedFolders, [], sessionId)
        setExpandedPaths(new Set(saved))
        setHasSavedExpandedState(true)
      } else {
        setExpandedPaths(new Set())
        setHasSavedExpandedState(false)
      }
    } else {
      setExpandedPaths(new Set())
      setHasSavedExpandedState(false)
    }
    // Drill markers reset on every session-switch (drill is ephemeral);
    // the mirror effect clears the ref on the next commit.
    setDrilledPaths(new Set())
  }, [sessionId])

  // Load files
  const loadFiles = useCallback(async () => {
    if (!sessionId) {
      setFiles([])
      return
    }

    setIsLoading(true)
    try {
      const sessionFiles = await window.electronAPI.getSessionFiles(sessionId)
      if (mountedRef.current) {
        setFiles(sessionFiles)

        // Default behavior: expand the folder tree up to expandDepth.
        if (!hasSavedExpandedState) {
          const allDirectoryPaths = new Set(collectDirectoryPathsUpToDepth(sessionFiles, expandDepth))
          if (allDirectoryPaths.size > 0) {
            setExpandedPaths(allDirectoryPaths)
            saveExpandedPaths(allDirectoryPaths)
            setHasSavedExpandedState(true)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load session files:', error)
      if (mountedRef.current) {
        setFiles([])
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [sessionId, hasSavedExpandedState, saveExpandedPaths])

  // Initial load and file watcher setup
  useEffect(() => {
    mountedRef.current = true
    loadFiles()

    if (sessionId) {
      // Start watching for file changes
      void window.electronAPI.watchSessionFiles(sessionId)

      // Listen for file change events
      const unsubscribe = window.electronAPI.onSessionFilesChanged((changedSessionId) => {
        if (changedSessionId === sessionId && mountedRef.current) {
          void loadFiles()
        }
      })

      const unsubscribeReconnect = window.electronAPI.onReconnected(() => {
        if (!mountedRef.current) return
        void restoreSessionFileWatch(sessionId, loadFiles)
      })

      return () => {
        mountedRef.current = false
        unsubscribe()
        unsubscribeReconnect()
        void window.electronAPI.unwatchSessionFiles()
      }
    }

    return () => {
      mountedRef.current = false
    }
  }, [sessionId, loadFiles])

  // Use the link interceptor (via context) so file clicks show in-app previews
  // instead of always opening in the file manager / default app.
  const { onOpenFile } = useAppShellContext()
  const fileManagerName = getFileManagerName()

  // Reveal a file/folder in the system file manager
  const handleRevealInFileManager = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // Handle file click — preview in-app if possible, open directory in file manager
  const handleFileClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      // eslint-disable-next-line craft-links/no-direct-file-open -- directories can't be previewed in-app
      window.electronAPI.openFile(file.path)
    } else {
      onOpenFile(file.path)
    }
  }, [onOpenFile])

  // Handle double-click — same as single click (interceptor decides preview vs external)
  const handleFileDoubleClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      // eslint-disable-next-line craft-links/no-direct-file-open -- directories can't be previewed in-app
      window.electronAPI.openFile(file.path)
    } else {
      onOpenFile(file.path)
    }
  }, [onOpenFile])

  // Toggle folder expanded state — gated by the depth cap from
  // the shared shouldGateManualExpand helper (same contract as
  // the Working Directory tree).
  //
  //   forward expansion + within cap → expand (no drill)
  //   forward expansion + at-or-past cap → DRILL (expand + mark row)
  //   collapse → always allowed; the drill marker for this row is
  //              cleared here so each drill entry is per-instance.
  const handleToggleExpand = useCallback((path: string) => {
    if (!sessionFolderPath) {
      // No rootPath → no gate possible; simple toggle.
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        saveExpandedPaths(next)
        return next
      })
      return
    }

    const isCurrentlyExpanded = expandedPaths.has(path)

    // Collapse path — always allowed; users must be able to back out of
    // an accidental expansion regardless of depth cap.  The drill marker
    // for this row is cleared here so each drill entry is per-instance.
    if (isCurrentlyExpanded) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        saveExpandedPaths(next)
        return next
      })
      if (drilledPathsRef.current.has(path)) {
        // Update the ref synchronously (not inside the state updater) so a
        // re-click in the same render cycle observes the cleared marker.
        const nextDrilled = new Set(drilledPathsRef.current)
        nextDrilled.delete(path)
        drilledPathsRef.current = nextDrilled
        setDrilledPaths(nextDrilled)
      }
      return
    }

    // Forward expansion — consult the depth gate.
    const decision = shouldGateManualExpand(
      sessionFolderPath,
      path,
      expandDepth,
      /* isCurrentlyExpanded */ false,
    )

    if (decision.kind === 'gate-forward') {
      // Drill mode: expand this one row past the cap and mark it so the
      // row surfaces a `data-drilled` affordance.  The depth selector
      // still gates everything else — this is "I can see the cap; let
      // me past it for this one row" without globally lifting the cap.
      //
      // Spam-prevention: rapid clicks within the same render cycle see
      // the stale expandedPaths closure, so re-clicking a gated row
      // before React commits would refire the toast.  drilledPathsRef
      // (mirrored on every commit) makes the second/third click observe
      // the drill marker and skip the toast — same shape as the
      // count-cap's countCapToastedRef pattern.
      if (drilledPathsRef.current.has(path)) {
        return
      }

      // Update the ref synchronously (not inside the state updater) so rapid
      // re-clicks in the same render cycle observe the drill marker and skip
      // the toast.
      const nextDrilled = new Set(drilledPathsRef.current)
      nextDrilled.add(path)
      drilledPathsRef.current = nextDrilled
      setDrilledPaths(nextDrilled)
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.add(path)
        saveExpandedPaths(next)
        return next
      })
      toast.info('Drilled past depth cap — click again to collapse.', { duration: 3_000 })
      return
    }

    setExpandedPaths((prev) => {
      const next = new Set(prev)
      next.add(path)
      saveExpandedPaths(next)
      return next
    })
  }, [saveExpandedPaths, sessionFolderPath, expandDepth, expandedPaths])

  // Collapse-all — clears expandedPaths and all drill markers.
  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set())
    saveExpandedPaths(new Set())
    // No open-count cap in this section — that guardrail lives in LayoutShell's
    // working-directory tree, which owns the `openCountCapped` state.
    setDrilledPaths(new Set())
  }, [saveExpandedPaths])

  if (!sessionId) {
    return null
  }

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)}>
      {/* Header - matches sidebar styling with select-none, extra top padding for visual balance */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 select-none">
          <span className="text-xs font-medium text-muted-foreground">{t("chat.sessionFiles")}</span>
          <div className="flex items-center gap-2">
            {/* Depth selector — mirrors the Working Directory tree's
                "depth=N means N levels" contract.  Shared helper:
                shouldGateManualExpand from @archstudio/ui. */}
            {sessionFolderPath && (
              <span className="inline-flex items-center rounded bg-sidebar-surface px-0.5 py-px text-[10px] text-muted-foreground gap-px">
                {([1, 2, 3, Infinity] as const).map((d) => (
                  <button
                    key={String(d)}
                    type="button"
                    className={`px-1 py-px rounded-sm ${expandDepth === d ? 'bg-accent text-accent-foreground' : 'hover:bg-sidebar-hover'}`}
                    onClick={() => setExpandDepth(d)}
                    title={Number.isFinite(d) ? `Depth: ${d} level${d !== 1 ? 's' : ''}` : 'Show all'}
                  >
                    {Number.isFinite(d) ? d : 'All'}
                  </button>
                ))}
              </span>
            )}
            {/* Collapse-all — visible when there's at least one expanded
                path.  (Earlier revisions also counted drill markers;
                drill mode has been removed in the gate-enforcement
                revision so expandedPaths alone is sufficient.) */}
            {sessionFolderPath && expandedPaths.size > 0 && (
              <button
                type="button"
                onClick={handleCollapseAll}
                className="text-foreground/50 hover:text-foreground/80 hover:bg-sidebar-hover rounded px-1 py-px transition-colors"
                title="Collapse all"
                aria-label="Collapse all"
                data-testid="session-files-collapse-all"
              >
                <ListCollapse className="h-3.5 w-3.5" />
              </button>
            )}
            {sessionFolderPath && (
              <button
                type="button"
                onClick={() => window.electronAPI.showInFolder(sessionFolderPath)}
                className="text-xs text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors"
              >
                {t("chat.viewInFileManager", { fileManager: fileManagerName })}
              </button>
            )}
          </div>
        </div>
      )}

      {/* File tree - px-2 is on nav to match LeftSidebar exactly (constrains grid width) */}
      {/* overflow-x-hidden prevents horizontal scroll, forcing truncation */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2 min-h-0">
        {files.length === 0 ? (
          <div className="px-4 text-muted-foreground select-none">
            <p className="text-xs">
              {isLoading ? t('chat.sessionFilesLoading') : t('chat.sessionFilesEmpty')}
            </p>
          </div>
        ) : (
          /* Root nav has px-2 to match LeftSidebar exactly - this constrains grid width */
          <nav className="grid gap-0.5 px-2">
            {files.map((file) => (
              <FileTreeItem
                key={file.path}
                file={file}
                depth={0}
                expandedPaths={expandedPaths}
                onToggleExpand={handleToggleExpand}
                onFileClick={handleFileClick}
                onFileDoubleClick={handleFileDoubleClick}
                onRevealInFileManager={handleRevealInFileManager}
                expandDepth={expandDepth}
                rootPath={sessionFolderPath}
                drilledPaths={drilledPaths}
              />
            ))}
          </nav>
        )}
      </div>
    </div>
  )
}
