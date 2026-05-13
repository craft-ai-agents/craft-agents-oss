import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileDiff, GitCommitHorizontal, GitPullRequestClosed, Loader2 } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { useAtom, useSetAtom } from 'jotai'
import type { GitCommit, GitStatusEntry } from '../../../shared/types'
import { openCommitTabAtom, openWorkingTreeDiffTabAtom } from '@/atoms/editor-tabs'
import { gitPanelCacheAtomFamily, type GitPanelCache } from '@/atoms/git-panel-cache'
import { cn } from '@/lib/utils'

const DEFAULT_STATUS_HEIGHT = 42
const MIN_STATUS_HEIGHT = 22
const MAX_STATUS_HEIGHT = 72

interface GitPanelProps {
  workspacePath?: string
  className?: string
}

type GitPanelFetchApi = Pick<typeof window.electronAPI, 'getGitStatus' | 'getGitLog'>

interface RefreshGitPanelCacheOptions {
  workspacePath: string
  cached: GitPanelCache
  api: GitPanelFetchApi
  setCache: (next: GitPanelCache) => void
  setIsLoading: (next: boolean) => void
  setIsRefreshing: (next: boolean) => void
  isCancelled: () => boolean
}

/**
 * Refreshes the git panel cache for one workspace using stale-while-revalidate semantics.
 */
export async function refreshGitPanelCache({
  workspacePath,
  cached,
  api,
  setCache,
  setIsLoading,
  setIsRefreshing,
  isCancelled,
}: RefreshGitPanelCacheOptions) {
  const isWarmCache = cached.hasLoaded

  setIsLoading(!isWarmCache)
  setIsRefreshing(isWarmCache)

  try {
    const [nextStatus, nextCommits] = await Promise.all([
      api.getGitStatus(workspacePath),
      api.getGitLog(workspacePath),
    ])
    if (isCancelled()) return
    setCache({
      hasLoaded: true,
      statusEntries: nextStatus,
      commits: nextCommits,
      error: null,
    })
  } catch (err) {
    if (isCancelled()) return
    const error = err instanceof Error ? err.message : 'Unable to load git data'
    setCache({
      hasLoaded: true,
      statusEntries: isWarmCache ? cached.statusEntries : [],
      commits: isWarmCache ? cached.commits : [],
      error,
    })
  } finally {
    if (!isCancelled()) {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }
}

function statusLabel(status: GitStatusEntry['status']): string {
  switch (status) {
    case 'staged':
      return 'Staged'
    case 'untracked':
      return 'Untracked'
    case 'deleted':
      return 'Deleted'
    default:
      return 'Modified'
  }
}

function statusClassName(status: GitStatusEntry['status']): string {
  switch (status) {
    case 'staged':
      return 'text-emerald-500'
    case 'untracked':
      return 'text-sky-500'
    case 'deleted':
      return 'text-rose-500'
    default:
      return 'text-amber-500'
  }
}

function shortRelativeDate(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  return `${formatDistanceToNowStrict(parsed, { roundingMethod: 'floor' })} ago`
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="h-8 px-3 flex items-center justify-between border-b border-border/50 text-[11px] font-medium uppercase text-muted-foreground tracking-[0.02em]">
      <span>{title}</span>
      {typeof count === 'number' && <span className="text-foreground/40">{count}</span>}
    </div>
  )
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="h-full flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  )
}

function renderStatusEntries(
  entries: GitStatusEntry[],
  onOpenDiff: (filePath: string) => void
) {
  return entries.map(entry => {
    const canOpenDiff = entry.status !== 'untracked'
    const content = (
      <>
        <FileDiff className={cn('h-3.5 w-3.5 shrink-0', statusClassName(entry.status))} />
        <span className="min-w-0 flex-1 truncate">{entry.path}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{statusLabel(entry.status)}</span>
      </>
    )

    if (!canOpenDiff) {
      return (
        <div
          key={`${entry.status}:${entry.path}`}
          className="h-7 px-3 flex items-center gap-2 text-xs"
          title={entry.path}
        >
          {content}
        </div>
      )
    }

    return (
      <button
        key={`${entry.status}:${entry.path}`}
        type="button"
        className="h-7 w-full px-3 flex items-center gap-2 text-left text-xs hover:bg-sidebar-hover focus-visible:bg-sidebar-hover focus-visible:outline-none"
        title={entry.path}
        onClick={() => onOpenDiff(entry.path)}
      >
        {content}
      </button>
    )
  })
}

function renderStatusBody(
  entries: GitStatusEntry[],
  noRepository: boolean,
  onOpenDiff: (filePath: string) => void
) {
  if (noRepository) return <EmptyState>No git repository found</EmptyState>
  if (entries.length === 0) return <EmptyState>No working tree changes</EmptyState>
  return renderStatusEntries(entries, onOpenDiff)
}

function GitStatusSection({
  entries,
  noRepository,
  onOpenDiff,
}: {
  entries: GitStatusEntry[]
  noRepository: boolean
  onOpenDiff: (filePath: string) => void
}) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <SectionHeader title="Working Tree" count={noRepository ? undefined : entries.length} />
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {renderStatusBody(entries, noRepository, onOpenDiff)}
      </div>
    </div>
  )
}

