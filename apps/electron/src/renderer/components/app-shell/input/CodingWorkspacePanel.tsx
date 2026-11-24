/**
 * Where a new Coding session works, chosen right after Coding mode is turned on (inside the Coding
 * chip's popover):
 * - "Use existing folder": the OS folder picker (the server browser in remote mode).
 * - "Create new worktree": pick a repository (recent folders' repos, the workspace folder's repos,
 *   then the user's GitHub repos from `gh`), confirm the branch, and the workspace server creates a
 *   worktree from the remote's default branch (cloning a GitHub-only repo first). The new folder
 *   becomes the session's working directory.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FolderGit2, FolderOpen, GitBranchPlus, Github, Lock } from 'lucide-react'
import { toast } from 'sonner'
import type { GitHubRepo, LocalRepo, RepoListing } from '@craft-agent/shared/protocol'
import { Spinner } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getPathBasename } from '@/lib/platform'
import { getRecentWorkingDirs } from './working-directory-history'

type Repo = LocalRepo | GitHubRepo
type View = { name: 'choose' } | { name: 'repos' } | { name: 'confirm'; repo: Repo }

export interface CodingWorkspacePanelProps {
  workspaceId?: string
  sessionId?: string
  /** The session's current working folder (shown so dismissing reads as "keep it") */
  currentFolder?: string
  onUseExistingFolder: () => void
  onWorktreeCreated: (path: string) => void
  onClose: () => void
}

/** Default branch for the session's worktree: `craft/<session id>` (unique and traceable). */
export function defaultWorktreeBranch(sessionId?: string): string {
  return `craft/${(sessionId ?? 'session').replace(/[^A-Za-z0-9._-]+/g, '-')}`
}

