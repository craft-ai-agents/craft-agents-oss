import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
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
  Construction,
  FileText,
  Image,
  File,
  Plus,
  MessageSquarePlus,
  ExternalLink,
  Trash2,
  FilePlus,
  RefreshCw,
  GitBranch,
  ChevronRight,
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
import { ShikiDiffViewer } from '../components/shiki'
import { HomeHero } from '../home'
import { sessionMetaMapAtom, activeSessionIdAtom, sessionAtomFamily } from '../atoms/sessions'
import type { StoredAttachment, Session } from '../../shared/types'
// Sidebar brand uses the rasterised icon-set PNG (which already has the
// rounded-square dark card + emblem baked in), so the brand mark in the
// chrome is identical to the desktop app icon users see on their launcher.
import brandIconUrl from '@resources/icon-set/icon-512.png?url'
import './LayoutShell.css'

export type ShellView =
  | 'command'
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
  { id: 'command' as ShellView, label: 'Command', icon: Command },
  { id: 'runs' as ShellView, label: 'Runs', icon: Activity },
  { id: 'projects' as ShellView, label: 'Projects', icon: FolderKanban },
  { id: 'memory' as ShellView, label: 'Memory', icon: Brain },
  { id: 'media-lab' as ShellView, label: 'Media Lab', icon: Clapperboard },
  { id: 'prompts' as ShellView, label: 'Prompt Studio', icon: BookOpen },
  { id: 'providers' as ShellView, label: 'Providers', icon: Plug },
  { id: 'integrations' as ShellView, label: 'Integrations', icon: Globe },
  { id: 'security' as ShellView, label: 'Security', icon: ShieldCheck },
  { id: 'search' as ShellView, label: 'Search', icon: Search },
  { id: 'settings' as ShellView, label: 'Settings', icon: Settings },
] as const

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
  children?: React.ReactNode
}

/** What the context rail can honestly report about the active session. */
export type ShellSessionContext = {
  sessionName?: string
  /** Display name of the LLM connection backing this session. */
  connectionLabel?: string
  /** Human-readable permission mode ('Safe', 'Ask', 'Allow all'). */
  permissionModeLabel: string
  /** Display name of the resolved model, if the session pins one. */
  modelLabel?: string
  /** Human-readable thinking level. */
  thinkingLabel: string
  /** Names of sources enabled for this session. */
  sourceNames: string[]
  workingDirectory?: string
  isProcessing?: boolean
}

/** A constant atom that always holds null — used in place of a missing session atom
 *  so we can call useAtomValue unconditionally even when no session is selected. */
const nullSessionAtom = atom<Session | null>(null)

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

/**
 * Renderer-side shape for a single git-status row. Field semantics mirror
 * the server `GitStatusFileEntry` (from `dto.ts`) except `name` is the
 * basename only (renderer-local optimisation that avoids re-splitting the
 * path on every render). A single path may appear once per non-empty
 * porcelain XY side, so `bucket` is part of the row identity.
 */
interface GitFileEntry {
  path: string
  name: string
  status: string
  additions?: number
  deletions?: number
  /** Which side of porcelain-XY this entry came from. Drives bucket-grouped
   *  rendering in the rail and the dual lookup in the tree badge. */
  bucket: 'staged' | 'unstaged' | 'untracked'
}

// Stable identity for a (path, bucket) pair. A file may appear in both staged
// and unstaged buckets when its porcelain-XY has both sides non-empty (`AM` =
// staged-add + working-tree-modify). Without this composite key, the renderer's
// `key={...}` would collide between the two rows AND `setDiffFile(file.path)`
// would conflate them — clicking one would silently toggle the other.
const diffKey = (file: GitFileEntry) => `${file.path}|${file.bucket}`