function renderCommits(commits: GitCommit[], onOpenCommit: (hash: string) => void) {
  return commits.map(commit => (
    <button
      key={commit.hash}
      type="button"
      className="w-full px-3 py-2 text-left hover:bg-sidebar-hover focus-visible:bg-sidebar-hover focus-visible:outline-none"
      title={`${commit.shortHash} ${commit.message}`}
      onClick={() => onOpenCommit(commit.hash)}
    >
      <div className="flex items-center gap-2 text-xs">
        <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground">{commit.message}</span>
      </div>
      <div className="mt-1 pl-5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono">{commit.shortHash}</span>
        <span className="truncate">{commit.author}</span>
        <span className="shrink-0">{shortRelativeDate(commit.date)}</span>
      </div>
    </button>
  ))
}

function renderHistoryBody(
  commits: GitCommit[],
  noRepository: boolean,
  onOpenCommit: (hash: string) => void
) {
  if (noRepository) return <EmptyState>No git repository found</EmptyState>
  if (commits.length === 0) return <EmptyState>No commits yet</EmptyState>
  return renderCommits(commits, onOpenCommit)
}

function GitHistorySection({
  commits,
  noRepository,
  onOpenCommit,
}: {
  commits: GitCommit[]
  noRepository: boolean
  onOpenCommit: (hash: string) => void
}) {
  return (
    <div className="h-full min-h-0 flex flex-col">
      <SectionHeader title="History" count={noRepository ? undefined : commits.length} />
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {renderHistoryBody(commits, noRepository, onOpenCommit)}
      </div>
    </div>
  )
}

export function GitPanel({ workspacePath, className }: GitPanelProps) {
  const openWorkingTreeDiffTab = useSetAtom(openWorkingTreeDiffTabAtom)
  const openCommitTab = useSetAtom(openCommitTabAtom)
  const cacheAtom = useMemo(() => gitPanelCacheAtomFamily(workspacePath ?? ''), [workspacePath])
  const [cache, setCache] = useAtom(cacheAtom)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusHeight, setStatusHeight] = useState(DEFAULT_STATUS_HEIGHT)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const cacheRef = useRef(cache)

  useEffect(() => {
    cacheRef.current = cache
  }, [cache])

  useEffect(() => {
    let cancelled = false
    if (!workspacePath) {
      setIsLoading(false)
      setIsRefreshing(false)
      return () => {
        cancelled = true
      }
    }

    void refreshGitPanelCache({
      workspacePath,
      cached: cacheRef.current,
      api: window.electronAPI,
      setCache,
      setIsLoading,
      setIsRefreshing,
      isCancelled: () => cancelled,
    })

    return () => {
      cancelled = true
    }
  }, [setCache, workspacePath])

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startHeight: statusHeight }

    const handleMouseMove = (ev: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const delta = ev.clientY - drag.startY
      const next = Math.min(MAX_STATUS_HEIGHT, Math.max(MIN_STATUS_HEIGHT, drag.startHeight + delta / 4))
      setStatusHeight(next)
    }

    const handleMouseUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [statusHeight])

  const { statusEntries, commits, error } = cache
  const hasVisibleCachedData = statusEntries.length > 0 || commits.length > 0
  const showLoading = !!workspacePath && (isLoading || !cache.hasLoaded)
  const noRepository = !!workspacePath && cache.hasLoaded && !showLoading && !error && !hasVisibleCachedData

  const handleOpenDiff = useCallback((filePath: string) => {
    if (!workspacePath) return
    void openWorkingTreeDiffTab({ workspacePath, filePath })
  }, [openWorkingTreeDiffTab, workspacePath])

  const handleOpenCommit = useCallback((hash: string) => {
    if (!workspacePath) return
    void openCommitTab({ workspacePath, hash })
  }, [openCommitTab, workspacePath])

  if (!workspacePath) {
    return (
      <div className={cn('h-full bg-background', className)}>
        <EmptyState>No working directory set</EmptyState>
      </div>
    )
  }

  if (showLoading) {
    return (
      <div className={cn('h-full bg-background flex items-center justify-center text-muted-foreground', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  if (error && !hasVisibleCachedData) {
    return (
      <div className={cn('h-full bg-background', className)}>
        <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
          <GitPullRequestClosed className="h-4 w-4 text-destructive" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('h-full min-h-0 bg-background flex flex-col', className)}>
      {isRefreshing && (
        <div className="h-0.5 shrink-0 overflow-hidden bg-muted">
          <div className="h-full w-full animate-pulse bg-muted-foreground/30" />
        </div>
      )}
      {error && (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="min-h-0" style={{ height: `${statusHeight}%` }}>
        <GitStatusSection
          entries={statusEntries}
          noRepository={noRepository}
          onOpenDiff={handleOpenDiff}
        />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group"
        onMouseDown={handleDividerMouseDown}
      >
        <div className="h-px w-full bg-border/50 group-hover:bg-ring transition-colors" />
      </div>
      <div className="min-h-0 flex-1">
        <GitHistorySection
          commits={commits}
          noRepository={noRepository}
          onOpenCommit={handleOpenCommit}
        />
      </div>
    </div>
  )
}
