import React, { useState, useMemo, useCallback, useEffect, useRef, useId } from 'react'
import { atom, useAtomValue } from 'jotai'
import {
  Command,
  Search,
  Settings,
  Brain,
  FolderKanban,
  Folder,
  Activity,
  Clapperboard,
  BookOpen,
  Plug,
  Globe,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Monitor,
  FileText,
  Image,
  File,
  Plus,
  MessageSquarePlus,
  MessagesSquare,
  ExternalLink,
  Trash2,
  FilePlus,
  RefreshCw,
  GitBranch,
  ChevronRight,
  ChevronDown,
  ChevronsDownUp,
  X,
  Check,
  Undo2,
  Copy,
  Play,
  AlertTriangle,
  Pin,
} from 'lucide-react'
import { MemoryPanel } from '../panels/memory'
import { RunsPanel } from '../panels/runs'
import { CommandPanel } from '../panels/command'
import { ProjectsPanel } from '../panels/projects'
import { IntegrationsPanel } from '../panels/integrations'
import { SearchPanel } from '../panels/search'
import { SecurityPanel } from '../panels/security'
import { SettingsPanel } from '../panels/settings'
import { MediaLabPanel } from '../panels/media-lab'
import { PromptStudioPanel } from '../panels/prompts'
import { ProvidersPanel } from '../panels/ProvidersPanel'
import { ThumbnailHoverPreview } from '../components/right-sidebar/ThumbnailHoverPreview'
import { ShikiDiffViewer } from '../components/shiki'
import { HighlightedDiffViewer, type DiffViewMode } from '@archstudio/ui'
import { HomeHero } from '../home'
import { sessionMetaMapAtom, activeSessionIdAtom, sessionAtomFamily } from '../atoms/sessions'
import { CodeWorkspacePanel, CanvasWorkspacePanel, PreviewWorkspacePanel, TasksWorkspacePanel, type WorkspaceArtifact } from './WorkspaceTabPanels'
import type { StoredAttachment, Session } from '../../shared/types'
import { AnimatedARCHstudioSymbol } from '../components/icons/AnimatedARCHstudioSymbol'
import { toast } from 'sonner'
import type { GitFileEntry, GitStatusData, ShellSessionContext } from './types'
import { buildTreeTooltip, TreeTooltipContent, type TooltipData } from './treeTooltip'
import { useOptionalTheme } from '../context/ThemeContext'
import { navigate, routes } from '../lib/navigate'
import { getInitialSessionsView } from './shell-navigation'
import { computeDepthFromRoot, shouldGateManualExpand, trimExpandedByCount } from '@archstudio/ui'
import { Tooltip, TooltipTrigger, TooltipContent } from '@archstudio/ui'
import './LayoutShell.css'

export type ShellView =
  | 'command'
  | 'sessions'
  | 'runs'
  | 'projects'
  | 'memory'
  | 'media-lab'
  | 'prompts'
  | 'providers'
  | 'integrations'
  | 'security'
  | 'search'
  | 'settings'

export type ThemeMode = 'light' | 'dark' | 'system'

type WorkspaceTab = 'agent-chat' | 'code' | 'canvas' | 'preview' | 'tasks'
type RailTab = 'context' | 'files' | 'changes'

const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'agent-chat', label: 'Agent Chat' },
  { id: 'code', label: 'Code' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'preview', label: 'Preview' },
  { id: 'tasks', label: 'Tasks' },
]

const RAIL_TABS: { id: RailTab; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'files', label: 'Files' },
  { id: 'changes', label: 'Changes' },
]

const navItems = [
  { id: 'sessions' as ShellView, label: 'Sessions', icon: MessagesSquare },
  { id: 'command' as ShellView, label: 'Command', icon: Command },
  // Label only — the `runs` id is a wire-level deep-link route
  // (`archstudio://runs/...`, see shared/route-parser.ts) and must not change.
  // "Activity" is the honest name: these are sessions with status and spend,
  // not discrete job executions.
  { id: 'runs' as ShellView, label: 'Activity', icon: Activity },
  { id: 'projects' as ShellView, label: 'Projects', icon: FolderKanban },
  { id: 'memory' as ShellView, label: 'Memory', icon: Brain },
  { id: 'media-lab' as ShellView, label: 'Media Lab', icon: Clapperboard },
  { id: 'prompts' as ShellView, label: 'Prompt Studio', icon: BookOpen },
  { id: 'providers' as ShellView, label: 'Providers', icon: Plug },
  { id: 'integrations' as ShellView, label: 'Integrations', icon: Globe },
  { id: 'security' as ShellView, label: 'Security', icon: ShieldCheck },
  { id: 'search' as ShellView, label: 'Search', icon: Search },
] as const

// Settings is deliberately NOT in `navItems`: it renders pinned to the bottom
// of the sidebar (in `.layout-sidebar__footer`) rather than as the last entry
// in the scrolling nav list, so it stays reachable no matter how long the nav
// list grows. Kept as its own const — rather than inlined at the render site —
// so the topbar title lookup can still resolve a label for the settings view.
const settingsNavItem = { id: 'settings' as ShellView, label: 'Settings', icon: Settings } as const

// Theme toggle options, pinned top-right in the shell header.
//
// Order and colour are deliberate and coupled: read left-to-right the three
// options form a traffic light (red → amber → green), so the active mode is
// identifiable by colour alone at a glance without parsing the icon. The
// `tone` drives the per-option glow in LayoutShell.css; changing the array
// order without changing the tones would break that reading.
const themeOptions = [
  { mode: 'dark' as ThemeMode, icon: Moon, label: 'Night', tone: 'night' },
  { mode: 'light' as ThemeMode, icon: Sun, label: 'Day', tone: 'day' },
  { mode: 'system' as ThemeMode, icon: Monitor, label: 'System', tone: 'system' },
] as const

// ── Expansion safety cap ─────────────────────────────────────────────
//
// Bounded expansion of the Working Directory tree to prevent runaway
// IPC spam on pathological monorepos / vendored dependency trees.
// A single npm project can have tens of thousands of node_modules
// subdirectories — naive "expand all" on /node_modules would generate
// tens of thousands of listDirectoryFiles round-trips and freeze the
// renderer.  The cap bounds the BFS by TOTAL discovered directories,
// not by depth (a shallow-but-wide tree can also blow past the cap).
//
// 100 is a pragmatic default — wide enough for any sane repo's
// auto-discovery, narrow enough that the user notices when they've
// hit it and can either pick a shallower depth or use the manual
// toggleExpand for the few hot dirs they actually want open.
//
// Constant rather than user setting today; if a future user wants
// "more," promote to a Settings toggle.  Keep the constant local so a
// follow-up migration is one refactor away.
const MAX_EXPAND_DIRS = 100

// ── Cumulative open-directory cap ──────────────────────────────────────
//
// Orthogonal to the BFS `MAX_EXPAND_DIRS` cap (which bounds the *bulk
// discovery*).  This cap bounds the *total number of simultaneously-open
// directories* in the tree, regardless of how each one was reached —
// manual clicks, file-watch re-expands, drill-mode bumps, or the bulk
// BFS.  The two caps compose cleanly:
//
//   - depth=N controls *how deep* each branch can go
//   - count=K controls *how many* branches can stay open at once
//
// When exceeded, leaf-most entries (highest depth from root) are silently
// collapsed until we're back under the limit.  A small chip next to the
// depth selector lets the user know the trim fired.
//
// 50 is a pragmatic default — wide enough for any sane repo's manual
// exploration, narrow enough that the renderer stays responsive.  The cap
// is promoted to a workspace-scoped setting (see `maxOpenDirs` prop below);
// the constant remains as a fallback when no override is supplied.
const DEFAULT_MAX_OPEN_DIRS = 50

type LayoutShellProps = {
  initialView?: ShellView
  /**
   * Which right-rail tab to open on first paint. Defaults to `'context'`
   * (the existing behaviour). Tests pass `'changes'` to land directly on
   * the Recent Changes rail without having to click the tab button.
   */
  initialRailTab?: RailTab
  /**
   * Pre-populates the Recent Changes rail with a fixed git status, skipping
   * the `getGitBranch` / `getGitStatus` fetch path entirely. Server-side
   * rendering (used by `LayoutShell.context-rail.test.tsx`) can't run
   * useEffect, so without this prop the rail would always render its
   * loading / empty state under SSR. Tests pass a fully-formed
   * `GitStatusData` to assert against arbitrary states without an IPC round-trip.
   */
  initialGitStatus?: GitStatusData | null
  onNavigate?: (view: ShellView) => void
  theme?: ThemeMode
  onThemeChange?: (theme: ThemeMode) => void
  topBar?: React.ReactNode
  breadcrumbs?: { label: string; onClick?: () => void }[]
  /**
   * Start a new chat. Optional so the playground can mount the shell without
   * session plumbing, but the desktop app always supplies it — closing the last
   * chat otherwise leaves no way back into a conversation.
   */
  onNewChat?: () => void
  /**
   * Real state for the "Session context" rail. Computed by the caller, which is
   * where the selected session, its options and the connection list all live.
   * Omitted (playground, no selection) renders an explicit "No session selected"
   * state — the rail must never invent plausible-looking values.
   */
  sessionContext?: ShellSessionContext
  /**
   * Override for the cumulative open-directory cap on the working-directory
   * tree. Power users with wide monorepos can bump this to 100 or 200 via
   * `WorkspaceSettingsPage > Advanced > Max open dirs`; the value reaches
   * this component as a prop threaded down from `AppShell` (which loads it
   * from the workspace settings store on mount + on workspace change).
   * Undefined falls back to `DEFAULT_MAX_OPEN_DIRS` (50).
   *
   * Promote-to-setting path for the prior hardcoded `MAX_OPEN_DIRS`
   * constant. Tests pass an explicit value to lock in deterministic
   * cap behaviour without depending on the default.
   */
  maxOpenDirs?: number
  children?: React.ReactNode
  /** Called when the sidebar toggle button is clicked (e.g. from TopBar) */
  onToggleSidebar?: () => void
  /**
   * Session list (and its LeftSidebar) rendered inside the brand rail, below
   * the nav items and above the footer. Optional so the playground/tests can
   * mount the shell without session plumbing.
   */
  sessionListSlot?: React.ReactNode | ((view: 'list' | 'board', onViewChange: (view: 'list' | 'board') => void) => React.ReactNode)
  /**
   * Controlled collapse state for the brand rail. When provided, it drives the
   * `layout-sidebar--collapsed` class and toggle icon, and the toggle button
   * calls `onToggleSidebar` instead of mutating local state. When undefined,
   * falls back to local state so the playground/tests still work.
   */
  sidebarCollapsed?: boolean
}

// What the context rail can honestly report about the active session.
// Defined in `./types` so the rail's tests can share the real shape instead of
// hand-copying it (the copies drifted and lost `modelLabel`). Re-exported here
// to keep the existing import path working.
export type { ShellSessionContext } from './types'

/** A constant atom that always holds null — used in place of a missing session atom
 *  so we can call useAtomValue unconditionally even when no session is selected. */
const nullSessionAtom = atom<Session | null>(null)

/**
 * Guarded `localStorage` access for the per-session workspace-tab state.
 *
 * LayoutShell is rendered in bare test/SSR harnesses (`renderToStaticMarkup`
 * with no DOM globals installed), where `localStorage` is not merely empty but
 * *undefined*. An unguarded `localStorage.setItem` therefore threw
 * `ReferenceError: localStorage is not defined` during the persist effect,
 * which took the whole component down and failed 29 shell tests at once.
 *
 * Persistence here is a convenience, never load-bearing — so both helpers
 * swallow failure and the caller carries on with in-memory state. The try/catch
 * also covers the real-browser failure modes the `typeof` check does not:
 * private-browsing denials and quota-exceeded on write.
 */
function readWorkspaceStateRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeWorkspaceStateRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable or full — tab state simply won't survive a reload.
  }
}

// Local copy of formatFileSize for the wd-files-summary bar.  Keep it
// here rather than importing from treeTooltip.ts because the summary
// bar has no tooltip semantics — the two callers happen to share
// rounding rules today, but they aren't conceptually coupled.
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(type: string, size = 16) {
  switch (type) {
    case 'image': return <Image size={size} />
    case 'audio': return <FileText size={size} />
    case 'office': return <FileText size={size} />
    case 'pdf': return <FileText size={size} />
    default: return <File size={size} />
  }
}

function getFileIconColor(type: string): string {
  switch (type) {
    case 'image': return 'var(--brand-lime)'
    case 'audio': return 'var(--info)'
    case 'office': return 'var(--accent)'
    case 'pdf': return 'var(--destructive)'
    default: return 'var(--shell-text-dim)'
  }
}

const IMAGE_EXT_RE = /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico)$/i
const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v)$/i
const MEDIA_EXT_RE = /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico|mp4|mov|webm|mkv|avi|m4v)$/i

// Stable identity for a (path, bucket) pair. A file may appear in both staged
// and unstaged buckets when its porcelain-XY has both sides non-empty (`AM` =
// staged-add + working-tree-modify). Without this composite key, the renderer's
// `key={...}` would collide between the two rows AND `setDiffFile(file.path)`
// would conflate them — clicking one would silently toggle the other.
const diffKey = (file: GitFileEntry) => `${file.path}|${file.bucket}`

// ── Tree row types (module-level so TreeRow can use useId() stably) ─

interface WdEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  mtime?: number
  /**
   * Birth / creation timestamp (ms since epoch).  Undefined on
   * filesystems that don't track birthtime reliably — see
   * ReadDirectoryEntry in packages/shared/src/protocol/dto.ts.
   */
  ctime?: number
  isSymlink: boolean
}

// ── TreeRow — per-row component using useId() for collision-free
//    banner ids.  Must be at module level (not nested inside
//    LayoutShell), otherwise React treats the re-created function as
//    a new component type on every render and resets useId().
// ──────────────────────────────────────────────────────────────────

interface TreeRowProps {
  entry: WdEntry
  depth: number
  wdRootPath: string
  expandDepth: number
  expandedPaths: Set<string>
  pinnedPaths: Set<string>
  wdChildren: Record<string, WdEntry[]>
  focusedTreePath: string | null
  pulsingPath: string | null
  flashingPath: string | null
  loadingDirs: Set<string>
  erroredDirs: Set<string>
  wdThumbnails: Record<string, string | null>
  treeBtnRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  gitStatusByPath: Map<string, Map<string, string>>
  workingDirectory: string | undefined
  onFocus: (path: string) => void
  flashExpand: (path: string) => void
  toggleExpand: (path: string) => void
  togglePin: (path: string) => void
  pulseThen: (path: string, fn: () => void) => void
  openFileLocation: (path: string) => void
  /** Open a file in the system editor.  Undefined when electronAPI
   *  is unavailable (SSR / test environments). */
  onOpenFile?: (path: string) => void
}