function LayoutShell({
  initialView = 'command',
  initialRailTab,
  initialGitStatus,
  onNavigate,
  theme = 'system',
  onThemeChange,
  topBar,
  breadcrumbs,
  onNewChat,
  sessionContext,
  children,
}: LayoutShellProps) {
  const [activeView, setActiveView] = useState<ShellView>(initialView)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('agent-chat')
  const [activeRailTab, setActiveRailTab] = useState<RailTab>(initialRailTab ?? 'context')
  const [serverStatus, setServerStatus] = useState<{ running: boolean; url?: string } | null>(null)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const sessionAtom = useMemo(
    () => activeSessionId ? sessionAtomFamily(activeSessionId) : nullSessionAtom,
    [activeSessionId],
  )
  const activeSession = useAtomValue(sessionAtom)

  const attachedFiles = useMemo(() => {
    if (!activeSession?.messages) return []
    const seen = new Set<string>()
    const files: StoredAttachment[] = []
    for (const msg of activeSession.messages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          const key = att.storedPath || att.id
          if (!seen.has(key)) {
            seen.add(key)
            files.push(att)
          }
        }
      }
    }
    return files
  }, [activeSession])

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

  interface WdEntry {
    name: string
    path: string
    type: 'file' | 'directory'
    size?: number
    mtime?: number
    isSymlink: boolean
  }

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

  // Root of the tree — set when the working directory changes.
  const [wdRootPath, setWdRootPath] = useState<string | null>(null)
  const [wdLoading, setWdLoading] = useState(false)
  const [wdError, setWdError] = useState<string | null>(null)
  const wdAbortRef = useRef(false)

  const updateChildren = useCallback((dirPath: string, entries: WdEntry[]) => {
    setWdChildren(prev => {
      const next = { ...prev, [dirPath]: entries }
      wdChildrenRef.current = next
      return next
    })
  }, [])

  const fetchDirectory = useCallback(async (dirPath: string) => {
    if (typeof window === 'undefined' || !window.electronAPI?.listDirectoryFiles) return
    wdAbortRef.current = false
    setWdLoading(true)
    setWdError(null)
    try {
      const result = await window.electronAPI.listDirectoryFiles(dirPath)
      if (!wdAbortRef.current) {
        updateChildren(dirPath, result.entries)
      }
    } catch (err) {
      if (!wdAbortRef.current) {
        setWdError(err instanceof Error ? err.message : 'Failed to read directory')
        updateChildren(dirPath, [])
      }
    } finally {
      if (!wdAbortRef.current) {
        setWdLoading(false)
      }
    }
  }, [updateChildren])

  // Fetch + expand a directory. Called when the user clicks a folder.
  const toggleExpand = useCallback((dirPath: string) => {
    // Fetch children if not cached yet
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
      return next
    })
  }, [fetchDirectory])

  // Fetch root directory when session workingDirectory changes
  useEffect(() => {
    if (workingDirectory) {
      setWdRootPath(workingDirectory)
      fetchDirectory(workingDirectory)
    } else {
      setWdRootPath(null)
      setWdChildren({})
      wdChildrenRef.current = {}
      setExpandedPaths(new Set())
    }
    return () => {
      wdAbortRef.current = true
    }
  }, [workingDirectory, fetchDirectory])

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

  // ── Working-directory image thumbnails ────────────────────────────
  //
  // Lazily fetch preview data URLs for image files so the file browser
  // shows a small inline thumbnail instead of a generic icon.
  // ───────────────────────────────────────────────────────────────────

  const [wdThumbnails, setWdThumbnails] = useState<Record<string, string>>({})

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.readFilePreviewDataUrl) return

    const imageEntries = visibleEntries
      .filter(t => t.entry.type === 'file' && IMAGE_EXT_RE.test(t.entry.name))
      .map(t => t.entry)
    if (imageEntries.length === 0) return

    let cancelled = false

    const fetchThumbnails = async () => {
      const results: Record<string, string> = {}
      for (const entry of imageEntries) {
        if (cancelled) break
        try {
          const dataUrl = await window.electronAPI.readFilePreviewDataUrl(entry.path, 120)
          if (!cancelled && dataUrl) {
            results[entry.path] = dataUrl
          }
        } catch {
          // skip files that can't be previewed
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
    const totalSize = attachedFiles.reduce((sum, f) => sum + (f.size || 0), 0) +
      wdFiles.reduce((sum, e) => sum + (e.size || 0), 0)
    return { totalFiles, totalDirs, totalSize }
  }, [attachedFiles, visibleEntries])

  // ── Git-status Changes rail ──────────────────────────────────────────
  //
  // Reads real git branch + status from the session's working directory
  // using the getGitBranch / getGitStatus IPC channels.
  // ──────────────────────────────────────────────────────────────────────

  interface GitStatusData {
    branch: string | null
    files: GitFileEntry[]
  }

  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(initialGitStatus ?? null)
  const [gitLoading, setGitLoading] = useState(false)
  const gitAbortRef = useRef(false)

  const fetchGitStatus = useCallback(async (dirPath: string) => {
    if (typeof window === 'undefined' || !window.electronAPI?.getGitStatus || !window.electronAPI?.getGitBranch) return
    gitAbortRef.current = false
    setGitLoading(true)
    try {
      const [branch, statusResult] = await Promise.all([
        window.electronAPI.getGitBranch(dirPath),
        window.electronAPI.getGitStatus(dirPath),
      ])
      if (!gitAbortRef.current) {
        setGitStatus({
          branch,
          files: statusResult.files.map(f => ({
            path: f.path,
            name: f.path.split(/[/\\]/).pop() || f.path,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            bucket: f.bucket,
          })),
        })
      }
    } catch {
      if (!gitAbortRef.current) {
        setGitStatus(null)
      }
    } finally {
      if (!gitAbortRef.current) {
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

    if (typeof window === 'undefined' || !window.electronAPI?.getFileGitDiff) {
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

  const activeLabel = navItems.find((item) => item.id === activeView)?.label ?? activeView

  const handleNavigate = (view: ShellView) => {
    setActiveView(view)
    onNavigate?.(view)
  }

  // Render a single git-status row (icon, path, +/- badge, expand button,
  // optional diff panel). Used inside each bucket section below — collapsing
  // the duplicated JSX into one helper keeps the bucket sections tiny.
  const renderChangeItem = (file: GitFileEntry) => (
    <div key={diffKey(file)} className="arch-changes-item-wrap">
      <button
        type="button"
        className={`arch-changes-item ${diffFile === diffKey(file) ? 'arch-changes-item--expanded' : ''}`}
        onClick={() => handleDiffClick(file)}
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
              <ShikiDiffViewer
                original={diffOriginal ?? ''}
                modified={diffModified ?? ''}
                filePath={file.path}
                diffStyle="unified"
                disableFileHeader
                onFileHeaderClick={() => openFileLocation(
                  (workingDirectory?.replace(/\\/g, '/').replace(/\/+$/, '') ?? '') + '/' + file.path
                )}
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
            <img
              src={brandIconUrl}
              alt="ARCHstudio"
              className="layout-sidebar__brand"
              draggable={false}
            />
          )}
          <button
            type="button"
            className="layout-sidebar__toggle"
            onClick={() => setSidebarCollapsed((v) => !v)}
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

        <div className="layout-sidebar__footer" />
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
        </header>

        <main className="layout-content" role="main">
          {activeView === 'memory' ? (
            <MemoryPanel />
          ) : activeView === 'runs' ? (
            <RunsPanel />
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
                  {WORKSPACE_TABS.map((tab) => {
                    const isImplemented = tab.id === 'agent-chat'
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={activeWorkspaceTab === tab.id ? 'is-active' : ''}
                        onClick={() => setActiveWorkspaceTab(tab.id)}
                        aria-label={isImplemented ? tab.label : `${tab.label} (not yet implemented)`}
                        title={isImplemented ? tab.label : `${tab.label} — coming soon`}
                      >
                        {tab.label}
                      </button>
                    )
                  })}
                  {hasLiveSession && <span className="arch-agent-workspace__live"><i /> Live</span>}
                  <div className="layout-theme-toggle layout-theme-toggle--live titlebar-no-drag">
                    {([
                      { mode: 'light' as ThemeMode, icon: Sun, label: 'Light' },
                      { mode: 'dark' as ThemeMode, icon: Moon, label: 'Dark' },
                      { mode: 'system' as ThemeMode, icon: Monitor, label: 'System' },
                    ]).map(({ mode: m, icon: Icon, label }) => (
                      <button
                        key={m}
                        type="button"
                        className={`layout-theme-option ${theme === m ? 'layout-theme-option--active' : ''}`}
                        onClick={() => onThemeChange?.(m)}
                        aria-label={`${label} theme`}
                        title={label}
                      >
                        <Icon size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>                <div className="arch-agent-workspace__body">
                <div className="arch-agent-workspace__session">
                  {activeWorkspaceTab === 'agent-chat' ? (
                    children
                  ) : (
                    <div className="layout-placeholder">
                      <Construction size={48} />
                      <p>{WORKSPACE_TABS.find((t) => t.id === activeWorkspaceTab)?.label} view is not yet implemented.</p>
                    </div>
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
                              {sessionContext.sourceNames.map((name) => (
                                <span key={name}>{name}</span>
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
                            <span className="arch-file-list__count">{attachedFiles.length}</span>
                          )}
                        </label>
                        {activeSessionId && attachedFiles.length > 0 ? (
                          <div className="arch-file-list">
                            {attachedFiles.map((file) => (
                              <button
                                key={file.id}
                                type="button"
                                className="arch-file-item"
                                onClick={() => openFileLocation(file.storedPath)}
                                title={file.storedPath || file.name}
                              >
                                {file.type === 'image' && file.thumbnailBase64 ? (
                                  <span className="arch-file-item__thumb">
                                    <img
                                      src={`data:image/png;base64,${file.thumbnailBase64}`}
                                      alt=""
                                      loading="lazy"
                                      draggable={false}
                                    />
                                  </span>
                                ) : (
                                  <span
                                    className="arch-file-item__icon"
                                    style={{ color: getFileIconColor(file.type) }}
                                  >
                                    {getFileIcon(file.type)}
                                  </span>
                                )}
                                <div className="arch-file-item__info">
                                  <strong className="arch-file-item__name">{file.name}</strong>
                                  <span className="arch-file-item__meta">
                                    {formatFileSize(file.size)}
                                  </span>
                                </div>
                                <ExternalLink size={11} className="arch-file-item__open" />
                              </button>
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
                            <span className="arch-file-list__count">{visibleEntries.length}</span>
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
                            <div className="wd-files-list wd-files-tree">
                              {visibleEntries.map(({ entry, depth }) => (
                                <button
                                  key={entry.path}
                                  type="button"
                                  className={`wd-files-item ${entry.type === 'directory' ? 'wd-files-item--dir' : ''}`}
                                  style={{ paddingLeft: `${8 + depth * 16}px` }}
                                  onClick={() =>
                                    entry.type === 'directory'
                                      ? toggleExpand(entry.path)
                                      : openFileLocation(entry.path)
                                  }
                                  title={entry.path}
                                >
                                  {entry.type === 'directory' && (
                                    <span
                                      className={`wd-files-tree__arrow ${expandedPaths.has(entry.path) ? 'wd-files-tree__arrow--open' : ''}`}
                                    >
                                      <ChevronRight size={10} />
                                    </span>
                                  )}
                                  {entry.type === 'directory' ? (
                                    <span className="wd-files-item__icon" data-type="directory">
                                      <Folder size={14} />
                                    </span>
                                  ) : wdThumbnails[entry.path] ? (
                                    <span className="wd-files-item__thumb">
                                      <img
                                        src={wdThumbnails[entry.path]}
                                        alt=""
                                        loading="lazy"
                                        draggable={false}
                                      />
                                    </span>
                                  ) : (
                                    <span className="wd-files-item__icon" data-type="file">
                                      <File size={14} />
                                    </span>
                                  )}
                                  <div className="wd-files-item__info">
                                    <strong className="wd-files-item__name">{entry.name}</strong>
                                    {/* Git change status badge — shown for file entries regardless of size.
                                        A single path can have entries in 1–3 buckets (staged, unstaged,
                                        untracked). Priority: deleted > staged-add > untracked > modified. */}
                                    {entry.type === 'file' && (() => {
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
                                      // Any delete (staged or unstaged side) wins.
                                      if (staged === 'deleted' || unstaged === 'deleted') {
                                        return <span className="wd-files-item__change wd-files-item__change--deleted" title="Deleted">−</span>
                                      }
                                      // Pure untracked with no other changes → green +
                                      if (untracked === 'untracked' && !staged && !unstaged) {
                                        return <span className="wd-files-item__change wd-files-item__change--added" title="Untracked">+</span>
                                      }
                                      // Staged-only add (no further working-tree changes) → green +
                                      if (staged === 'added' && !unstaged) {
                                        return <span className="wd-files-item__change wd-files-item__change--added" title="Added">+</span>
                                      }
                                      // Staged and/or unstaged have any modification variant → amber ~
                                      return <span className="wd-files-item__change wd-files-item__change--modified" title="Modified">~</span>
                                    })()}
                                    {entry.type === 'file' && entry.size != null && (
                                      <span className="wd-files-item__meta">{formatFileSize(entry.size)}</span>
                                    )}
                                  </div>
                                </button>
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