function useRepoListing(workspaceId: string | undefined, active: boolean) {
  const [state, setState] = React.useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; listing?: RepoListing; error?: string }>({ status: 'idle' })
  React.useEffect(() => {
    if (!active || !workspaceId || !window.electronAPI?.listCodingRepos) return
    let cancelled = false
    setState(current => ({ ...current, status: current.listing ? 'ready' : 'loading' }))
    window.electronAPI.listCodingRepos(workspaceId, getRecentWorkingDirs(workspaceId)).then(
      (listing) => {
        if (!cancelled) setState({ status: 'ready', listing })
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [active, workspaceId])
  return state
}

export function CodingWorkspacePanel({ workspaceId, sessionId, currentFolder, onUseExistingFolder, onWorktreeCreated, onClose }: CodingWorkspacePanelProps) {
  const { t } = useTranslation()
  const [view, setView] = React.useState<View>({ name: 'choose' })
  const repos = useRepoListing(workspaceId, view.name !== 'choose')

  if (view.name === 'choose') {
    return (
      <div className="flex flex-col gap-1 p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-label font-medium text-foreground">{t('chat.codingMode.setup.title')}</p>
        <ChoiceRow
          icon={GitBranchPlus}
          title={t('chat.codingMode.setup.newWorktree')}
          hint={t('chat.codingMode.setup.newWorktreeHint')}
          onClick={() => setView({ name: 'repos' })}
          autoFocus
        />
        <ChoiceRow
          icon={FolderOpen}
          title={t('chat.codingMode.setup.existing')}
          hint={t('chat.codingMode.setup.existingHint')}
          onClick={() => {
            onClose()
            onUseExistingFolder()
          }}
        />
        {currentFolder && (
          <p className="truncate px-2 pt-1 pb-0.5 text-label-sm text-tertiary" title={currentFolder}>
            {t('chat.codingMode.setup.current', { folder: getPathBasename(currentFolder) })}
          </p>
        )}
      </div>
    )
  }

  if (view.name === 'repos') {
    return (
      <div className="flex flex-col">
        <PanelHeader title={t('chat.codingMode.repos.title')} onBack={() => setView({ name: 'choose' })} />
        <RepoPicker state={repos} onPick={(repo) => setView({ name: 'confirm', repo })} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <PanelHeader title={view.repo.kind === 'local' ? view.repo.name : view.repo.nameWithOwner} onBack={() => setView({ name: 'repos' })} />
      <CreateWorktreeForm
        repo={view.repo}
        workspaceId={workspaceId}
        cloneRoot={repos.listing?.cloneRoot ?? null}
        defaultBranch={defaultWorktreeBranch(sessionId)}
        onCreated={(path) => {
          onClose()
          onWorktreeCreated(path)
        }}
      />
    </div>
  )
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-1 border-b border-separator px-1.5 py-1.5">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        className="grid size-7 shrink-0 place-items-center rounded-md text-secondary hover:bg-fill-hover hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
      </button>
      <span className="min-w-0 truncate text-label font-medium text-foreground">{title}</span>
    </div>
  )
}

function ChoiceRow({ icon: Icon, title, hint, onClick, autoFocus }: { icon: typeof FolderOpen; title: string; hint: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus={autoFocus}
      className="flex items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-fill-hover focus-visible:bg-fill-hover -outline-offset-2"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="text-label text-foreground">{title}</span>
        <span className="text-label-sm text-tertiary">{hint}</span>
      </span>
    </button>
  )
}

function RepoPicker({ state, onPick }: { state: ReturnType<typeof useRepoListing>; onPick: (repo: Repo) => void }) {
  const { t } = useTranslation()
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex items-center gap-2 px-3 py-4 text-label-sm text-tertiary">
        <Spinner className="text-label-sm" />
        {t('chat.codingMode.repos.loading')}
      </div>
    )
  }
  if (state.status === 'error' || !state.listing) {
    return <p className="px-3 py-4 text-label-sm text-destructive">{state.error ?? t('chat.codingMode.repos.empty')}</p>
  }
  const { local, github, cloneRoot, githubUnavailable } = state.listing
  const recent = local.filter(repo => repo.origin === 'recent')
  const inWorkspace = local.filter(repo => repo.origin === 'workspace')
  // GitHub-only repos need somewhere to be cloned to
  const cloneable = cloneRoot ? github : []

  return (
    <Command className="bg-transparent" label={t('chat.codingMode.repos.title')}>
      <CommandInput placeholder={t('chat.codingMode.repos.search')} autoFocus />
      <CommandList className="max-h-[300px]">
        <CommandEmpty>{t('chat.codingMode.repos.empty')}</CommandEmpty>
        {recent.length > 0 && (
          <CommandGroup heading={t('chat.codingMode.repos.recent')}>
            {recent.map(repo => <LocalRepoItem key={repo.gitDir} repo={repo} onPick={onPick} />)}
          </CommandGroup>
        )}
        {inWorkspace.length > 0 && (
          <CommandGroup heading={t('chat.codingMode.repos.workspace')}>
            {inWorkspace.map(repo => <LocalRepoItem key={repo.gitDir} repo={repo} onPick={onPick} />)}
          </CommandGroup>
        )}
        {(cloneable.length > 0 || githubUnavailable) && (
          <CommandGroup heading={t('chat.codingMode.repos.github')}>
            {githubUnavailable ? (
              <p className="px-2 py-1.5 text-label-sm text-tertiary">
                {githubUnavailable === 'not-installed' ? t('chat.codingMode.repos.githubNotInstalled') : t('chat.codingMode.repos.githubSignedOut')}
              </p>
            ) : cloneable.map(repo => (
              <CommandItem key={repo.nameWithOwner} value={`${repo.nameWithOwner} ${repo.description ?? ''}`} onSelect={() => onPick(repo)}>
                <Github className="size-4 shrink-0 text-tertiary" />
                <span className="min-w-0 flex-1 truncate">{repo.nameWithOwner}</span>
                {repo.isPrivate && <Lock className="size-3.5 shrink-0 text-tertiary" aria-label={t('chat.codingMode.repos.private')} />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}

function LocalRepoItem({ repo, onPick }: { repo: LocalRepo; onPick: (repo: Repo) => void }) {
  const { t } = useTranslation()
  return (
    <CommandItem value={`${repo.name} ${repo.nameWithOwner ?? ''} ${repo.gitDir}`} onSelect={() => onPick(repo)}>
      <FolderGit2 className="size-4 shrink-0 text-tertiary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{repo.nameWithOwner ?? repo.name}</span>
        <span className="truncate text-label-sm text-tertiary" title={repo.worktreeParent}>{repo.worktreeParent}</span>
      </span>
      {repo.worktrees > 1 && (
        <span className="shrink-0 text-label-sm tabular-nums text-tertiary">{t('chat.codingMode.repos.worktrees', { count: repo.worktrees })}</span>
      )}
    </CommandItem>
  )
}

function CreateWorktreeForm({ repo, workspaceId, cloneRoot, defaultBranch, onCreated }: {
  repo: Repo
  workspaceId?: string
  cloneRoot: string | null
  defaultBranch: string
  onCreated: (path: string) => void
}) {
  const { t } = useTranslation()
  const [branch, setBranch] = React.useState(defaultBranch)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isClone = repo.kind === 'github'
  // The field was disabled while creating: give it focus back so the branch can be fixed right away
  React.useEffect(() => {
    if (error) inputRef.current?.focus()
  }, [error])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceId || !window.electronAPI?.createCodingWorktree || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.electronAPI.createCodingWorktree(
        workspaceId,
        repo.kind === 'local' ? { gitDir: repo.gitDir, branch } : { cloneNameWithOwner: repo.nameWithOwner, branch },
        getRecentWorkingDirs(workspaceId),
      )
      toast.success(t('chat.codingMode.create.done', { branch: result.branch }), { description: result.path })
      onCreated(result.path)
    } catch (err) {
      // The server's message is git's own reason ("a branch named … already exists")
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-label-sm font-medium text-secondary">{t('chat.codingMode.create.branch')}</span>
        <Input ref={inputRef} value={branch} onChange={(e) => setBranch(e.target.value)} disabled={busy} autoFocus spellCheck={false} className="font-mono text-mono-ui" />
      </label>
      <p className="text-label-sm text-tertiary break-all">
        {isClone
          ? t('chat.codingMode.create.clonesInto', { folder: cloneRoot ?? '' })
          : t('chat.codingMode.create.nextTo', { folder: (repo as LocalRepo).worktreeParent })}
      </p>
      {error && <p className={cn('rounded-md bg-destructive-tint px-2.5 py-1.5 text-label-sm text-destructive break-words')}>{error}</p>}
      <Button type="submit" size="sm" disabled={busy || !branch.trim()} className="w-full">
        {busy ? (
          <>
            <Spinner className="text-label-sm" />
            {isClone ? t('chat.codingMode.create.cloning') : t('chat.codingMode.create.creating')}
          </>
        ) : t('chat.codingMode.create.button')}
      </Button>
    </form>
  )
}