function TreeRow({
  entry,
  depth,
  wdRootPath,
  expandDepth,
  expandedPaths,
  pinnedPaths,
  wdChildren,
  focusedTreePath,
  pulsingPath,
  flashingPath,
  loadingDirs,
  erroredDirs,
  wdThumbnails,
  treeBtnRefs,
  gitStatusByPath,
  workingDirectory,
  onFocus,
  flashExpand,
  toggleExpand,
  togglePin,
  pulseThen,
  openFileLocation,
  onOpenFile,
}: TreeRowProps) {
  // ── useId() for collision-free banner id ──────────────────────────
  // Replaces the old path-derivation (`wd-files-gated-` + sanitize)
  // which had collisions: /a/b and /a:b both sanitized to the same
  // id.  React guarantees useId() is unique across the tree.
  const gateBannerId = useId()

  // Compute once per row — used for both data-gated and the banner.
  const isGated =
    entry.type === 'directory' &&
    !!wdRootPath &&
    shouldGateManualExpand(
      wdRootPath,
      entry.path,
      expandDepth,
      expandedPaths.has(entry.path),
    ).kind === 'gate-forward'

  // Pin state for directories only (files don't get pinned). Drives the
  // Pin icon overlay + `data-pinned` attribute for keyboard nav + tests.
  const isPinned = entry.type === 'directory' && pinnedPaths.has(entry.path)

  // Compute tooltip data once per render.
  const tooltipData: TooltipData = buildTreeTooltip(entry, wdChildren)
  const nativeFallbackTitle = [
    tooltipData.path,
    ...tooltipData.rows.map(
      (r) => `${r.label ? r.label + ': ' : ''}${r.value}`,
    ),
  ].join('\n')

  return (
    <Tooltip key={entry.path} delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          role="treeitem"
          aria-expanded={
            entry.type === 'directory'
              ? expandedPaths.has(entry.path)
              : undefined
          }
          aria-describedby={isGated ? gateBannerId : undefined}
          ref={(el) => {
            if (el) treeBtnRefs.current.set(entry.path, el)
            else treeBtnRefs.current.delete(entry.path)
          }}
          data-gated={isGated ? 'true' : undefined}
          data-pinned={isPinned ? 'true' : undefined}
          className={`wd-files-item ${entry.type === 'directory' ? 'wd-files-item--dir' : ''} ${pulsingPath === entry.path ? 'wd-files-item--pulse' : ''} ${flashingPath === entry.path ? 'wd-files-item--flash' : ''} ${focusedTreePath === entry.path ? 'wd-files-item--focused' : ''} ${isPinned ? 'wd-files-item--pinned' : ''}`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={(e) => {
            onFocus(entry.path)
            // Cmd/Ctrl+click on a directory toggles its pin state —
            // protected from the count-cap trim. Discoverable via the
            // title attribute on the row, not via visible chrome.
            if (entry.type === 'directory' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              togglePin(entry.path)
              return
            }
            if (entry.type === 'directory') {
              flashExpand(entry.path)
              toggleExpand(entry.path)
            } else {
              openFileLocation(entry.path)
            }
          }}
          title={
            isPinned
              ? `${nativeFallbackTitle}\n\nPinned (Cmd/Ctrl+click to unpin) — protected from the open-dir cap.`
              : nativeFallbackTitle
          }
          onDoubleClick={() => {
            onFocus(entry.path)
            pulseThen(entry.path, () =>
              entry.type === 'directory'
                ? openFileLocation(entry.path)
                : onOpenFile?.(entry.path),
            )
          }}
        >
          {entry.type === 'directory' && (
            <span
              className={`wd-files-tree__arrow ${expandedPaths.has(entry.path) ? 'wd-files-tree__arrow--open' : ''}`}
            >
              <ChevronRight size={10} />
            </span>
          )}
          {/*
            Pin indicator — always visible when this directory is pinned.
            Uses brand-lime (the same accent as the successful-action
            animations) so a pinned row reads as "this one is safe /
            sticky."  Rendered as the first child after the chevron so
            it's positioned consistently across all rows regardless of
            whether the chevron is shown.
          */}
          {isPinned && (
            <span
              className="wd-files-item__pin-indicator"
              aria-label="Pinned — protected from the open-dir cap"
            >
              <Pin size={10} aria-hidden="true" />
            </span>
          )}
          {/*
            Pin/unpin toggle button — hover-revealed on every directory
            row (NOT only pinned ones) so the affordance is discoverable.
            Pinned rows show the icon at full opacity always; unpinned
            rows show it at low opacity on hover, full on focus.
            stopPropagation prevents the row click from also firing
            toggleExpand.  Cmd/Ctrl+click on the row is preserved as a
            keyboard-power-user gesture (see TreeRow onClick handler).
          */}
          {entry.type === 'directory' && (
            <span className="wd-files-item__pin-toggle">
              <button
                type="button"
                aria-label={isPinned ? 'Unpin from open-dir cap' : 'Pin to protect from open-dir cap'}
                aria-pressed={isPinned}
                title={
                  isPinned
                    ? 'Pinned — click to unpin (or Cmd/Ctrl+click the row)'
                    : 'Pin this directory to protect it from the open-dir cap'
                }
                className="wd-files-item__pin-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePin(entry.path)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Pin size={11} aria-hidden="true" />
              </button>
            </span>
          )}
          {entry.type === 'directory' ? (
            <span className="wd-files-item__icon" data-type="directory">
              {loadingDirs.has(entry.path) ? (
                <RefreshCw size={11} className="arch-changes-spinner" />
              ) : erroredDirs.has(entry.path) ? (
                <span
                  className="wd-files-item__err"
                  title="Failed to read directory — check permissions"
                >
                  ⚠
                </span>
              ) : (
                <Folder size={14} />
              )}
            </span>
          ) : wdThumbnails[entry.path] ? (
            <ThumbnailHoverPreview
              file={{ path: entry.path, name: entry.name }}
            >
              <span className="wd-files-item__thumb-wrap">
                <span className="wd-files-item__thumb">
                  <img
                    src={wdThumbnails[entry.path] ?? undefined}
                    alt=""
                    loading="lazy"
                    draggable={false}
                  />
                </span>
                {VIDEO_EXT_RE.test(entry.name) && (
                  <span
                    className="wd-files-item__play-overlay"
                    aria-hidden="true"
                  >
                    <Play size={12} fill="currentColor" />
                  </span>
                )}
              </span>
            </ThumbnailHoverPreview>
          ) : (
            <span
              className="wd-files-item__icon"
              data-type="file"
              data-loading={
                MEDIA_EXT_RE.test(entry.name) &&
                !(entry.path in wdThumbnails)
                  ? 'true'
                  : undefined
              }
            >
              <File size={14} />
            </span>
          )}
          <div className="wd-files-item__info">
            <strong className="wd-files-item__name">{entry.name}</strong>
            {entry.type === 'file' &&
              (() => {
                if (!workingDirectory) return null
                const normalizedWd = workingDirectory.replace(/\\/g, '/')
                const normalizedPath = entry.path.replace(/\\/g, '/')
                const relative = normalizedPath.startsWith(normalizedWd)
                  ? normalizedPath.slice(normalizedWd.length).replace(/^\//, '')
                  : normalizedPath
                const buckets = gitStatusByPath.get(relative)
                if (!buckets) return null
                const staged = buckets.get('staged')
                const unstaged = buckets.get('unstaged')
                const untracked = buckets.get('untracked')
                if (staged === 'deleted' || unstaged === 'deleted') {
                  return (
                    <span
                      className="wd-files-item__change wd-files-item__change--deleted"
                      title="Deleted"
                    >
                      −
                    </span>
                  )
                }
                if (untracked === 'untracked' && !staged && !unstaged) {
                  return (
                    <span
                      className="wd-files-item__change wd-files-item__change--added"
                      title="Untracked"
                    >
                      +
                    </span>
                  )
                }
                if (staged === 'added' && !unstaged) {
                  return (
                    <span
                      className="wd-files-item__change wd-files-item__change--added"
                      title="Added"
                    >
                      +
                    </span>
                  )
                }
                return (
                  <span
                    className="wd-files-item__change wd-files-item__change--modified"
                    title="Modified"
                  >
                    ~
                  </span>
                )
              })()}
            {entry.type === 'file' && entry.size != null && (
              <span className="wd-files-item__meta">
                {formatFileSize(entry.size)}
              </span>
            )}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        sideOffset={6}
        className="arch-tree-tooltip-wrap"
      >
        {isGated && (
          <div id={gateBannerId} className="wd-files-gated-banner">
            <AlertTriangle size={12} aria-hidden="true" className="wd-files-gated-banner__icon" />
            <span>
              Capped at {expandDepth} levels — bump the selector to drill in.
            </span>
          </div>
        )}
        <TreeTooltipContent data={tooltipData} />
      </TooltipContent>
    </Tooltip>
  )
}

function LayoutShell({
  initialView = 'command',
  initialRailTab,
  initialGitStatus,
  onNavigate,
  theme: themeProp,
  onThemeChange,
  topBar,
  breadcrumbs,
  onNewChat,
  sessionContext,
  maxOpenDirs,
  children,
  onToggleSidebar,
  sessionListSlot,
  sidebarCollapsed: sidebarCollapsedProp,
}: LayoutShellProps) {
  // Theme wiring.
  //
  // The `theme` / `onThemeChange` props are honoured when supplied, but nothing
  // in the app actually passes them — AppShell renders <LayoutShell> without
  // either. Combined with the old `theme = 'system'` default, that meant the
  // header toggle permanently displayed "System" as active and every click was
  // a no-op through `onThemeChange?.()`: the control was decorative.
  //
  // Falling back to ThemeContext makes it real. `useOptionalTheme` (rather than
  // `useTheme`) because the snapshot tests mount this component with no
  // providers, where the throwing hook would fail the render outright.
  const themeCtx = useOptionalTheme()
  const theme: ThemeMode = themeProp ?? themeCtx?.mode ?? 'system'
  const applyTheme = useCallback(
    (next: ThemeMode) => {
      if (onThemeChange) onThemeChange(next)
      else themeCtx?.setMode(next)
    },
    [onThemeChange, themeCtx],
  )

  const [activeView, setActiveView] = useState<ShellView>(initialView)
  const [sessionsView, setSessionsView] = useState<'list' | 'board'>(getInitialSessionsView)
  const [sidebarCollapsedLocal, setSidebarCollapsed] = useState(false)
  // Controlled when the parent supplies `sidebarCollapsed`; otherwise local.
  const sidebarCollapsed = sidebarCollapsedProp ?? sidebarCollapsedLocal
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('agent-chat')
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<string | null>(null)
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null)
  const [canvasArtifacts, setCanvasArtifacts] = useState<WorkspaceArtifact[]>([])
  const [selectedCanvasArtifactId, setSelectedCanvasArtifactId] = useState<string | null>(null)
  const skipWorkspacePersistRef = useRef(false)
  const [activeRailTab, setActiveRailTab] = useState<RailTab>(initialRailTab ?? 'context')
  const openWorkspaceFileExternal = useCallback((path: string) => {
    // Explicitly bypass the overlay: these surfaces already provide the in-app preview.
    // eslint-disable-next-line craft-links/no-direct-file-open
    void window.electronAPI.openFile(path)
  }, [])
  const [serverStatus, setServerStatus] = useState<{ running: boolean; url?: string } | null>(null)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  useEffect(() => {
    skipWorkspacePersistRef.current = true
    if (!activeSessionId) {
      setCanvasArtifacts([])
      setSelectedCanvasArtifactId(null)
      setSelectedWorkspaceFile(null)
      setPreviewArtifactId(null)
      setActiveWorkspaceTab('agent-chat')
      return
    }
    try {
      const saved = JSON.parse(readWorkspaceStateRaw(`archstudio:workspace:${activeSessionId}`) || '{}') as { artifacts?: WorkspaceArtifact[]; selectedFile?: string; activeTab?: WorkspaceTab }
      const artifacts = Array.isArray(saved.artifacts) ? saved.artifacts : []
      setCanvasArtifacts(artifacts)
      setSelectedCanvasArtifactId(artifacts[0]?.id ?? null)
      setSelectedWorkspaceFile(saved.selectedFile ?? null)
      setPreviewArtifactId(null)
      setActiveWorkspaceTab(saved.activeTab ?? 'agent-chat')
    } catch {
      setCanvasArtifacts([])
      setSelectedCanvasArtifactId(null)
      setSelectedWorkspaceFile(null)
      setPreviewArtifactId(null)
      setActiveWorkspaceTab('agent-chat')
    }
  }, [activeSessionId])

  useEffect(() => {
    if (!activeSessionId) return
    if (skipWorkspacePersistRef.current) {
      skipWorkspacePersistRef.current = false
      return
    }
    writeWorkspaceStateRaw(`archstudio:workspace:${activeSessionId}`, JSON.stringify({ artifacts: canvasArtifacts, selectedFile: selectedWorkspaceFile, activeTab: activeWorkspaceTab }))
  }, [activeSessionId, activeWorkspaceTab, canvasArtifacts, selectedWorkspaceFile])

  const sessionAtom = useMemo(
    () => activeSessionId ? sessionAtomFamily(activeSessionId) : nullSessionAtom,
    [activeSessionId],
  )
  const activeSession = useAtomValue(sessionAtom)

  const attachedFiles = useMemo(() => {
    if (!activeSession?.messages) return []
    const seen = new Set<string>()
    const files: Array<{ att: StoredAttachment; messageId: string }> = []
    for (const msg of activeSession.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          const key = att.storedPath || att.id
          if (!seen.has(key)) {
            seen.add(key)
            files.push({ att, messageId: msg.id })
          }
        }
      }
    }
    return files
  }, [activeSession])

  const handleRemoveAttachment = useCallback((messageId: string, attachmentId: string) => {
    if (typeof window !== 'undefined' && window.electronAPI?.sessionCommand && activeSessionId) {
      window.electronAPI.sessionCommand(activeSessionId, { type: 'removeAttachment', messageId, attachmentId })
    }
  }, [activeSessionId])

  const handleClearAttachments = useCallback(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.sessionCommand && activeSessionId) {
      const count = attachedFiles.length
      const id = toast.warning(
        `Remove all ${count} file${count !== 1 ? 's' : ''} from this session?`,
        {
          description: 'This action cannot be undone. Attached files will be detached from the session.',
          duration: 10_000,
          action: {
            label: 'Clear all',
            onClick: () => {
              toast.dismiss(id)
              window.electronAPI.sessionCommand(activeSessionId, { type: 'clearAttachments' })
              toast.success(`Removed ${count} file${count !== 1 ? 's' : ''}`)
            },
          },
          cancel: {
            label: 'Cancel',
            onClick: () => toast.dismiss(id),
          },
        },
      )
    }
  }, [activeSessionId, attachedFiles.length])

  const openFileLocation = useCallback((path: string) => {
    if (typeof window !== 'undefined' && window.electronAPI?.showInFolder) {
      window.electronAPI.showInFolder(path)
    }
  }, [])

  const workingDirectory = sessionContext?.workingDirectory

  // ── Working-directory tree view ────────────────────────────────
  //
  // Inline expandable tree: clicking a directory toggles its children
  // indented below. Child directories can themselves be expanded.
  // ─────────────────────────────────────────────────────────────────

  /** Flat node combining an entry with its tree depth. */
  interface TreeEntry {
    entry: WdEntry
    depth: number
  }

  // Cache of directory listings keyed by dir path — survives directory
  // collapse/expand so re-expanding doesn't re-fetch.
  const [wdChildren, setWdChildren] = useState<Record<string, WdEntry[]>>({})
  const wdChildrenRef = useRef<Record<string, WdEntry[]>>({})

  // Which directories are currently expanded (their children are visible).
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  // Synchronous mirror of `expandedPaths`.  Mirrors the `wdChildrenRef`
  // pattern: written BEFORE (or as the first statement of) every
  // `setExpandedPaths` call, so reads of the ref always see the same
  // value React will commit.  Used by `toggleExpand` to gate the
  // forward-expand check before issuing the IPC fetch — closing the
  // "wasted IPC on gated+uncached click" race.
  const expandedPathsRef = useRef<Set<string>>(new Set())

  // Pinned directories — exempt from count-cap eviction. User-toggled
  // via Cmd/Ctrl+click on a directory row (see `togglePin`). The pin
  // set is independent of `expandedPaths` so a user can pin a dir
  // before expanding it (the pin will protect it from any future trim).
  // Cleared on workingDirectory change and Collapse-all, same lifecycle
  // as `expandedPaths`.
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(new Set())
  // Synchronous mirror matching the `expandedPathsRef` pattern.
  const pinnedPathsRef = useRef<Set<string>>(new Set())

  // Root of the tree — set when the working directory changes.
  const [wdRootPath, setWdRootPath] = useState<string | null>(null)
  const [wdLoading, setWdLoading] = useState(false)
  const [wdError, setWdError] = useState<string | null>(null)
  const wdAbortRef = useRef(false)
  // Combined loading flag for the file-watch bulk re-fetch path.  Lives
  // alongside wdLoading so the two loading concepts are colocated, but
  // is INDEPENDENT of it — wdLoading drives the initial render and any
  // single-folder expand click, while wdRefreshLoading wraps the
  // Promise.all that re-reads N expanded directories in parallel.  The
  // combined flag fires once around the bulk call (and only around it)
  // so 20 expanded dirs show one spinner instead of 20 flickers.
  const [wdRefreshLoading, setWdRefreshLoading] = useState(false)

  // Helper: trigger pulse animation on a tree row, then run the action.
  // Used by both directory (open in Finder) and file (open in editor) double-clicks.
  // Debounced: clicking the same path within 2 seconds skips the visual pulse
  // (it would overlap with the previous one fading out) but still runs the action.
  const lastPulsedRef = useRef<{ path: string; at: number } | null>(null)
  const PULSE_DEBOUNCE_MS = 2_000
  // Teardown timer for the --pulse class. MUST stay in sync with the
  // `@keyframes wd-dir-icon-pulse` animation-duration in LayoutShell.css
  // (280ms). The +40ms buffer is a margin of safety for React's commit +
  // repaint cycle after the keyframe settles at `scale(1)` — without it,
  // a re-render dropped right at the moment the animation finished could
  // remove the class before the browser actually painted the final
  // `scale(1)` frame, leaving a momentarily-scaled frozen icon.
  const PULSE_TEARDOWN_MS = 320
  const pulseThen = useCallback((path: string, fn: () => void) => {
    const now = Date.now()
    const prev = lastPulsedRef.current
    const isDuplicate = prev?.path === path && now - prev.at < PULSE_DEBOUNCE_MS
    if (!isDuplicate) {
      setPulsingPath(path)
      if (pulsingTimerRef.current) clearTimeout(pulsingTimerRef.current)
      pulsingTimerRef.current = setTimeout(() => setPulsingPath(null), PULSE_TEARDOWN_MS)
      lastPulsedRef.current = { path, at: now }
    }
    fn()
  }, [])

  // Tracks which individual directories are currently being fetched
  // so the tree view can show a spinner next to their name.
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  // Tracks which directories failed to fetch (permissions, missing folder,
  // etc.).  A ⚠ indicator is rendered next to the folder icon for these entries
  // so the user sees that the empty listing is an error, not an empty directory.
  const [erroredDirs, setErroredDirs] = useState<Set<string>>(new Set())

  // True when the most recent runDepthBFS reached MAX_EXPAND_DIRS and
  // stopped.  Surfaced inline next to the depth selector as a destructive
  // chip so the user knows their expand was partially honoured —
  // without it, the user might assume "depth=4" worked when it actually
  // got cut short at 100 dirs.  Cleared on Collapse all, workingDirectory
  // change, and the workingDirectory mount cleanup so the warning
  // doesn't persist into a new session.
  const [expansionCapped, setExpansionCapped] = useState(false)

  // True when the cumulative count of open dirs exceeded the cap and
  // the leaf-trim fired.  Surfaced as a companion chip next to the depth
  // selector so the user knows entries were silently collapsed.  Cleared
  // on Collapse all, workingDirectory change, and the workingDirectory
  // mount cleanup — same lifecycle as expansionCapped.
  const [openCountCapped, setOpenCountCapped] = useState(false)

  // Resolve the open-dir cap from the (optional) prop. `DEFAULT_MAX_OPEN_DIRS`
  // is the documented fallback so callers (playground, tests, missing
  // settings) get deterministic behaviour without explicitly passing it.
  const openDirCap = maxOpenDirs ?? DEFAULT_MAX_OPEN_DIRS

  // Toggle pin state for a directory. Pinned dirs are exempt from the
  // count-cap eviction in `trimExpandedByCount`.  Mirrors the
  // `expandedPathsRef` write-then-setState pattern so any synchronous
  // reader (e.g. a click handler that fires immediately after the toggle)
  // sees the latest committed value.
  const togglePin = useCallback((dirPath: string) => {
    setPinnedPaths(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      pinnedPathsRef.current = next
      return next
    })
  }, [])

  // Brief pulse animation on the row when a directory is double-clicked
  // to open in Finder — gives visual feedback before the OS switch.
  const [pulsingPath, setPulsingPath] = useState<string | null>(null)
  const pulsingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Brief flash animation on single-click expand/collapse — gives feedback
  // that the folder state changed. Uses a different color (brand-purple)
  // from the double-click pulse (brand-lime) to distinguish the two.
  const [flashingPath, setFlashingPath] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFlashedRef = useRef<{ path: string; at: number } | null>(null)
  const FLASH_DEBOUNCE_MS = 2_000

  /** Trigger the expand/collapse flash, debounced per path. */
  const flashExpand = useCallback((path: string) => {
    const now = Date.now()
    const prev = lastFlashedRef.current
    const isDuplicate = prev?.path === path && now - prev.at < FLASH_DEBOUNCE_MS
    if (!isDuplicate) {
      setFlashingPath(path)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      flashTimerRef.current = setTimeout(() => setFlashingPath(null), 300)
      lastFlashedRef.current = { path, at: now }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (pulsingTimerRef.current) clearTimeout(pulsingTimerRef.current)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const updateChildren = useCallback((dirPath: string, entries: WdEntry[]) => {
    // Synchronous ref update FIRST, then setState.  Earlier this lived
    // inside the setState updater function, but updater functions only
    // execute during React's render flush — meaning a read of
    // wdChildrenRef.current[path] immediately after this call (e.g. the
    // post-await enqueue walk inside runDepthBFS) would see stale data
    // until React processed the next batch.  Microsecond-scale, but
    // real — and the race the code-reviewer-minimax-m3 caught between
    // runDepthBFS and the file-watch bulk refresh lived in that gap.
    //
    // Compute `next` once and reuse for both writes — the ref and the
    // React state commit the same object reference, so React skips its
    // own spread and any spurious reconciliation.  Reads during the
    // microtask gap now see fresh data; React still processes the
    // state update correctly the moment it gets to the render flush.
    const next = { ...wdChildrenRef.current, [dirPath]: entries }
    wdChildrenRef.current = next
    setWdChildren(() => next)
  }, [])

  const fetchDirectory = useCallback(async (dirPath: string) => {
    if (typeof window === 'undefined' || !window.electronAPI?.listDirectoryFiles) return
    wdAbortRef.current = false
    setWdLoading(true)
    setWdError(null)
    setLoadingDirs(prev => new Set(prev).add(dirPath))
    // Per-path generation bump — a concurrent fetch­DirectorySilent (file-watch
    // bulk) or another fetchDirectory on the SAME path increments past us,
    // dropping our response at the await-resolve.
    const generation = (dirGenerationsRef.current.get(dirPath) ?? 0) + 1
    dirGenerationsRef.current.set(dirPath, generation)
    try {
      const result = await window.electronAPI.listDirectoryFiles(dirPath)
      // Stale-response guard — only the latest in-flight call for this path
      // may write to state.  Falls through only if generation matches.
      if (dirGenerationsRef.current.get(dirPath) !== generation) return
      if (!wdAbortRef.current) {
        setErroredDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next })
        updateChildren(dirPath, result.entries)
      }
    } catch (err) {
      // Stale error paths too — don't overwrite fresher state from a
      // newer call that already started.
      if (dirGenerationsRef.current.get(dirPath) !== generation) return
      if (!wdAbortRef.current) {
        setWdError(err instanceof Error ? err.message : 'Failed to read directory')
        setErroredDirs(prev => new Set(prev).add(dirPath))
        updateChildren(dirPath, [])
      }
    } finally {
      if (!wdAbortRef.current) {
        setWdLoading(false)
      }
      setLoadingDirs(prev => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }, [updateChildren])

  // ── Silent variant for the file-watch bulk re-fetch ───────────────
  //
  // Same IPC + per-dir error-tracking as fetchDirectory, but skips the
  // global wdLoading toggle (set on/off per call would clobber) and the
  // loadingDirs set updates (which would flicker 20 per-folder spinners
  // in lockstep with the bulk Promise.all).  The bulk refresh owns its
  // own wdRefreshLoading state for the duration of the Promise.all.
  //
  // Still respects wdAbortRef.current on resolve so workingDirectory
  // changes / component unmount that flip the abort mid-bulk-suppress
  // any later setState.  Per-dir errors still land in erroredDirs so the
  // ⚠ indicator still appears on individual failed paths.
  // ───────────────────────────────────────────────────────────────────
  const fetchDirectorySilent = useCallback(async (dirPath: string) => {
    if (typeof window === 'undefined' || !window.electronAPI?.listDirectoryFiles) return
    // Same per-path generation bump as fetchDirectory — both callers write
    // the same dirPath slot, so they contend for the same generation map entry.
    const generation = (dirGenerationsRef.current.get(dirPath) ?? 0) + 1
    dirGenerationsRef.current.set(dirPath, generation)
    try {
      const result = await window.electronAPI.listDirectoryFiles(dirPath)
      // Stale-response guard — fetchDirectory (user click) on the same path
      // mid-bulk would have incremented generation past us; dropping here
      // means the click's fresher response wins the wdChildren write.
      if (dirGenerationsRef.current.get(dirPath) !== generation) return
      if (!wdAbortRef.current) {
        setErroredDirs(prev => { const next = new Set(prev); next.delete(dirPath); return next })
        updateChildren(dirPath, result.entries)
      }
    } catch {
      if (dirGenerationsRef.current.get(dirPath) !== generation) return
      if (!wdAbortRef.current) {
        setErroredDirs(prev => new Set(prev).add(dirPath))
        updateChildren(dirPath, [])
      }
    }
  }, [updateChildren])

  // ── Depth-selector popover options ────────────────────────────────
// Each option maps to handleDepthPick.  `shortcut` is rendered as a
// <kbd> hint inside the menu item AND bound to a document keydown
// listener so pressing the key anywhere in the tree picks the depth.
// Structured as a const array rather than an inline .map() so the
// labels can carry affordance text ("N levels deep") the old tight
// number-only row couldn't fit.
const DEPTH_POPOVER_OPTIONS = [
  { value: 1, label: '1 level deep', shortcut: '1' },
  { value: 2, label: '2 levels deep', shortcut: '2' },
  { value: 3, label: '3 levels deep', shortcut: '3' },
  { value: 4, label: '4 levels deep', shortcut: '4' },
  { value: Infinity, label: 'All levels', shortcut: 'A' },
] as const

// ── Expand all / Collapse all ─────────────────────────────────────

  // User-selectable max depth for "Expand all". Infinity = no limit ("All").
  const [expandDepth, setExpandDepth] = useState<number>(2)

  // Depth-selector popover state.  Open/close is driven by a toggle
  // button + click-outside + Escape key, not by hover (unlike tooltips).
  const [depthPopoverOpen, setDepthPopoverOpen] = useState(false)
  const depthPopoverRef = useRef<HTMLDivElement>(null)
  const expandAllAbortRef = useRef(false)

  // Drill mode.  When the user clicks a gated row's chevron, instead of
  // a silent no-op we temporarily bump `expandDepth` so the row can
  // expand.  `drillBaselineDepth` remembers the user's chosen cap so
  // Collapse-all can restore it.  Auto-clears on Collapse-all, manual
  // depth-pick, and session switch — see the three reset hooks below.
  const [drillBaselineDepth, setDrillBaselineDepth] = useState<number | null>(null)

  // Generation counter for runDepthBFS.  Pairs with the existing
  // dirGenerationsRef (per-path) and gitGenerationRef (sequence) — this
  // is a sequence counter for the depth-bumping BFS specifically, because
  // one user gesture (clicking a depth button, then another) can fire
  // two concurrent BFSes whose IPC awaits land in either order.  Without
  // a generation gate, the older BFS can commit its
  // `setExpandedPaths(discoverSet)` AFTER a newer one, overwriting fresh
  // state with stale-but-correct data.  The gate ensures only the
  // latest-in-flight BFS writes the final expanded-path set.
  //
  // mid-loop `setWdChildren` writes are mediated separately by
  // dirGenerationsRef (per-path, per-call), which is orthogonal — the
  // two layers compose.
  const depthBfsGenerationRef = useRef(0)

  // Generic depth-aware expand.  Walks BFS up to `targetDepth`, fetching
  // any directory whose children aren't yet cached.  `baseExpanded`
  // seeds the discovered set so callers can preserve the existing
  // expansion while adding new levels (the depth-bump case).  Callers
  // that want a fresh expansion pass `new Set()`.
  //
  // The result is committed via `setExpandedPaths` only if the
  // generation is still the latest, so concurrent BFSes never stomp
  // each other.
  const runDepthBFS = useCallback(async (targetDepth: number, baseExpanded: Set<string>) => {
    if (!wdRootPath || typeof window === 'undefined' || !window.electronAPI?.listDirectoryFiles) return
    expandAllAbortRef.current = false
    wdAbortRef.current = false
    setWdLoading(true)

    const myGeneration = ++depthBfsGenerationRef.current

    // Prime with the existing expanded set so the BFS appends, not
    // replaces.  The depth-bump flow already passed this in; the
    // fresh-expand flow passes an empty Set so the result is identical
    // to the prior handleExpandAll semantics.
    const discoverSet = new Set<string>(baseExpanded)
    const queue: Array<{ path: string; depth: number }> = [{ path: wdRootPath, depth: 0 }]

    // Cap-tracking: flipped to true the moment the next-to-add directory
    // would push discoverSet past MAX_EXPAND_DIRS.  The flag is set,
    // the inner for-loop breaks, and the outer while breaks via the
    // post-loop check — no more IPC traffic, no more setWdChildren
    // writes, just a partial-expansion commit.  Capped => renders a
    // destructive chip in the section header so the user knows.
    let capped = false

    while (queue.length > 0 && depthBfsGenerationRef.current === myGeneration) {
      const { path, depth } = queue.shift()!

      // Per-dir dontEnqueue flag — true only when our fetch errored and
      // we're still the latest call for this path (so we wrote [] for
      // the broken-dir indicator).  In every other case (success, cached,
      // superseded by fresher fetch) we proceed to walk children so the
      // BFS can still expand past this dir — wdChildrenRef.current[path]
      // reflects the LATEST committed data either way.
      let dontEnqueue = false

      // Fetch if not yet cached — already-fetched directories are
      // walked to find their children (needed for the bump case) but
      // skip the IPC roundtrip.
      if (!wdChildrenRef.current[path]) {
        // ════════════════════════════════════════════════════════════
        // Per-path generation gate — mirrors fetchDirectory /
        // fetchDirectorySilent so an in-flight BFS IPC and a concurrent
        // file-watch bulk refresh or user-click fetch on the SAME dir
        // don't clobber each other on setWdChildren writes.  The
        // depth-level ref (depthBfsGenerationRef) governs only the
        // final setExpandedPaths commit; per-path gates govern
        // intermediate writes.  Two layers, two concerns — orthogonal
        // race surfaces.
        // ════════════════════════════════════════════════════════════
        const dirGeneration = (dirGenerationsRef.current.get(path) ?? 0) + 1
        dirGenerationsRef.current.set(path, dirGeneration)
        setLoadingDirs(prev => new Set(prev).add(path))
        try {
          const result = await window.electronAPI.listDirectoryFiles(path)
          if (depthBfsGenerationRef.current !== myGeneration) break
          if (dirGenerationsRef.current.get(path) === dirGeneration) {
            setErroredDirs(prev => { const next = new Set(prev); next.delete(path); return next })
            updateChildren(path, result.entries)
          }
          // else: a fresher fetch on this path superseded us.  Skip
          // the write — wdChildrenRef.current[path] still reflects the
          // LATEST committed data (the superseder's, or the prior
          // cache if the superseder hasn't flushed yet), and the
          // enqueue walk below uses it.
        } catch {
          if (depthBfsGenerationRef.current !== myGeneration) break
          if (dirGenerationsRef.current.get(path) === dirGeneration) {
            // We errored AND we're the latest — write empty so the
            // erroredDirs indicator surfaces; don't enqueue children
            // because expanding a broken directory makes no sense.
            setErroredDirs(prev => new Set(prev).add(path))
            updateChildren(path, [])
            dontEnqueue = true
          }
          // else: a fresher fetch errored on this path before us (or
          // is still in flight).  Don't write empty — let the
          // superseder handle it.  wdChildrenRef state reflects
          // whichever path won, used for enqueue below.
        } finally {
          setLoadingDirs(prev => {
            const next = new Set(prev)
            next.delete(path)
            return next
          })
        }
      }

      if (dontEnqueue) continue
      if (depth >= targetDepth) continue

      // Enqueue child directories and add to discover set
      const entries = wdChildrenRef.current[path] ?? []
      for (const entry of entries) {
        if (entry.type === 'directory') {
          discoverSet.add(entry.path)
          queue.push({ path: entry.path, depth: depth + 1 })
          // Cap guard: caught at the directory boundary so the BFS
          // strips precisely at MAX_EXPAND_DIRS (a depth=4 expand on a
          // tree with 200+ dirs at depth 1+2 stops at 100; a depth=2
          // expand on a flat 150-dir directory also stops at 100).
          // The user gets a partial expansion plus an inline warning
          // — much friendlier than freezing the renderer with N×N IPC
          // fanout.
          if (discoverSet.size >= MAX_EXPAND_DIRS) {
            capped = true
            break
          }
        }
      }
      if (capped) break
    }

    // Stale-guard the final commit.  If a newer BFS has bumped the
    // generation mid-loop, this older BFS skips its write — the newer
    // one will commit on its own.
    if (depthBfsGenerationRef.current === myGeneration) {
      expandedPathsRef.current = discoverSet
      setExpandedPaths(discoverSet)
      setExpansionCapped(capped)
    }
    setWdLoading(false)
  }, [wdRootPath, updateChildren])

  const handleExpandAll = useCallback(async () => {
    // Fresh expand — pass an empty Set so the result replaces whatever
    // was previously expanded.  Mirrors the prior handleExpandAll
    // semantics byte-for-byte.
    await runDepthBFS(expandDepth, new Set())
  }, [runDepthBFS, expandDepth])

  // Depth-pick: re-run BFS preserving existing expanded paths, fetching
  // only the new levels.  Idempotent — clicking the same depth twice
  // doesn't fire a second BFS (the cache-hit-skipping would render it
  // a no-op anyway, but skipping is cheaper).
  //
  // GROWING (newDepth > expandDepth): preserve the existing expansion
  // and union in newly-discovered deeper dirs.  Cache hits already
  // populated by previous fetches skip IPC, so the BFS walks only the
  // levels that haven't been fetched yet.  This is what the user asked
  // for ("bump the depth from 2→4 without collapsing first").
  //
  // SHRINKING (newDepth < expandDepth): users expect the click to mean
  // "depth is now N — show only that."  Anything previously expanded
  // beyond the new depth (whether auto-discovered or manually toggled)
  // collapses.  This is a synchronous state derivation over the cached
  // tree — no IPC, no BFS, no generation guard (no async writes to
  // race against).
  const handleDepthPick = useCallback((newDepth: number) => {
    if (newDepth === expandDepth) return
    // Manual depth-pick is an explicit user choice — clear any active
    // drill so the user's pick establishes a fresh permanent baseline.
    // Per the drill-mode UX: clicking the depth selector means "I want
    // THIS as my cap", which supersedes the temporary bump.
    setDrillBaselineDepth(null)
    // Invalidate any in-flight BFS BEFORE branching, so a stale async
    // runDepthBFS from a prior click cannot commit its setExpandedPaths
    // after our (sync OR async) write here.  Without this bump, the
    // SHRINK case would race with a stale GROW: SHRINK commits
    // synchronously, then the stale BFS's final commit (still under
    // its old generation) overwrites the trimmed set, making the
    // user's "press 2 after pressing 4" click invisible.  Same pattern
    // as handleCollapseAll — but placed BELOW the no-op guard so a
    // no-op click on the user's current depth doesn't kill a
    // same-target BFS that's still walking the tree.
    depthBfsGenerationRef.current++
    setExpandDepth(newDepth)
    if (newDepth > expandDepth) {
      // Grow: BFS union with existing expansion.
      runDepthBFS(newDepth, new Set(expandedPaths))
      return
    }
    // Shrink: derive the target set from the cached tree synchronously.
    // Depth is measured as edges from wdRootPath; a directory at depth
    // d (1 <= d <= newDepth) from the root is "within the cap."
    // The result naturally includes ONLY dirs reachable at the new
    // depth — anything deeper is dropped, including any deeper manual
    // expansions the user had.  This matches the common file-tree UX
    // where "depth=N" means "show N levels, period."
    // The shrink walk is rooted at wdRootPath, so there is nothing to derive
    // before the root listing has resolved.
    if (!wdRootPath) return
    const targetSet = new Set<string>()
    const queue: Array<{ path: string; depth: number }> = [{ path: wdRootPath, depth: 0 }]
    while (queue.length > 0) {
      const { path, depth } = queue.shift()!
      const entries = wdChildrenRef.current[path] ?? []
      for (const e of entries) {
        if (e.type !== 'directory') continue
        const childDepth = depth + 1
        // Only keep directories whose depth is strictly less than the
        // cap — directories AT the cap are visible as children but
        // must not be expanded (they become gated).
        if (childDepth >= newDepth) continue
        targetSet.add(e.path)
        queue.push({ path: e.path, depth: childDepth })
      }
    }
    expandedPathsRef.current = targetSet
    setExpandedPaths(targetSet)
    // Clear any prior cap warning — SHRINK derives the target set
    // synchronously from wdChildrenRef.current and fires zero IPCs, so
    // any prior "capped at N" warning (from a previous GROW) no longer
    // describes the most recent action.  Without this, the chip would
    // linger after a SHRINK and read as if the SHRINK itself had been
    // capped — confusing UX.
    setExpansionCapped(false)
  }, [runDepthBFS, expandDepth, expandedPaths, wdRootPath])

  // Enforce the depth cap as a state invariant, not only inside the selector
  // click handler. Expansion writes can be queued by drill/collapse gestures
  // in the same React scheduling window as a manual shrink; whichever write
  // lands last must still respect the newly selected cap. Without this guard,
  // a directory at depth === cap can remain in `expandedPaths`, so it renders
  // expanded and bypasses `gate-forward` even though the selector shows the
  // smaller depth. Growing the cap is unaffected, and Infinity remains the
  // explicit unrestricted mode.
  useEffect(() => {
    if (!wdRootPath || !Number.isFinite(expandDepth)) return

    let violatesCap = false
    const next = new Set<string>()
    for (const path of expandedPaths) {
      if (computeDepthFromRoot(wdRootPath, path) >= expandDepth) {
        violatesCap = true
      } else {
        next.add(path)
      }
    }
    if (!violatesCap) return

    expandedPathsRef.current = next
    setExpandedPaths(next)
  }, [expandDepth, expandedPaths, wdRootPath])

  // Stable ref for handleDepthPick so the global keydown listener
  // (installed once, never re-registered) always dispatches to the
  // latest callback without depending on it in the effect's dep list.
  // Initialized AFTER handleDepthPick is defined (TDZ-safe).
  const handleDepthPickRef = useRef(handleDepthPick)
  handleDepthPickRef.current = handleDepthPick

  const handleCollapseAll = useCallback(() => {
    // Bump the BFS generation so any in-flight depthBFS loop stops at its
    // next iteration check and skips the final setExpandedPaths commit.
    // Same goal as the existing expandAllAbortRef flip, but generation-
    // gated (works with the depth-bump flow that doesn't share a single
    // abort ref).
    depthBfsGenerationRef.current++
    expandAllAbortRef.current = true
    const fresh = new Set<string>()
    expandedPathsRef.current = fresh
    setExpandedPaths(fresh)
    // Clear the cap warning — Collapse-all is an explicit reset.
    setExpansionCapped(false)
    setOpenCountCapped(false)
    // Clear pinned dirs alongside the collapse — pinning is a session-
    // scoped bookmark, not a persistent preference, and Collapse-all is
    // the user's explicit "reset the tree" gesture. Keeping the pin set
    // would silently re-protect nothing (no expanded paths = nothing to
    // protect) but would leave dead entries that visually clutter the
    // rows of any future re-expansion.
    const emptyPins = new Set<string>()
    pinnedPathsRef.current = emptyPins
    setPinnedPaths(emptyPins)
    // Restore the user's pre-drill cap so the depth selector reflects
    // what they originally chose (not the temporary bump).  This is
    // the auto-revert hook the "bump depth to drill" UX relies on.
    if (drillBaselineDepth !== null) {
      setExpandDepth(drillBaselineDepth)
      setDrillBaselineDepth(null)
    }
  }, [drillBaselineDepth])

  // ── Depth-popover keyboard shortcuts + click-outside ───────────
  // 1/2/3/4/A anywhere in the shell picks the corresponding depth
  // (keyboard-first — no click required).  Escape closes the popover
  // if it's open.  Click-outside closes the popover.  The listener
  // is installed once (empty dep array) and reads handleDepthPick
  // via a stable ref so directory expansion doesn't re-register it.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't intercept when the user is typing in an input/textarea.
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      if (e.key === 'Escape' && depthPopoverRef.current) {
        setDepthPopoverOpen(false)
        return
      }
      const key = e.key.toLowerCase()
      for (const opt of DEPTH_POPOVER_OPTIONS) {
        if (key === opt.shortcut.toLowerCase()) {
          e.preventDefault()
          handleDepthPickRef.current(opt.value)
          setDepthPopoverOpen(false)
          return
        }
      }
    }
    const handleOutside = (e: MouseEvent) => {
      if (depthPopoverRef.current && !depthPopoverRef.current.contains(e.target as Node)) {
        setDepthPopoverOpen(false)
      }
    }
    // Only attach mousedown when popover is open (avoids unnecessary
    // global listeners).  keydown is always attached — keyboard-first
    // means the user never needs to click the trigger at all.
    const mousedownCleanup = () => {
      document.removeEventListener('mousedown', handleOutside)
    }
    document.addEventListener('keydown', handleKey)
    if (depthPopoverOpen) {
      document.addEventListener('mousedown', handleOutside)
      return () => {
        document.removeEventListener('keydown', handleKey)
        mousedownCleanup()
      }
    }
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
    // depthPopoverOpen is NOT a dep — keyboard shortcuts are global,
    // and the mousedown listener is managed imperatively via the
    // conditional inside the effect body (React cleans up the previous
    // effect's listeners on re-run).  handleDepthPick is read via ref.
  }, [depthPopoverOpen])

  // Whether any directory is currently expanded (drives Expand All vs Collapse All button)
  const hasExpandedDirs = expandedPaths.size > 0

  // Fetch + expand a directory. Called when the user clicks a folder.
  //
  // Depth-cap gate.  When the user has picked an `expandDepth` via the
  // selector, every manual click on a directory must honor that cap —
  // otherwise the selector's "depth=N means N levels" contract is a
  // half-truth (it would only govern "Expand All", while manual clicks
  // would silently inflate past the chosen depth).  The SHRINK branch
  // of `handleDepthPick` already established the depth-counting model
  // (edges from `wdRootPath`); this hook mirrors the spec parity.
  //
  // Decision flow (consulted INSIDE the setState callback so the
  // committed `prev` is the single source of truth):
  //   - Click on a currently-expanded dir => collapse.  Always allowed;
  //     users must be able to back out of an accidental expansion,
  //     including ones past the current cap.
  //   - Click on a not-yet-expanded dir => forward-expand.  Consult the
  //     cap: if the dir is already at-or-beyond `expandDepth`, gate
  //     silently (no IPC, no state change).  Otherwise proceed.
  //   - The "All" option (`Infinity`) is the explicit escape hatch and
  //     is never gated.
  //
  // The chip + `aria-live` warning in the section header surfaces
  // runaway IPC fanout paths (from the bulk BFS).  Manual-click gating
  // here is a parallel safety net for the "single drill-in" gesture
  // that wouldn't otherwise trip the cap chip.  Both gate the same
  // contract: depth==N means depth==N, period.
  //
  // Callback identity note.  Because the decision runs against the
  // `expandDepth` captured in the closure, this callback identity is
  // unstable across depth-selector changes.  Consumers should either
  // not memoize against it, or accept the re-creation.  Today no
  // consumer is memoized against `toggleExpand`, but a future caller
  // that wraps it in a `useMemo`/`React.memo` should re-check.
  // Compute whether a row would be gated by `shouldGateManualExpand` for
  // the chevron `data-gated` affordance.  Computed inline per row in
  // the visible-tree render (see the JSX block below).
  //
  // Note: the helper returns `allow-collapse` for any currently-
  // expanded dir, never `gate-forward`.  So the inline check fires
  // ONLY for not-yet-expanded dir rows whose forward-expansion would
  // be a no-op.  Already-expanded rows always allow collapse, so
  // marking them "gated" would be misleading.  This is the correct
  // set to mark — clicking a gated row would silently do nothing,
  // which is what `data-gated="true"` signals to a future CSS hover
  // hint or test selector.

  const toggleExpand = useCallback((dirPath: string) => {
    if (!wdRootPath) return
    // Gate BEFORE the fetch.  Reading the synchronous `expandedPathsRef`
    // (rather than a closure-captured `expandedPaths` setState-callback
    // `prev`) eliminates the wasted-IPC race: a click on a gated,
    // uncached row no longer issues an IPC round-trip only to be
    // discarded by the gate inside the setState cb.
    //
    // The ref read is bounded-staleness (same as a closure read would
    // be): if another handler mutates state between this read and the
    // setState cb below, the worst case is a single idempotent
    // Set-operation drift on `dirPath` — no infinite loops, no data
    // corruption.
    const decision = shouldGateManualExpand(
      wdRootPath,
      dirPath,
      expandDepth,
      expandedPathsRef.current.has(dirPath),
    )
    if (decision.kind === 'gate-forward') {
      // Bump-depth-to-drill.  Instead of a silent no-op, temporarily
      // raise the cap just enough to expand THIS row, then fall through
      // to the normal fetch + expand path.  `Math.max` handles the
      // case where the user drilled into a deep subtree via search/etc.
      // and the row is far beyond `expandDepth + 1`.
      //
      // `drillBaselineDepth` is captured once per drill session so
      // subsequent gated clicks in the same subtree don't keep raising
      // the baseline — only the active bump increments.
      if (drillBaselineDepth === null) {
        setDrillBaselineDepth(expandDepth)
      }
      setExpandDepth(Math.max(expandDepth, decision.currentDepth + 1))
      // Fall through: fetch + expand the row.  The setState cb below
      // commits the addition; the just-bumped expandDepth means the
      // gate is now `allow` for this row.
    }
    if (!wdChildrenRef.current[dirPath]) {
      fetchDirectory(dirPath)
    }
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      // Mirror the new Set into the ref before returning so any
      // subsequent click reads the latest committed state.  Matches the
      // wdChildrenRef pattern (ref written before/in-setState, then
      // setState commits).
      expandedPathsRef.current = next
      return next
    })
  }, [fetchDirectory, wdRootPath, expandDepth])

  // ── Cumulative open-directory cap ─────────────────────────────────────
  //
  // Fires after every expansion (manual click, file-watch, BFS, drill)
  // pushes the total open-directory count past `openDirCap`.  Leaf-most
  // entries (highest depth from root) are silently collapsed until we're
  // back under the limit.  This is orthogonal to the depth gate:
  //
  //   - depth=N controls *how deep* each branch can go
  //   - count=K controls *how many* branches can stay open at once
  //
  // Both compose into a single guardrail: the tree can't grow past
  // `openDirCap` open dirs regardless of which combination of
  // gestures / automation put it there.  `openDirCap` is in the dep
  // list so changes to the user setting re-trigger the trim (e.g. a
  // user with 100 dirs open who bumps the cap down to 50 gets an
  // immediate trim; bumping up is a passive no-op until new dirs are
  // expanded).
  useEffect(() => {
    if (!wdRootPath) return
    if (expandedPaths.size < openDirCap) {
      // Strict-less-than gate.  Trim itself always lands at exactly
      // `openDirCap` (60→50, 52→50, 110→50, …), and this same
      // useEffect re-runs immediately AFTER the trim commits because
      // its own setOpenCountCapped(true) flips the openCountCapped
      // dep.  An `<=`-based clear would race the trim's setOpenCountCapped(true)
      // call on that re-run, leaving the chip rendered for exactly one
      // tick before toggling back off — a real UX bug exposed by the
      // integration test in LayoutShell.count-cap-bfs.test.tsx.  The
      // strict comparison only clears on a *manually-driven* size drop
      // below the cap, which is when the user-facing "capped"
      // indicator should disappear.
      if (openCountCapped) setOpenCountCapped(false)
      return
    }

    // Delegate to the shared pure helper — same count-cap contract
    // available to every tree consumer via @archstudio/ui.
    const { keep, dropped } = trimExpandedByCount(expandedPaths, wdRootPath, openDirCap, pinnedPathsRef.current)
    expandedPathsRef.current = keep
    setExpandedPaths(keep)
    setOpenCountCapped(true)
    // Only toast on the first crossing of the threshold, not every
    // subsequent trim — rapid expansions could otherwise produce a
    // cascade of incremental "Collapsed N directories" toasts.
    if (!openCountCapped && dropped.length > 0) {
      toast.info(
        `Collapsed ${dropped.length} director${dropped.length !== 1 ? 'ies' : 'y'} to stay within the ${openDirCap} open-dir limit`,
        { duration: 4_000 },
      )
    }
  }, [expandedPaths.size, wdRootPath, openCountCapped, openDirCap, pinnedPaths])

  // Fetch root directory when session workingDirectory changes
  useEffect(() => {
    if (workingDirectory) {
      setWdRootPath(workingDirectory)
      fetchDirectory(workingDirectory)
    } else {
      setWdRootPath(null)
      setWdChildren({})
      wdChildrenRef.current = {}
      const freshPaths = new Set<string>()
      expandedPathsRef.current = freshPaths
      setExpandedPaths(freshPaths)
      const emptyPins = new Set<string>()
      pinnedPathsRef.current = emptyPins
      setPinnedPaths(emptyPins)
      setLoadingDirs(new Set())
      setErroredDirs(new Set())
    }
    return () => {
      wdAbortRef.current = true
      // Clear per-path generations — new workingDirectory (or unmount)
      // is a clean slate.  Without this, stale entries from prior sessions
      // accumulate in the Map across session switches; bounded in practice
      // by the actual tree size but never explicit until teardown fires.
      dirGenerationsRef.current.clear()
      // Reset the depth-BFS generation counter alongside the per-path
      // ref so a stale BFS from a prior session can be distinguished
      // from a fresh one after the workingDir shifts.  Without this,
      // a stale loop could conceivably commit a setExpandedPaths write
      // after a fresh workingDirectory mount — the set is keyed by the
      // OLD root path the new tree doesn't even contain.
      depthBfsGenerationRef.current = 0
      // Drop any prior "Capped" warning — the previous session's tree
      // size cap doesn't carry into the new working dir, so the
      // indicator would otherwise persist and mislead.
      setExpansionCapped(false)
      setOpenCountCapped(false)
      // Drill mode is per-session/per-tree — clear it on session
      // switch so a new working dir doesn't inherit the previous
      // session's temporary depth bump.
      setDrillBaselineDepth(null)
    }
  }, [workingDirectory, fetchDirectory])

  // ── Git-status Changes rail ──────────────────────────────────────────
  //
  // Reads real git branch + status from the session's working directory
  // using the getGitBranch / getGitStatus IPC channels.
  //
  // NOTE: This section MUST be declared before the file-watch useEffect
  // below because that useEffect's dependency array references fetchGitStatus.
  // React evaluates dependency arrays during render, so fetchGitStatus
  // (a const via useCallback) must be declared first.
  // ──────────────────────────────────────────────────────────────────────

  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(initialGitStatus ?? null)
  const [gitLoading, setGitLoading] = useState(false)
  const gitAbortRef = useRef(false)

  // ════════════════════════════════════════════════════════════════════
  // Generation counter for fetchGitStatus.  Drops a stale IPC response
  // when a newer call (10s poll tick vs 1s file-watch debounce) races
  // against an in-flight one.  Without it, two overlapping fetches can
  // land in either order: if the older IPC roundtrip resolves after the
  // newer one, the UI shows stale data even though the newer call started
  // last.  Pairs with gitAbortRef which handles the orthogonal
  // unmount / workingDirectory-change case ("kill them all").  Pattern
  // mirrors diffGenerationRef used by handleDiffClick further down.
  // ════════════════════════════════════════════════════════════════════
  const gitGenerationRef = useRef(0)

  // ════════════════════════════════════════════════════════════════════
  // Per-path generation counter for the working-directory tree, used by
  // both fetchDirectory and fetchDirectorySilent.  After the file-watch
  // refactor moved the bulk refresh to Promise.allSettled, two sources
  // can race for the same directory: e.g. a (silent) bulk refresh on
  // dir A is mid-await when the user clicks dir A to expand (fetch­
  // Directory).  Without per-path generations, the slower bulk response
  // could land after the click's, overwriting fresh tree state with
  // stale-but-correct data.
  //
  // Keyed per-path so two unrelated paths racing remain independent
  // (each path has its own generation slot).  Only SAME-path races
  // contend — exactly the writes that would otherwise corrupt the tree.
  // Orthogonal to gitGenerationRef (sequence number) and gitAbortRef
  // (kill-them-all on teardown); the three layers compose without
  // fighting.
  // ════════════════════════════════════════════════════════════════════
  const dirGenerationsRef = useRef<Map<string, number>>(new Map())

  const fetchGitStatus = useCallback(async (dirPath: string) => {
    if (typeof window === 'undefined' || !window.electronAPI?.getGitStatus || !window.electronAPI?.getGitBranch) return
    // Bump generation BEFORE awaiting so the second concurrent call's
    // pre-await increment invalidates the first's captured value the
    // moment it returns.  The ++ is intentionally first — anything that
    // mutates shared state has to come before the await boundary.
    const generation = ++gitGenerationRef.current
    gitAbortRef.current = false
    setGitLoading(true)
    try {
      const [branch, statusResult] = await Promise.all([
        window.electronAPI.getGitBranch(dirPath),
        window.electronAPI.getGitStatus(dirPath),
      ])
      // A newer fetchGitStatus call (poll tick or file-watch debounce)
      // started while we were awaiting \u2014 drop our response without
      // touching state.  Falling through would overwrite the newer
      // call's fresher data with ours.
      if (gitGenerationRef.current !== generation) return
      if (!gitAbortRef.current) {
        setGitStatus({
          branch,
          files: statusResult.files.map(f => ({
            path: f.path,
            name: f.path.split(/[/\\]/).pop() || f.path,
            status: f.status,
            // The server DTO calls this `insertions`; the renderer row calls it
            // `additions`. Reading `f.additions` here silently yielded undefined
            // and the `+N` badge never rendered.
            additions: f.insertions,
            deletions: f.deletions,
            bucket: f.bucket,
          })),
        })
      }
    } catch {
      // Stale error paths are equally destructive \u2014 don't blank the UI
      // if a fresher call has already started.
      if (gitGenerationRef.current !== generation) return
      if (!gitAbortRef.current) {
        setGitStatus(null)
      }
    } finally {
      // Only the latest in-flight call may flip loading OFF \u2014 earlier
      // ones were already short-circuited above.  Combined check with
      // gitAbortRef handles:
      //   - "changed workingDirectory mid-flight" \u2192 abort kills all
      //   - "next poll tick preempted older call" \u2192 gen kills older only
      if (gitGenerationRef.current === generation && !gitAbortRef.current) {
        setGitLoading(false)
      }
    }
  }, [])

  // Fetch git status when workingDirectory or activeSessionId changes
  useEffect(() => {
    if (!activeSessionId || !workingDirectory) {
      setGitStatus(null)
      return
    }
    fetchGitStatus(workingDirectory)
    return () => {
      gitAbortRef.current = true
    }
  }, [activeSessionId, workingDirectory, fetchGitStatus])

  // Poll git status every 10s while the Changes rail is visible so file
  // edits show up without the user switching tabs. Recent Changes lives
  // inside the Files tab, so we gate on activeRailTab === 'files'.
  useEffect(() => {
    if (!activeSessionId || !workingDirectory || activeRailTab !== 'files') return
    const intervalId = setInterval(() => {
      fetchGitStatus(workingDirectory)
    }, 10_000)
    return () => {
      clearInterval(intervalId)
      gitAbortRef.current = true
    }
  }, [activeRailTab, activeSessionId, workingDirectory, fetchGitStatus])

  // ── Real-time file watching via session file watcher ────────────────
  //
  // When a session has a working directory, subscribe to onSessionFilesChanged
  // with 1-second debouncing. On file changes, re-fetch the git status and
  // re-read all expanded directory listings to keep the tree and changes rail
  // in sync with the agent's real-time output.
  // ──────────────────────────────────────────────────────────────────────

  const fileWatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileWatchDirsRef = useRef<Set<string>>(new Set())

  // Keep fileWatchDirsRef in sync with expandedPaths + the root directory.
  // The root is never in expandedPaths (only child dirs are toggled), but the
  // file-watch handler must re-read it so new top-level files appear immediately.
  useEffect(() => {
    const dirs = new Set(expandedPaths)
    if (wdRootPath) dirs.add(wdRootPath)
    fileWatchDirsRef.current = dirs
  }, [expandedPaths, wdRootPath])

  // Subscribe to onSessionFilesChanged
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.onSessionFilesChanged) return

    const unsubscribe = window.electronAPI.onSessionFilesChanged(() => {
      if (fileWatchTimerRef.current) {
        clearTimeout(fileWatchTimerRef.current)
      }
      fileWatchTimerRef.current = setTimeout(async () => {
        // Refresh git status if a working directory is set
        if (workingDirectory) {
          fetchGitStatus(workingDirectory)
        }
        // Re-read all expanded directories IN PARALLEL so a tree of N
        // expanded folders completes in ~1 IPC roundtrip instead of N
        // sequential round-trips.  Promise.allSettled (not Promise.all)
        // is intentional — a single failing path must NOT abort the
        // rest.  Per-dir errors are tracked inside fetchDirectorySilent
        // and surface as the existing ⚠ indicators on individual rows.
        //
        // The single combined spinner lives in the section header and is
        // driven by wdRefreshLoading — fires ONCE around the bulk call,
        // not per-folder (which would flicker 20 spinners in lockstep).
        const dirs = [...fileWatchDirsRef.current]
        if (dirs.length === 0) return
        setWdRefreshLoading(true)
        try {
          await Promise.allSettled(dirs.map((dirPath) => fetchDirectorySilent(dirPath)))
        } finally {
          setWdRefreshLoading(false)
        }
      }, 1_000) // 1-second debounce
    })

    return () => {
      unsubscribe()
      if (fileWatchTimerRef.current) {
        clearTimeout(fileWatchTimerRef.current)
      }
    }
  }, [workingDirectory, fetchGitStatus, fetchDirectorySilent])

  // Start/stop session file watcher when session + working dir are active
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.watchSessionFiles || !window.electronAPI?.unwatchSessionFiles) return
    if (activeSessionId && workingDirectory) {
      window.electronAPI.watchSessionFiles(activeSessionId)
    }
    return () => {
      if (activeSessionId) {
        window.electronAPI.unwatchSessionFiles()
      }
    }
  }, [activeSessionId, workingDirectory])

  // Flatten the tree into a visible list based on expandedPaths
  const visibleEntries = useMemo((): TreeEntry[] => {
    if (!wdRootPath) return []
    const rootEntries = wdChildren[wdRootPath]
    if (!rootEntries) return []

    function flatten(dirPath: string, depth: number): TreeEntry[] {
      const entries = wdChildren[dirPath]
      if (!entries) return []
      const result: TreeEntry[] = []
      for (const entry of entries) {
        result.push({ entry, depth })
        if (entry.type === 'directory' && expandedPaths.has(entry.path)) {
          result.push(...flatten(entry.path, depth + 1))
        }
      }
      return result
    }

    return flatten(wdRootPath, 0)
  }, [wdChildren, wdRootPath, expandedPaths])

  // Path → index lookup for the keyboard navigation handler. Rebuilds whenever
  // visibleEntries recomputes so key presses stay O(1) regardless of tree depth.
  const visibleEntryIndex = useMemo(() => {
    const idx = new Map<string, number>()
    visibleEntries.forEach((t, i) => idx.set(t.entry.path, i))
    return idx
  }, [visibleEntries])

  // ── Keyboard navigation in the Working Directory tree ───────────
  //
  // Arrow keys traverse, expand/collapse, and open the focused row.
  // Each row is tabIndex=-1 so Tab moves out of the tree (instead of
  // jumping between rows) — arrow keys handle all internal movement.
  // ────────────────────────────────────────────────────────────────

  const [focusedTreePath, setFocusedTreePath] = useState<string | null>(null)
  const treeBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Reset focus when working directory changes — old path may not exist in new tree
  useEffect(() => {
    setFocusedTreePath(null)
  }, [workingDirectory])

  // Drop focus if the focused row is no longer visible (parent collapsed, files removed)
  useEffect(() => {
    if (focusedTreePath && !visibleEntries.some(t => t.entry.path === focusedTreePath)) {
      setFocusedTreePath(null)
    }
  }, [visibleEntries, focusedTreePath])

  // Auto-scroll focused row into view so it stays visible while arrow-traversing
  useEffect(() => {
    if (!focusedTreePath) return
    const el = treeBtnRefs.current.get(focusedTreePath)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [focusedTreePath])

  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (visibleEntries.length === 0) return

    const currentIdx = focusedTreePath ? (visibleEntryIndex.get(focusedTreePath) ?? -1) : -1

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const nextIdx = currentIdx < 0 ? 0 : Math.min(currentIdx + 1, visibleEntries.length - 1)
        setFocusedTreePath(visibleEntries[nextIdx].entry.path)
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : 0
        setFocusedTreePath(visibleEntries[prevIdx].entry.path)
        break
      }
      case 'Home': {
        e.preventDefault()
        setFocusedTreePath(visibleEntries[0].entry.path)
        break
      }
      case 'End': {
        e.preventDefault()
        setFocusedTreePath(visibleEntries[visibleEntries.length - 1].entry.path)
        break
      }
      case 'ArrowRight': {
        e.preventDefault()
        if (currentIdx < 0) {
          setFocusedTreePath(visibleEntries[0].entry.path)
          return
        }
        const entry = visibleEntries[currentIdx].entry
        if (entry.type !== 'directory') return
        if (!expandedPaths.has(entry.path)) {
          toggleExpand(entry.path)
        } else {
          const childIdx = currentIdx + 1
          // Depth lives on the flattened row, not on the WdEntry itself.
          if (childIdx < visibleEntries.length && visibleEntries[childIdx].depth === visibleEntries[currentIdx].depth + 1) {
            setFocusedTreePath(visibleEntries[childIdx].entry.path)
          }
        }
        break
      }
      case 'ArrowLeft': {
        e.preventDefault()
        if (currentIdx < 0) return
        const entry = visibleEntries[currentIdx].entry
        if (entry.type === 'directory' && expandedPaths.has(entry.path)) {
          toggleExpand(entry.path)
          break
        }
        // File or already-collapsed directory → focus the nearest visible ancestor
        // (most recent earlier row at a shallower depth). Depth-0 rows have no
        // visible ancestor above them, so the key is a no-op at the root.
        const currentDepth = visibleEntries[currentIdx].depth
        if (currentDepth === 0) break
        let parentIdx = -1
        for (let i = currentIdx - 1; i >= 0; i--) {
          if (visibleEntries[i].depth < currentDepth) {
            parentIdx = i
            break
          }
        }
        if (parentIdx >= 0) setFocusedTreePath(visibleEntries[parentIdx].entry.path)
        break
      }
      case 'Enter': {
        e.preventDefault()
        if (currentIdx < 0) return
        const entry = visibleEntries[currentIdx].entry
        pulseThen(entry.path, () =>
          entry.type === 'directory'
            ? openFileLocation(entry.path)
            : window.electronAPI?.openFile?.(entry.path)
        )
        break
      }
      case 'Escape': {
        e.preventDefault()
        setFocusedTreePath(null)
        ;(e.currentTarget as HTMLElement).blur?.()
        break
      }
    }
  }, [visibleEntries, visibleEntryIndex, focusedTreePath, expandedPaths, toggleExpand, pulseThen, openFileLocation])

  // ── Working-directory image thumbnails ────────────────────────────
  //
  // Lazily fetch preview data URLs for image files so the file browser
  // shows a small inline thumbnail instead of a generic icon.
  // ───────────────────────────────────────────────────────────────────

  // string → loaded data URL, null → fetch failed (supresses shimmer).
  // A missing key means "not yet fetched" — the shimmer shows for image files.
  const [wdThumbnails, setWdThumbnails] = useState<Record<string, string | null>>({})

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.readFilePreviewDataUrl) return
    const mediaEntries = visibleEntries
      .filter(t => t.entry.type === 'file' && MEDIA_EXT_RE.test(t.entry.name))
      .map(t => t.entry)
    if (mediaEntries.length === 0) return

    // Split video entries from image entries so video URLs (deterministic,
    // no async fetch needed) render immediately instead of waiting for the
    // slowest image thumbnail fetch to finish.
    const videoEntries = mediaEntries.filter(e => VIDEO_EXT_RE.test(e.name))
    const imageEntries = mediaEntries.filter(e => !VIDEO_EXT_RE.test(e.name))

    // Commit video thumbnail URLs synchronously — they use the Electron
    // thumbnail:// protocol which extracts a frame via nativeImage
    // (macOS/Windows) or Chromium's Skia (Linux). The URL is deterministic
    // and the browser loads on demand; no async IO is needed.
    if (videoEntries.length > 0) {
      const videoUrls: Record<string, string | null> = {}
      for (const entry of videoEntries) {
        videoUrls[entry.path] = 'thumbnail://thumb/' + encodeURIComponent(entry.path)
      }
      setWdThumbnails(prev => ({ ...prev, ...videoUrls }))
    }

    let cancelled = false

    const fetchThumbnails = async () => {
      if (imageEntries.length === 0) return
      // Fire all IPC calls in parallel so N images load in the time of the
      // slowest one rather than N sequential round-trips.  Each call is
      // wrapped in an async try/catch so every entry produces a `{ path, url }`
      // result — rejected promises would lose the entry path and leave the
      // shimmer stuck indefinitely on corrupt / permission-denied files.
      const settled = await Promise.allSettled(
        imageEntries.map(async entry => {
          try {
            const url = await window.electronAPI!.readFilePreviewDataUrl(entry.path, 120)
            return { path: entry.path, url }
          } catch {
            return { path: entry.path, url: null }
          }
        })
      )
      if (cancelled) return
      const results: Record<string, string | null> = {}
      for (const result of settled) {
        // Every entry resolves to { path, url } — the try/catch above means
        // Promise.allSettled results are all { status: 'fulfilled', value: ... }.
        if (result.status === 'fulfilled' && result.value.url) {
          results[result.value.path] = result.value.url
        } else if (result.status === 'fulfilled') {
          results[result.value.path] = null
        }
      }
      if (!cancelled && Object.keys(results).length > 0) {
        setWdThumbnails(prev => ({ ...prev, ...results }))
      }
    }

    fetchThumbnails()
    return () => { cancelled = true }
  }, [visibleEntries])

  // ── Files rail summary ────────────────────────────────────────────────
  //
  // Aggregate counts across Session Files and Working Directory.
  // ──────────────────────────────────────────────────────────────────────

  const fileSummary = useMemo(() => {
    const wdFiles = visibleEntries.filter(t => t.entry.type === 'file').map(t => t.entry)
    const wdDirs = visibleEntries.filter(t => t.entry.type === 'directory').map(t => t.entry)
    const totalFiles = attachedFiles.length + wdFiles.length
    const totalDirs = wdDirs.length
    const totalSize = attachedFiles.reduce((sum, f) => sum + (f.att.size || 0), 0) +
      wdFiles.reduce((sum, e) => sum + (e.size || 0), 0)
    return { totalFiles, totalDirs, totalSize }
  }, [attachedFiles, visibleEntries])

  // ── Inline diff viewer for modified files ──────────────────────────
  //
  // Clicking a modified/renamed/copied file fetches its content via readFile
  // and expands an inline diff panel below it. Clicking again collapses it.
  // Added/untracked/deleted files keep the existing open-in-Finder behavior.
  // ──────────────────────────────────────────────────────────────────────

  const [diffFile, setDiffFile] = useState<string | null>(null)

  const [diffOriginal, setDiffOriginal] = useState<string | null>(null)
  const [diffModified, setDiffModified] = useState<string | null>(null)
  const [diffIsBinary, setDiffIsBinary] = useState(false)
  const [diffLoading, setDiffLoading] = useState(false)
  // 'hunks' collapses unchanged regions to N context lines; 'full' renders
  // the entire diff linearly (capped at 2000 lines for computeDiff safety).
  // Persists across file clicks \u2014 intentional, the user's preferred mode is
  // the same for every file in this session. Each new file just opens in
  // their last chosen view.
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('hunks')
  // Generation counter — drops stale getFileGitDiff responses when the
  // user clicks a second file before the first diff finishes loading.
  const diffGenerationRef = useRef(0)

  const handleDiffClick = useCallback(async (file: GitFileEntry) => {
    // Non-modifiable files open in Finder as before
    if (file.status !== 'modified' && file.status !== 'renamed' && file.status !== 'copied') {
      if (workingDirectory) {
        openFileLocation(workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + file.path)
      }
      return
    }

    // Toggle collapse if already open
    if (diffFile === diffKey(file)) {
      setDiffFile(null)
      setDiffOriginal(null)
      setDiffModified(null)
      setDiffIsBinary(false)
      return
    }

    if (typeof window === 'undefined' || !window.electronAPI?.getFileGitDiff || !workingDirectory) {
      return
    }

    const generation = ++diffGenerationRef.current
    setDiffFile(diffKey(file))
    setDiffOriginal(null)
    setDiffModified(null)
    setDiffIsBinary(false)
    setDiffLoading(true)
    try {
      const result = await window.electronAPI.getFileGitDiff(workingDirectory, file.path)
      if (diffGenerationRef.current !== generation) return // a newer click superseded us
      setDiffOriginal(result.original)
      setDiffModified(result.modified)
      setDiffIsBinary(result.isBinary)
    } catch {
      if (diffGenerationRef.current === generation) {
        setDiffOriginal('/* Error loading diff */')
        setDiffModified('')
      }
    } finally {
      if (diffGenerationRef.current === generation) {
        setDiffLoading(false)
      }
    }
  }, [workingDirectory, openFileLocation, diffFile])

  // Build a per-path lookup of bucket → status so the Working Directory tree
  // view can show change indicators. Indoor a single path can have entries in
  // multiple buckets when its porcelain XY code has both sides non-empty
  // (`AM` = staged-add + working-tree-modify).
  const gitStatusByPath = useMemo((): Map<string, Map<GitFileEntry['bucket'], string>> => {
    if (!gitStatus) return new Map()
    const map = new Map<string, Map<GitFileEntry['bucket'], string>>()
    for (const file of gitStatus.files) {
      let inner = map.get(file.path)
      if (!inner) {
        inner = new Map()
        map.set(file.path, inner)
      }
      inner.set(file.bucket, file.status)
    }
    return map
  }, [gitStatus])

  // Bucket-grouped file lists for the rail render. Each bucket is
  // independently derived from the same source array — no shared sort key,
  // so reordering one bucket doesn't drag the others.
  const stagedFiles = useMemo(
    () => gitStatus?.files.filter(f => f.bucket === 'staged') ?? [],
    [gitStatus],
  )
  const unstagedFiles = useMemo(
    () => gitStatus?.files.filter(f => f.bucket === 'unstaged') ?? [],
    [gitStatus],
  )
  const untrackedFiles = useMemo(
    () => gitStatus?.files.filter(f => f.bucket === 'untracked') ?? [],
    [gitStatus],
  )

  // Compute change summary counts per bucket. The rail uses these to
  // drive the section badges above each divider.
  const gitChangeSummary = useMemo(() => {
    if (!gitStatus) return null
    return {
      stagedAdded: stagedFiles.filter(f => f.status === 'added').length,
      stagedModified: stagedFiles.filter(f => f.status === 'modified' || f.status === 'renamed' || f.status === 'copied').length,
      stagedDeleted: stagedFiles.filter(f => f.status === 'deleted').length,
      unstagedModified: unstagedFiles.filter(f => f.status === 'modified').length,
      unstagedDeleted: unstagedFiles.filter(f => f.status === 'deleted').length,
      untracked: untrackedFiles.length,
    }
  }, [gitStatus, stagedFiles, unstagedFiles, untrackedFiles])

  const hasLiveSession = useMemo(
    () => Array.from(metaMap.values()).some((m) => !m.hidden && !m.isArchived && m.isProcessing),
    [metaMap],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.getServerStatus) return
    let cancelled = false
    const refresh = () => {
      window.electronAPI.getServerStatus().then((status) => {
        if (!cancelled) setServerStatus(status)
      }).catch(() => {
        if (!cancelled) setServerStatus({ running: false })
      })
    }
    refresh()
    const id = setInterval(refresh, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const resolvedTheme = useMemo(() => {
    if (theme === 'system') {
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
      return 'light'
    }
    return theme
  }, [theme])

  // Settings lives in the sidebar footer, outside `navItems` — include it here
  // so the topbar still shows "Settings" as the title on that view.
  const activeLabel =
    [...navItems, settingsNavItem].find((item) => item.id === activeView)?.label ?? activeView

  const handleNavigate = (view: ShellView) => {
    setActiveView(view)
    onNavigate?.(view)
  }

  // ── Context menu for git status file items ─────────────────────────

  const [ctxMenuFile, setCtxMenuFile] = useState<GitFileEntry | null>(null)
  const [ctxMenuPos, setCtxMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  const closeContextMenu = useCallback(() => setCtxMenuFile(null), [])

  const handleContextMenu = useCallback((e: React.MouseEvent, file: GitFileEntry) => {
    e.preventDefault()
    e.stopPropagation()
    // Clamp position so the menu never overflows the viewport
    const x = Math.min(e.clientX + 4, window.innerWidth - 160)
    const y = Math.min(e.clientY + 4, window.innerHeight - 120)
    setCtxMenuPos({ x, y })
    setCtxMenuFile(file)
  }, [])

  const resolveFullPath = useCallback((relativePath: string) => {
    if (!workingDirectory) return relativePath
    return workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + relativePath
  }, [workingDirectory])

  const handleCopyPath = useCallback((file: GitFileEntry) => {
    const fullPath = resolveFullPath(file.path)
    navigator.clipboard?.writeText(fullPath).catch((err) => { console.warn('Copy path failed:', err) })
    closeContextMenu()
  }, [resolveFullPath, closeContextMenu])

  // Tracks which bucket just had a Copy-all click. Mutually exclusive: a
  // success sets `copiedBucket` and clears `failedBucket`; a failure does
  // the inverse. The shared timer ref ensures rapid clicks reset the visual
  // window without leaking dangling timeouts on unmount.
  const [copiedBucket, setCopiedBucket] = useState<GitFileEntry['bucket'] | null>(null)
  const [failedBucket, setFailedBucket] = useState<GitFileEntry['bucket'] | null>(null)
  const copyBucketTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyBucketTimerRef.current) clearTimeout(copyBucketTimerRef.current)
    }
  }, [])

  // Bulk copy: every file path in a git-status bucket, joined with '\n',
  // sorted with numeric-aware case-insensitive comparison so the clipboard
  // payload reads predictably when pasted into issue trackers, commit
  // messages, or shell scripts regardless of the user's locale. The first
  // arg identifies which section triggered the copy so the button icon can
  // swap to a check / X for ~1.2s as visual confirmation.
  const handleCopyBucketPaths = useCallback((bucket: GitFileEntry['bucket'], files: GitFileEntry[]) => {
    if (files.length === 0) return
    const sorted = [...files].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }),
    )
    const text = sorted.map(f => resolveFullPath(f.path)).join('\n')
    navigator.clipboard?.writeText(text).then(() => {
      setFailedBucket(null)
      setCopiedBucket(bucket)
      if (copyBucketTimerRef.current) clearTimeout(copyBucketTimerRef.current)
      copyBucketTimerRef.current = setTimeout(() => setCopiedBucket(null), 1_200)
    }).catch((err) => {
      console.warn('Copy paths failed:', err)
      setCopiedBucket(null)
      setFailedBucket(bucket)
      if (copyBucketTimerRef.current) clearTimeout(copyBucketTimerRef.current)
      copyBucketTimerRef.current = setTimeout(() => setFailedBucket(null), 1_200)
    })
  }, [resolveFullPath])

  const handleOpenFile = useCallback((file: GitFileEntry) => {
    const fullPath = resolveFullPath(file.path)
    if (typeof window !== 'undefined' && window.electronAPI?.openFile) {
      window.electronAPI.openFile(fullPath)
    }
    closeContextMenu()
  }, [resolveFullPath, closeContextMenu])

  const handleShowInFolder = useCallback((file: GitFileEntry) => {
    const fullPath = resolveFullPath(file.path)
    openFileLocation(fullPath)
    closeContextMenu()
  }, [resolveFullPath, openFileLocation, closeContextMenu])

  // Discard unstaged working-tree changes for a single file via git checkout.
  // Wired through sessionCommand → server → `git checkout -- <path>` in the
  // session's working directory. The menu item (and the `D` shortcut) only
  // render when bucket === 'unstaged' && status === 'modified', so this
  // handler is never called for staged/deleted/untracked files.
  const handleDiscardChanges = useCallback((file: GitFileEntry) => {
    if (typeof window === 'undefined' || !window.electronAPI?.sessionCommand || activeSessionId == null) return
    const displayName = file.path.split(/[\\/]/).pop() ?? file.path
    // `git checkout --` is destructive and irreversible — confirm before firing.
    // window.confirm in the Electron renderer is synchronous OK with default
    // BrowserWindow settings (no sandbox); native enough for a fast confirm.
    const ok = window.confirm(
      `Discard changes to "${displayName}"?\n\nThis reverts the file's working-tree contents to its last committed state. Cannot be undone.`,
    )
    if (!ok) return
    window.electronAPI.sessionCommand(activeSessionId, { type: 'gitCheckout', filePath: file.path })
      // `sessionCommand` is typed as a union across every command shape; the
      // gitCheckout branch resolves to a {success, error?} envelope.
      ?.then((value) => {
        const result = value as { success: boolean; error?: string } | undefined
        if (result && !result.success) {
          console.warn('Discard failed:', result.error ?? 'unknown error')
        }
        // Git status refresh is handled implicitly by the existing
        // onSessionFilesChanged subscription (1s debounce) — git checkout --
        // writes the file back to disk, the watcher fires, fetchGitStatus
        // runs, the disposed row disappears. No explicit refresh needed here.
      })
      ?.catch((err: unknown) => { console.warn('Discard IPC error:', err) })
    closeContextMenu()
  }, [activeSessionId, closeContextMenu])

  // Close context menu on outside click or Escape; trigger C/E/F shortcuts
  // to invoke Copy path / Open file / Show in folder while the menu is open.
  // Modifier keys (Cmd/Ctrl/Alt) are left alone so browser/OS shortcuts
  // (Cmd+C copy of selected text, etc.) still work as expected. Relocated
  // here so the closure can reference handleCopyPath/handleOpenFile/
  // handleShowInFolder (declared just above) without a TS forward-ref.
  useEffect(() => {
    if (!ctxMenuFile) return
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts while user is typing in a chat input / search field
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      // Escape closes the menu regardless of modifier state — handle it
      // before the modifier gate so Cmd+Esc still dismisses.
      if (e.key === 'Escape') {
        closeContextMenu()
        return
      }
      // Leave browser/system modifier shortcuts alone for everything else.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const file = ctxMenuFile
      switch (e.key.toLowerCase()) {
        case 'c':
          e.preventDefault()
          handleCopyPath(file)
          break
        case 'e':
          e.preventDefault()
          handleOpenFile(file)
          break
        case 'd':
          // Only meaningful for unstaged modified files — the menu item and
          // this shortcut are gated together so the action never fires on a
          // bucket/status where it would be a no-op.
          if (file.bucket === 'unstaged' && file.status === 'modified') {
            e.preventDefault()
            handleDiscardChanges(file)
          }
          break
        case 'f':
          e.preventDefault()
          handleShowInFolder(file)
          break
      }
    }
    const onClick = () => closeContextMenu()
    // Delay adding listeners so the current right-click doesn't immediately close it
    const timer = setTimeout(() => {
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('click', onClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onClick)
    }
  }, [ctxMenuFile, closeContextMenu, handleCopyPath, handleOpenFile, handleShowInFolder, handleDiscardChanges])

  // Render a single git-status row (icon, path, +/- badge, expand button,
  // optional diff panel). Used inside each bucket section below — collapsing
  // the duplicated JSX into one helper keeps the bucket sections tiny.
  const renderChangeItem = (file: GitFileEntry) => (
    <div key={diffKey(file)} className="arch-changes-item-wrap">
      <button
        type="button"
        className={`arch-changes-item ${diffFile === diffKey(file) ? 'arch-changes-item--expanded' : ''}`}
        onClick={() => handleDiffClick(file)}
        onContextMenu={(e) => handleContextMenu(e, file)}
        title={file.path}
      >
        <span className="arch-changes-item__icon" data-status={file.status}>
          {file.status === 'added' || file.status === 'untracked' ? <FilePlus size={11} /> :
           file.status === 'deleted' ? <Trash2 size={11} /> :
           <RefreshCw size={11} />}
        </span>
        <span className="arch-changes-item__path">{file.path}</span>
        {(file.status === 'modified' || file.status === 'renamed' || file.status === 'copied') && (
          <span className="arch-changes-item__diffs">
            {file.additions != null && file.additions > 0 && <i className="arch-changes-diff--add">+{file.additions}</i>}
            {file.deletions != null && file.deletions > 0 && <i className="arch-changes-diff--del">-{file.deletions}</i>}
          </span>
        )}
        {diffFile === diffKey(file) && (
          <span
            className="arch-changes-item__open"
            onClick={(e) => {
              e.stopPropagation()
              openFileLocation(workingDirectory
                ? workingDirectory.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + file.path
                : file.path)
            }}
          >
            <ExternalLink size={10} />
          </span>
        )}
      </button>
      {diffFile === diffKey(file) && (
        <div className="arch-changes-diff-view">
          {diffLoading ? (
            <div className="arch-changes-diff-view__loading">
              <RefreshCw size={12} className="arch-changes-spinner" />
              <span>Loading…</span>
            </div>
          ) : diffIsBinary ? (
            <div className="arch-changes-diff-view__binary">
              <File size={12} />
              <span>Binary file — diff not shown</span>
            </div>
          ) : (diffOriginal !== null || diffModified !== null) ? (
            <div className="arch-changes-diff-view__content">
              <div
                className="arch-changes-diff-view__mode-toggle arch-segmented"
                role="group"
                aria-label="Diff view mode"
              >
                <button
                  type="button"
                  className={
                    'arch-segmented__btn' +
                    (diffViewMode === 'hunks' ? ' arch-segmented__btn--active' : '')
                  }
                  onClick={() => setDiffViewMode('hunks')}
                  aria-pressed={diffViewMode === 'hunks'}
                  title="Show changed regions with 3 context lines around each"
                >
                  Hunks
                </button>
                <button
                  type="button"
                  className={
                    'arch-segmented__btn' +
                    (diffViewMode === 'split' ? ' arch-segmented__btn--active' : '')
                  }
                  onClick={() => setDiffViewMode('split')}
                  aria-pressed={diffViewMode === 'split'}
                  title="Show original and modified side-by-side with syntax highlighting on both"
                >
                  Split
                </button>
                <button
                  type="button"
                  className={
                    'arch-segmented__btn' +
                    (diffViewMode === 'full' ? ' arch-segmented__btn--active' : '')
                  }
                  onClick={() => setDiffViewMode('full')}
                  aria-pressed={diffViewMode === 'full'}
                  title="Show the file linearly with no collapsed regions (capped at 2000 lines for performance)"
                >
                  Full file
                </button>
              </div>
              <HighlightedDiffViewer
                original={diffOriginal ?? ''}
                modified={diffModified ?? ''}
                filePath={file.path}
                maxHeight="240px"
                mode={diffViewMode}
              />
            </div>
          ) : (
            <div className="arch-changes-diff-view__empty">
              <span>No diff available</span>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={`layout-shell layout-shell--${resolvedTheme}`}>
      <aside
        className={`layout-sidebar ${sidebarCollapsed ? 'layout-sidebar--collapsed' : ''}`}
        aria-label="Primary"
      >
        <div className="layout-sidebar__header">
          {!sidebarCollapsed && (
            <div className="layout-sidebar__brand" aria-label="ARCHstudio">
              <span className="layout-sidebar__brand-symbol" aria-hidden="true">
                <AnimatedARCHstudioSymbol />
              </span>
              <span className="layout-sidebar__brand-wordmark">ARCHstudio</span>
            </div>
          )}
          <button
            type="button"
            className="layout-sidebar__toggle"
            onClick={() => {
              // When uncontrolled, drive local state; the parent (controlled)
              // case relies solely on onToggleSidebar.
              if (sidebarCollapsedProp === undefined) setSidebarCollapsed((v) => !v)
              onToggleSidebar?.()
            }}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {onNewChat && (
          <button
            type="button"
            className="layout-new-chat"
            onClick={onNewChat}
            title="New chat"
            aria-label="New chat"
          >
            <Plus size={16} aria-hidden="true" />
            {!sidebarCollapsed && <span>New chat</span>}
          </button>
        )}

        <nav className="layout-sidebar__nav">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeView === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`layout-nav-item ${isActive ? 'layout-nav-item--active' : ''}`}
                onClick={() => handleNavigate(item.id)}
                title={item.label}
              >
                <Icon size={18} aria-hidden="true" />
                {!sidebarCollapsed && <span className="layout-nav-item__label">{item.label}</span>}
              </button>
            )
          })}
        </nav>


        <div className="layout-sidebar__footer">
          <button
            type="button"
            className={`layout-nav-item layout-nav-item--settings ${activeView === 'settings' ? 'layout-nav-item--active' : ''}`}
            onClick={() => handleNavigate('settings')}
            title={settingsNavItem.label}
          >
            <settingsNavItem.icon size={18} aria-hidden="true" />
            {!sidebarCollapsed && (
              <span className="layout-nav-item__label">{settingsNavItem.label}</span>
            )}
          </button>
        </div>
      </aside>

      <div className="layout-main">
        <header className="layout-topbar">
          {topBar ?? (
            <div className="layout-topbar__default">
              <div className="layout-topbar__left">
                <h1 className="layout-topbar__title">
                  {activeLabel}
                </h1>
                {breadcrumbs && breadcrumbs.length > 0 && (
                  <nav className="layout-breadcrumbs" aria-label="Breadcrumb">
                    {breadcrumbs.map((crumb, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <span className="layout-breadcrumbs__sep">/</span>}
                        {crumb.onClick ? (
                          <button
                            type="button"
                            className="layout-breadcrumbs__link"
                            onClick={crumb.onClick}
                          >
                            {crumb.label}
                          </button>
                        ) : (
                          <span className="layout-breadcrumbs__current">{crumb.label}</span>
                        )}
                      </React.Fragment>
                    ))}
                  </nav>
                )}
              </div>
              <div className="layout-topbar__actions">
                <span
                  className="layout-topbar__status"
                  data-status={serverStatus === null ? 'loading' : serverStatus.running ? 'online' : 'offline'}
                >
                  <i />
                  {serverStatus ? (
                    serverStatus.running ? 'Server running' : 'Server offline'
                  ) : (
                    'Checking status…'
                  )}
                </span>
              </div>
            </div>
          )}
          {/* Rendered outside the `topBar ??` fallback so a caller supplying a custom
              topBar can't accidentally drop the theme control. `margin-left: auto` in
              the stylesheet pins it to the far right regardless of what precedes it. */}
          <div
            className="layout-theme-toggle layout-theme-toggle--topbar titlebar-no-drag"
            role="group"
            aria-label="Theme"
          >
            {themeOptions.map(({ mode: m, icon: Icon, label, tone }) => {
              const isActive = theme === m
              return (
                <button
                  key={m}
                  type="button"
                  className={`layout-theme-option ${isActive ? 'layout-theme-option--active' : ''}`}
                  data-tone={tone}
                  aria-pressed={isActive}
                  onClick={() => applyTheme(m)}
                  aria-label={`${label} theme`}
                  title={`${label} theme`}
                >
                  <Icon size={13} aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </header>

        <main className="layout-content" role="main">
          {activeView === 'sessions' ? (
            <div className="layout-sessions-view">
              {typeof sessionListSlot === 'function'
                ? sessionListSlot(sessionsView, setSessionsView)
                : sessionListSlot}
            </div>
          ) : activeView === 'memory' ? (
            <MemoryPanel />
          ) : activeView === 'runs' ? (
            <RunsPanel
              onOpenSession={(sessionId) => {
                // Two moves: route the session navigator to that session, and
                // bring the shell back to the chat view — the panel can do the
                // former on its own but not the latter.
                navigate(routes.view.allSessions(sessionId))
                handleNavigate('command')
              }}
            />
          ) : activeView === 'projects' ? (
            <ProjectsPanel />
          ) : activeView === 'providers' ? (
            <ProvidersPanel />
          ) : activeView === 'integrations' ? (
            <IntegrationsPanel />
          ) : activeView === 'search' ? (
            <SearchPanel />
          ) : activeView === 'security' ? (
            <SecurityPanel />
          ) : activeView === 'settings' ? (
            <SettingsPanel />
          ) : activeView === 'media-lab' ? (
            <MediaLabPanel />
          ) : activeView === 'prompts' ? (
            <PromptStudioPanel />
          ) : activeView === 'command' ? (
            children ? (
              <section className="arch-agent-workspace" aria-label="Agent session workspace">
                <div className="arch-agent-workspace__tabs">
                  {WORKSPACE_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeWorkspaceTab === tab.id}
                      className={activeWorkspaceTab === tab.id ? 'is-active' : ''}
                      onClick={() => setActiveWorkspaceTab(tab.id)}
                      aria-label={tab.label}
                      title={tab.label}
                    >
                      {tab.label}
                    </button>
                  ))}
                  {hasLiveSession && <span className="arch-agent-workspace__live"><i /> Live</span>}
                  {/* The theme toggle used to live here, in the workspace tab bar — which
                      meant it only existed while a chat session was open, and sat mid-bar
                      rather than top-right. It now renders once in the shell header; see
                      `.layout-theme-toggle--topbar`. */}
                </div>
                <div className="arch-agent-workspace__body">
                <div className="arch-agent-workspace__session">
                  {activeWorkspaceTab === 'agent-chat' ? children : activeWorkspaceTab === 'code' ? (
                    <CodeWorkspacePanel
                      filePath={selectedWorkspaceFile}
                      onChooseFile={() => void window.electronAPI.openFileDialog().then((paths) => { if (paths[0]) setSelectedWorkspaceFile(paths[0]) })}
                      onPreview={() => { setPreviewArtifactId(null); setActiveWorkspaceTab('preview') }}
                      onOpenExternal={openWorkspaceFileExternal}
                      onAddToCanvas={(artifact) => { setCanvasArtifacts((items) => [...items, artifact]); setSelectedCanvasArtifactId(artifact.id); setActiveWorkspaceTab('canvas') }}
                    />
                  ) : activeWorkspaceTab === 'canvas' ? (
                    <CanvasWorkspacePanel
                      artifacts={canvasArtifacts}
                      selectedId={selectedCanvasArtifactId}
                      onSelect={setSelectedCanvasArtifactId}
                      onChange={(artifact) => setCanvasArtifacts((items) => items.map((item) => item.id === artifact.id ? artifact : item))}
                      onCreate={() => { const artifact: WorkspaceArtifact = { id: crypto.randomUUID(), title: 'Untitled artifact', kind: 'markdown', content: '# New artifact\n', updatedAt: Date.now() }; setCanvasArtifacts((items) => [...items, artifact]); setSelectedCanvasArtifactId(artifact.id) }}
                      onDelete={(id) => { if (!window.confirm('Delete this Canvas artifact?')) return; setCanvasArtifacts((items) => items.filter((item) => item.id !== id)); setSelectedCanvasArtifactId((current) => current === id ? null : current) }}
                      onPreview={(artifact) => { setPreviewArtifactId(artifact.id); setActiveWorkspaceTab('preview') }}
                    />
                  ) : activeWorkspaceTab === 'preview' ? (
                    <PreviewWorkspacePanel
                      filePath={selectedWorkspaceFile}
                      artifact={canvasArtifacts.find((item) => item.id === previewArtifactId) ?? null}
                      onChooseFile={() => void window.electronAPI.openFileDialog().then((paths) => { if (paths[0]) { setSelectedWorkspaceFile(paths[0]); setPreviewArtifactId(null) } })}
                      onOpenExternal={openWorkspaceFileExternal}
                    />
                  ) : (
                    <TasksWorkspacePanel sessionId={activeSessionId} onOpenOutput={(path) => { setSelectedWorkspaceFile(path); setPreviewArtifactId(null); setActiveWorkspaceTab('preview') }} />
                  )}
                </div>
                <aside className="arch-context-rail" aria-label="Session context">
                  <div className="arch-context-rail__tabs">
                    {RAIL_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={activeRailTab === tab.id ? 'is-active' : ''}
                        onClick={() => setActiveRailTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                    {activeRailTab === 'context' ? (
                    /* Every row here reflects the real selected session. Rows whose
                       data is genuinely unavailable render an explicit unknown
                       state rather than a plausible-looking default — this rail
                       previously hardcoded "ARCH Builder / Owner Auto / Auto
                       select" regardless of the actual session. */
                    sessionContext ? (
                      <>
                        <section>
                          <label>Connection</label>
                          <div className="arch-agent-card">
                            <span className="arch-agent-card__mark">
                              {(sessionContext.connectionLabel ?? '?').charAt(0).toUpperCase()}
                            </span>
                            <div>
                              <strong>{sessionContext.connectionLabel ?? 'Not connected'}</strong>
                              <small>{sessionContext.sessionName ?? 'Untitled session'}</small>
                            </div>
                            <i data-live={sessionContext.isProcessing ? 'true' : undefined} />
                          </div>
                        </section>
                        <section>
                          <label>Permission mode</label>
                          <div className="arch-context-row">
                            <strong>{sessionContext.permissionModeLabel}</strong>
                            <span>{sessionContext.isProcessing ? 'Running' : 'Idle'}</span>
                          </div>
                        </section>
                        <section>
                          <label>Model</label>
                          <div className="arch-context-row">
                            <strong>{sessionContext.modelLabel ?? 'Workspace default'}</strong>
                            <span>{sessionContext.thinkingLabel}</span>
                          </div>
                        </section>
                        <section>
                          <label>Sources</label>
                          {sessionContext.sourceNames.length > 0 ? (
                            <div className="arch-capability-grid">
                              {sessionContext.sourceNames.map((source) => (
                                <span
                                  key={source.name}
                                  // Drives the status glow in LayoutShell.css.
                                  // Only 'connected' and 'failed' are styled;
                                  // every other status renders a plain chip.
                                  data-source-status={source.status}
                                >
                                  {source.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="arch-context-row arch-context-row--empty">
                              <span>No sources enabled</span>
                            </div>
                          )}
                        </section>
                        {sessionContext.workingDirectory && (
                          <section>
                            <label>Working directory</label>
                            <div
                              className="arch-context-row arch-context-row--path"
                              title={sessionContext.workingDirectory}
                            >
                              <strong>{sessionContext.workingDirectory}</strong>
                            </div>
                          </section>
                        )}
                      </>
                    ) : (
                      <section>
                        <label>Session</label>
                        <div className="layout-placeholder" style={{ minHeight: 120 }}>
                          <p style={{ fontSize: 11 }}>No session selected.</p>
                        </div>
                      </section>
                    )
                  ) : activeRailTab === 'files' ? (
                    <>
                      <section>
                        <label>
                          Session Files
                          {attachedFiles.length > 0 && (
                            <>
                              <span className="arch-file-list__count">{attachedFiles.length}</span>
                              <button
                                type="button"
                                className="arch-file-list__clear"
                                onClick={(e) => { e.stopPropagation(); handleClearAttachments() }}
                                title="Remove all files from this session"
                              >
                                Clear all
                              </button>
                            </>
                          )}
                        </label>
                        {activeSessionId && attachedFiles.length > 0 ? (
                          <div className="arch-file-list">
                            {attachedFiles.map(({ att, messageId }) => (
                              <div
                                key={att.id}
                                role="button"
                                tabIndex={0}
                                className="arch-file-item"
                                onClick={() => openFileLocation(att.storedPath)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    openFileLocation(att.storedPath)
                                  }
                                }}
                                title={att.storedPath || att.name}
                              >
                                {att.type === 'image' && att.thumbnailBase64 ? (
                                  <span className="arch-file-item__thumb">
                                    <ThumbnailHoverPreview
                                      file={{ path: att.storedPath, name: att.name }}
                                      previewSize={480}
                                    >
                                      <img
                                        src={`data:image/png;base64,${att.thumbnailBase64}`}
                                        alt=""
                                        loading="lazy"
                                        draggable={false}
                                      />
                                    </ThumbnailHoverPreview>
                                  </span>
                                ) : (
                                  <span
                                    className="arch-file-item__icon"
                                    style={{ color: getFileIconColor(att.type) }}
                                    data-loading={att.type === 'image' && !att.thumbnailBase64 ? 'true' : undefined}
                                  >
                                    {getFileIcon(att.type)}
                                  </span>
                                )}
                                <div className="arch-file-item__info">
                                  <strong className="arch-file-item__name">{att.name}</strong>
                                  <span className="arch-file-item__meta">
                                    {formatFileSize(att.size)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="arch-file-item__remove"
                                  aria-label={`Remove ${att.name}`}
                                  title={`Remove ${att.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleRemoveAttachment(messageId, att.id)
                                  }}
                                >
                                  <X size={11} />
                                </button>
                                <ExternalLink size={11} className="arch-file-item__open" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="layout-placeholder" style={{ minHeight: 80 }}>
                            <File size={20} />
                            <p style={{ fontSize: 11, marginTop: 6 }}>
                              {activeSessionId
                                ? 'No files attached to this session.'
                                : 'No session selected.'}
                            </p>
                          </div>
                        )}
                      </section>

                      {/* Working Directory tree view */}
                      <section>
                        <label>
                          Working Directory
                          {visibleEntries.length > 0 && (
                            <>
                              {wdRefreshLoading && (
                                <span
                                  className="wd-files-refreshing-badge"
                                  title="Re-reading expanded directories after a file change\u2026"
                                  aria-live="polite"
                                >
                                  <RefreshCw size={9} className="arch-changes-spinner" />
                                  <span>Refreshing</span>
                                </span>
                              )}
                              <span className="arch-file-list__count">{visibleEntries.length}</span>
                              {hasExpandedDirs ? (
                                <button
                                  type="button"
                                  className="arch-file-list__action"
                                  onClick={(e) => { e.stopPropagation(); handleCollapseAll() }}
                                  title="Collapse all subdirectories"
                                >
                                  Collapse all
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="arch-file-list__action"
                                  onClick={(e) => { e.stopPropagation(); handleExpandAll() }}
                                  title={`Expand subdirectories (${Number.isFinite(expandDepth) ? `${expandDepth} level${expandDepth !== 1 ? 's' : ''} deep` : 'all levels'})`}
                                >
                                  <ChevronsDownUp size={10} />
                                  Expand all
                                </button>
                              )}
                              {/*
                                Depth selector persists after expansion so
                                the user can bump depth (e.g. 2→4) without
                                collapsing first.  Clicks run a BFS that
                                preserves existing expanded paths and
                                fetches/expands only the newly discovered
                                levels — no fresh re-expand required.
                              */}
                              {/*
                                Depth selector popover.  Replaces the old
                                horizontal button row with a keyboard-first
                                popover menu — pressing 1/2/3/4/A anywhere
                                in the tree picks a depth, the trigger
                                shows the current selection + a chevron,
                                and the menu shows shortcuts as <kbd> hints.
                                Scales trivially to new options (5, Custom,
                                presets like "2 dirs deep") without layout
                                pressure.

                                `1` is the floor (same semantics as before:
                                shrink derivation produces empty targetSet,
                                depth-1 rows visible but collapsed, clicking
                                fires gate/drill).
                              */}
                              <span className="wd-depth-popover" ref={depthPopoverRef}>
                                <button
                                  type="button"
                                  className={`wd-depth-popover__trigger ${depthPopoverOpen ? 'is-open' : ''}`}
                                  onClick={(e) => { e.stopPropagation(); setDepthPopoverOpen(v => !v) }}
                                  title={`Depth: ${Number.isFinite(expandDepth) ? `${expandDepth} level${expandDepth !== 1 ? 's' : ''} deep` : 'All levels'} — click to change`}
                                  aria-expanded={depthPopoverOpen}
                                  aria-haspopup="listbox"
                                >
                                  <span className="wd-depth-popover__trigger-label">
                                    {Number.isFinite(expandDepth) ? expandDepth : 'All'}
                                  </span>
                                  {depthPopoverOpen ? (
                                    <ChevronDown size={8} className="wd-depth-popover__trigger-chevron--open" />
                                  ) : (
                                    <ChevronDown size={8} />
                                  )}
                                </button>
                                {depthPopoverOpen && (
                                  <div
                                    className="wd-depth-popover__menu"
                                    role="listbox"
                                    aria-label="Depth selector"
                                    onMouseDown={(e) => e.stopPropagation()}
                                  >
                                    {DEPTH_POPOVER_OPTIONS.map((opt) => (
                                      <button
                                        key={String(opt.value)}
                                        type="button"
                                        role="option"
                                        aria-selected={expandDepth === opt.value}
                                        className={`wd-depth-popover__item ${expandDepth === opt.value ? 'is-active' : ''}`}
                                        data-depth-value={String(opt.value)}
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleDepthPick(opt.value)
                                          setDepthPopoverOpen(false)
                                        }}
                                      >
                                        <span className="wd-depth-popover__item-label">
                                          {expandDepth === opt.value && (
                                            <Check size={9} aria-hidden="true" className="wd-depth-popover__item-check" />
                                          )}
                                          {opt.label}
                                        </span>
                                        <kbd className="wd-depth-popover__item-shortcut">
                                          {opt.shortcut}
                                        </kbd>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </span>
                              {/*
                                Drill-mode chip — renders when the user has
                                temporarily bumped the depth cap to expand
                                a gated row.  Title explains the override
                                and the ✕ button lets the user cancel the
                                drill without doing a full Collapse-all.
                                Auto-clears on Collapse-all, session switch,
                                and manual depth-pick (see the three reset
                                hooks above).
                              */}
                              {drillBaselineDepth !== null && (
                                <span
                                  className="wd-files-drill-chip"
                                  title={`Cap overridden: ${drillBaselineDepth} → ${expandDepth}. Click ✕ to restore.`}
                                  aria-live="polite"
                                >
                                  <ChevronsDownUp size={9} />
                                  <span>Drill</span>
                                  <button
                                    type="button"
                                    className="wd-files-drill-chip__cancel"
                                    aria-label="Cancel drill and restore original depth"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setExpandDepth(drillBaselineDepth)
                                      setDrillBaselineDepth(null)
                                    }}
                                  >
                                    ✕
                                  </button>
                                </span>
                              )}
                              {/*
                                Cap-warning chip — only renders when the
                                most recent BFS hit MAX_EXPAND_DIRS.  Cleared
                                on Collapse-all, session change, or any
                                future successful BFS that doesn't trip
                                the cap.  Title tooltip explains the
                                partial expansion and the recovery
                                options so the user is never in the dark
                                about why their tree felt "incomplete."
                              */}
                              {expansionCapped && (
                                <span
                                  className="wd-files-capped-badge"
                                  title={`Expansion stopped at ${MAX_EXPAND_DIRS} directories — pick a shallower depth or use Collapse all + manual toggles`}
                                  aria-live="polite"
                                >
                                  Capped at {MAX_EXPAND_DIRS}
                                </span>
                              )}
                              {/*
                                Count-cap chip — renders when the cumulative
                                open-directory count exceeded `openDirCap`
                                and leaf-most entries were silently collapsed.
                                Complements the BFS cap: the BFS cap prevents
                                runaway *discovery*; this cap prevents runaway
                                *open state* regardless of how entries were
                                expanded.
                              */}
                              {openCountCapped && (
                                <span
                                  className="wd-files-capped-badge"
                                  title={`Open dirs capped at ${openDirCap} — deepest entries were silently collapsed. Use Collapse all to reset.`}
                                  aria-live="polite"
                                >
                                  {openDirCap} open limit
                                </span>
                              )}
                            </>
                          )}
                        </label>
                        {workingDirectory ? (
                          wdLoading && visibleEntries.length === 0 ? (
                            <div className="wd-files-loading">
                              <RefreshCw size={14} className="arch-changes-spinner" />
                              <span>Loading…</span>
                            </div>
                          ) : wdError ? (
                            <div className="wd-files-empty">
                              <span>{wdError}</span>
                            </div>
                          ) : visibleEntries.length > 0 ? (
                            <div
                              className="wd-files-list wd-files-tree"
                              tabIndex={0}
                              role="tree"
                              aria-label="Working directory"
                              onKeyDown={handleTreeKeyDown}
                            >
                              {visibleEntries.map(({ entry, depth }) => (
                                <TreeRow
                                  key={entry.path}
                                  entry={entry}
                                  depth={depth}
                                  wdRootPath={wdRootPath!}
                                  expandDepth={expandDepth}
                                  expandedPaths={expandedPaths}
                                  pinnedPaths={pinnedPaths}
                                  wdChildren={wdChildren}
                                  focusedTreePath={focusedTreePath}
                                  pulsingPath={pulsingPath}
                                  flashingPath={flashingPath}
                                  loadingDirs={loadingDirs}
                                  erroredDirs={erroredDirs}
                                  wdThumbnails={wdThumbnails}
                                  treeBtnRefs={treeBtnRefs}
                                  gitStatusByPath={gitStatusByPath}
                                  workingDirectory={workingDirectory}
                                  onFocus={setFocusedTreePath}
                                  flashExpand={flashExpand}
                                  toggleExpand={toggleExpand}
                                togglePin={togglePin}
                                  pulseThen={pulseThen}
                                  openFileLocation={openFileLocation}
                                  onOpenFile={
                                    typeof window !== 'undefined'
                                      ? (path: string) => { setSelectedWorkspaceFile(path); setPreviewArtifactId(null); setActiveWorkspaceTab('code') }
                                      : undefined
                                  }
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="wd-files-empty">
                              <span>Empty directory</span>
                            </div>
                          )
                        ) : (
                          <div className="wd-files-empty">
                            <span>No working directory</span>
                          </div>
                        )}
                      </section>

                      {/* Files summary bar */}
                      {(attachedFiles.length > 0 || visibleEntries.length > 0) && (
                        <section className="wd-files-summary">
                          <span className="wd-files-summary__stat">
                            <File size={11} />
                            {fileSummary.totalFiles} file{fileSummary.totalFiles !== 1 ? 's' : ''}
                          </span>
                          {fileSummary.totalDirs > 0 && (
                            <span className="wd-files-summary__stat">
                              <Folder size={11} />
                              {fileSummary.totalDirs} director{fileSummary.totalDirs !== 1 ? 'ies' : 'y'}
                            </span>
                          )}
                          <span className="wd-files-summary__stat">
                            {formatFileSize(fileSummary.totalSize)}
                          </span>
                        </section>
                      )}
                    </>
                  ) : (
                    <section>
                      <label>
                        Recent Changes
                        {gitStatus && gitStatus.files.length > 0 && (
                          <span className="arch-file-list__count">{gitStatus.files.length}</span>
                        )}
                      </label>
                      {!activeSessionId ? (
                        <div className="layout-placeholder" style={{ minHeight: 80 }}>
                          <File size={20} />
                          <p style={{ fontSize: 11, marginTop: 6 }}>No session selected.</p>
                        </div>
                      ) : !workingDirectory ? (
                        <div className="arch-context-row arch-context-row--empty">
                          <span>No working directory</span>
                        </div>
                      ) : gitLoading && !gitStatus ? (
                        <div className="arch-changes-loading">
                          <RefreshCw size={14} className="arch-changes-spinner" />
                          <span>Checking git status…</span>
                        </div>
                      ) : gitStatus && gitStatus.branch === null && gitStatus.files.length === 0 ? (
                        <div className="arch-context-row arch-context-row--empty">
                          <span>Not a git repository</span>
                        </div>
                      ) : gitStatus && gitStatus.files.length === 0 ? (
                        <div className="arch-context-row arch-context-row--empty">
                          <span>Working tree clean</span>
                        </div>
                      ) : gitStatus ? (
                        <>
                          {/* Branch bar */}
                          <div className="arch-changes-branch">
                            <GitBranch size={12} />
                            <span className="arch-changes-branch__label">{gitStatus.branch || '(detached)'}</span>
                          </div>
                          {/* Per-bucket summary counts (staged / unstaged / untracked).
                              The summary hints which sections below will render. */}
                          {gitChangeSummary && (
                            gitChangeSummary.stagedAdded + gitChangeSummary.stagedModified + gitChangeSummary.stagedDeleted +
                            gitChangeSummary.unstagedModified + gitChangeSummary.unstagedDeleted +
                            gitChangeSummary.untracked
                          ) > 0 && (
                            <div className="arch-changes-summary">
                              {(gitChangeSummary.stagedAdded + gitChangeSummary.stagedModified + gitChangeSummary.stagedDeleted) > 0 && (
                                <span className="arch-changes-summary__stat arch-changes-summary__stat--staged">
                                  {gitChangeSummary.stagedAdded + gitChangeSummary.stagedModified + gitChangeSummary.stagedDeleted} staged
                                </span>
                              )}
                              {(gitChangeSummary.unstagedModified + gitChangeSummary.unstagedDeleted) > 0 && (
                                <span className="arch-changes-summary__stat arch-changes-summary__stat--modified">
                                  {gitChangeSummary.unstagedModified + gitChangeSummary.unstagedDeleted} unstaged
                                </span>
                              )}
                              {gitChangeSummary.untracked > 0 && (
                                <span className="arch-changes-summary__stat arch-changes-summary__stat--added">
                                  {gitChangeSummary.untracked} untracked
                                </span>
                              )}
                            </div>
                          )}
                          {/* File list — grouped by bucket with section dividers */}
                          <div className="arch-changes-list">
                            {stagedFiles.length > 0 && (
                              <section className="arch-changes-section arch-changes-section--staged">
                                <div className="arch-changes-section__header">
                                  <span className="arch-changes-section__label">Staged</span>
                                  <span className="arch-changes-section__count">{stagedFiles.length}</span>
                                  <button
                                    type="button"
                                    className={`arch-changes-section__action ${
                                      copiedBucket === 'staged' ? 'arch-changes-section__action--copied' :
                                      failedBucket === 'staged' ? 'arch-changes-section__action--failed' : ''
                                    }`}
                                    onClick={(e) => { e.stopPropagation(); handleCopyBucketPaths('staged', stagedFiles) }}
                                    title={
                                      copiedBucket === 'staged' ? `Copied ${stagedFiles.length} paths` :
                                      failedBucket === 'staged' ? 'Copy failed — see console' :
                                      `Copy all ${stagedFiles.length} staged paths`
                                    }
                                    aria-label={
                                      copiedBucket === 'staged' ? 'Copied' :
                                      failedBucket === 'staged' ? 'Copy failed' :
                                      'Copy all staged paths'
                                    }
                                  >
                                    {copiedBucket === 'staged' ? <Check size={10} /> :
                                     failedBucket === 'staged' ? <X size={10} /> :
                                     <Copy size={10} />}
                                  </button>
                                </div>
                                <div className="arch-changes-section__items">
                                  {stagedFiles.map((file) => renderChangeItem(file))}
                                </div>
                              </section>
                            )}
                            {unstagedFiles.length > 0 && (
                              <section className="arch-changes-section arch-changes-section--unstaged">
                                <div className="arch-changes-section__header">
                                  <span className="arch-changes-section__label">Unstaged</span>
                                  <span className="arch-changes-section__count">{unstagedFiles.length}</span>
                                  <button
                                    type="button"
                                    className={`arch-changes-section__action ${
                                      copiedBucket === 'unstaged' ? 'arch-changes-section__action--copied' :
                                      failedBucket === 'unstaged' ? 'arch-changes-section__action--failed' : ''
                                    }`}
                                    onClick={(e) => { e.stopPropagation(); handleCopyBucketPaths('unstaged', unstagedFiles) }}
                                    title={
                                      copiedBucket === 'unstaged' ? `Copied ${unstagedFiles.length} paths` :
                                      failedBucket === 'unstaged' ? 'Copy failed — see console' :
                                      `Copy all ${unstagedFiles.length} unstaged paths`
                                    }
                                    aria-label={
                                      copiedBucket === 'unstaged' ? 'Copied' :
                                      failedBucket === 'unstaged' ? 'Copy failed' :
                                      'Copy all unstaged paths'
                                    }
                                  >
                                    {copiedBucket === 'unstaged' ? <Check size={10} /> :
                                     failedBucket === 'unstaged' ? <X size={10} /> :
                                     <Copy size={10} />}
                                  </button>
                                </div>
                                <div className="arch-changes-section__items">
                                  {unstagedFiles.map((file) => renderChangeItem(file))}
                                </div>
                              </section>
                            )}
                            {untrackedFiles.length > 0 && (
                              <section className="arch-changes-section arch-changes-section--untracked">
                                <div className="arch-changes-section__header">
                                  <span className="arch-changes-section__label">Untracked</span>
                                  <span className="arch-changes-section__count">{untrackedFiles.length}</span>
                                  <button
                                    type="button"
                                    className={`arch-changes-section__action ${
                                      copiedBucket === 'untracked' ? 'arch-changes-section__action--copied' :
                                      failedBucket === 'untracked' ? 'arch-changes-section__action--failed' : ''
                                    }`}
                                    onClick={(e) => { e.stopPropagation(); handleCopyBucketPaths('untracked', untrackedFiles) }}
                                    title={
                                      copiedBucket === 'untracked' ? `Copied ${untrackedFiles.length} paths` :
                                      failedBucket === 'untracked' ? 'Copy failed — see console' :
                                      `Copy all ${untrackedFiles.length} untracked paths`
                                    }
                                    aria-label={
                                      copiedBucket === 'untracked' ? 'Copied' :
                                      failedBucket === 'untracked' ? 'Copy failed' :
                                      'Copy all untracked paths'
                                    }
                                  >
                                    {copiedBucket === 'untracked' ? <Check size={10} /> :
                                     failedBucket === 'untracked' ? <X size={10} /> :
                                     <Copy size={10} />}
                                  </button>
                                </div>
                                <div className="arch-changes-section__items">
                                  {untrackedFiles.map((file) => renderChangeItem(file))}
                                </div>
                              </section>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="arch-context-row arch-context-row--empty">
                          <span>Waiting…</span>
                        </div>
                      )}

                      {/* Context menu for right-clicking git status files */}
                      {ctxMenuFile && (
                        <div
                          className="arch-changes-ctx-menu"
                          role="menu"
                          style={{ position: 'fixed', left: ctxMenuPos.x, top: ctxMenuPos.y }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="arch-changes-ctx-menu__item"
                            role="menuitem"
                            aria-keyshortcuts="c"
                            onClick={() => handleCopyPath(ctxMenuFile)}
                          >
                            <Copy size={11} />
                            <span>Copy path</span>
                            <kbd className="arch-changes-ctx-menu__shortcut" aria-hidden="true">C</kbd>
                          </button>
                          <button
                            type="button"
                            className="arch-changes-ctx-menu__item"
                            role="menuitem"
                            aria-keyshortcuts="e"
                            onClick={() => handleOpenFile(ctxMenuFile)}
                          >
                            <ExternalLink size={11} />
                            <span>Open file</span>
                            <kbd className="arch-changes-ctx-menu__shortcut" aria-hidden="true">E</kbd>
                          </button>
                          <button
                            type="button"
                            className="arch-changes-ctx-menu__item"
                            role="menuitem"
                            aria-keyshortcuts="f"
                            onClick={() => handleShowInFolder(ctxMenuFile)}
                          >
                            <Folder size={11} />
                            <span>Show in folder</span>
                            <kbd className="arch-changes-ctx-menu__shortcut" aria-hidden="true">F</kbd>
                          </button>
                          {/* Destructive: only meaningful for unstaged modified files */}
                          {ctxMenuFile.bucket === 'unstaged' && ctxMenuFile.status === 'modified' && (
                            <button
                              type="button"
                              className="arch-changes-ctx-menu__item arch-changes-ctx-menu__item--destructive"
                              role="menuitem"
                              aria-keyshortcuts="d"
                              onClick={() => handleDiscardChanges(ctxMenuFile)}
                            >
                              <Undo2 size={11} />
                              <span>Discard changes</span>
                              <kbd className="arch-changes-ctx-menu__shortcut" aria-hidden="true">D</kbd>
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                  </aside>
                </div>
              </section>
            ) : (
              <div className="layout-command-view">
                <HomeHero
                  onOpenCommand={() => handleNavigate('command')}
                  onExploreMemory={() => handleNavigate('memory')}
                />
                {/* Primary way back into a conversation. Without this, closing the
                    last chat leaves the Command view with no path to a new one. */}
                {onNewChat && (
                  <button type="button" className="layout-start-chat" onClick={onNewChat}>
                    <MessageSquarePlus size={18} aria-hidden="true" />
                    <span>
                      <strong>Start a new chat</strong>
                      <small>Open a fresh session with your agent</small>
                    </span>
                  </button>
                )}
                <CommandPanel />
              </div>
            )
          ) : (
            children ?? (
              <div className="layout-placeholder">
                <p>Select a view to get started.</p>
              </div>
            )
          )}
        </main>
      </div>
    </div>
  )
}

export default LayoutShell
