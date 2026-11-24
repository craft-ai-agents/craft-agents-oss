/**
 * Local git for the PR watcher: which repo/branch/remote a working directory is on, whether local
 * work is missing from the PR, and a watcher on the refs that move when you commit, switch branches
 * or push. Async `execFile` (no shell), short timeouts; failures read as "unknown", never throw.
 */

import { watch, type FSWatcher } from 'node:fs'
import { join, resolve } from 'node:path'
import { runGit } from '../git'
import { parseRemoteUrl, type RepoCoordinates } from './remote-url'

export interface RepoInfo {
  /** Working tree root */
  root: string
  /** This worktree's git dir (holds HEAD) */
  gitDir: string
  /** Shared git dir (holds refs, packed-refs); equals gitDir outside linked worktrees */
  commonDir: string
  /** Local branch; null on a detached HEAD */
  branch: string | null
  /** Remote the branch pushes to, and the branch name there (what GitHub calls headRefName) */
  pushRemote: string | null
  remoteBranch: string | null
  /** The push remote's repository, when it is a recognizable git host URL */
  repo: RepoCoordinates | null
  /** An `upstream` remote's repository (fork workflow), if any */
  upstreamRepo: RepoCoordinates | null
}

/** null when `dir` is not inside a git work tree. */
export async function resolveRepo(dir: string): Promise<RepoInfo | null> {
  // No `--path-format=absolute` (git ≥ 2.31 only, missing on older LTS distros): --git-dir and
  // --git-common-dir may come back relative to `dir`, so they are resolved against it below.
  const paths = await runGit(dir, ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'])
  const [root, gitDir, commonDir] = paths?.split('\n') ?? []
  if (!root || !gitDir || !commonDir) return null

  const branch = await runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  let pushRemote: string | null = null
  let remoteBranch: string | null = null
  if (branch) {
    // `@{push}` honours pushRemote/pushDefault/push.default; fall back to the tracking config
    const push = await runGit(dir, ['rev-parse', '--abbrev-ref', `${branch}@{push}`])
    const remotes = (await runGit(dir, ['remote']))?.split('\n') ?? []
    const pushRemoteName = push ? remotes.find(name => push.startsWith(`${name}/`)) : undefined
    if (push && pushRemoteName) {
      pushRemote = pushRemoteName
      remoteBranch = push.slice(pushRemoteName.length + 1)
    } else {
      pushRemote = (await runGit(dir, ['config', '--get', `branch.${branch}.remote`])) ?? (remotes.includes('origin') ? 'origin' : remotes[0] ?? null)
      const merge = await runGit(dir, ['config', '--get', `branch.${branch}.merge`])
      remoteBranch = merge?.replace(/^refs\/heads\//, '') ?? branch
    }
  }

  const repoUrl = pushRemote ? await runGit(dir, ['remote', 'get-url', pushRemote]) : null
  const upstreamUrl = pushRemote !== 'upstream' ? await runGit(dir, ['remote', 'get-url', 'upstream']) : null

  return {
    root: resolve(root),
    gitDir: resolve(dir, gitDir),
    commonDir: resolve(dir, commonDir),
    branch,
    pushRemote,
    remoteBranch,
    repo: repoUrl ? parseRemoteUrl(repoUrl) : null,
    upstreamRepo: upstreamUrl ? parseRemoteUrl(upstreamUrl) : null,
  }
}

export interface LocalStatus {
  /** Commits on HEAD that the PR head doesn't have */
  localAhead: number
  /** Uncommitted changes, untracked files included (ignored files are not) */
  localDirty: boolean
}

export async function localStatus(dir: string, prHeadOid: string | null): Promise<LocalStatus> {
  const porcelain = await runGit(dir, ['status', '--porcelain=v1', '--untracked-files=normal'])
  let ahead: string | null = null
  // The PR head is exact; when it isn't in the local object store (not fetched), compare with the
  // remote-tracking branch instead
  for (const base of [prHeadOid, '@{push}', '@{upstream}']) {
    if (!base) continue
    ahead = await runGit(dir, ['rev-list', '--count', `${base}..HEAD`])
    if (ahead !== null) break
  }
  return { localAhead: Number(ahead ?? 0) || 0, localDirty: porcelain !== null }
}

/**
 * Calls `onChange` (debounced) when HEAD, the branch's ref or its remote-tracking ref moves: a
 * commit, checkout, reset, fetch or push. The index and worktree are not watched (every `git status`
 * touches the index). Returns a disposer; watch errors just mean no instant refresh (polling remains).
 */
export function watchRefs(repo: RepoInfo, onChange: () => void, debounceMs = 1_000): () => void {
  const watchers: FSWatcher[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, debounceMs)
  }
  const relevantRefs = new Set<string>()
  if (repo.branch) relevantRefs.add(join('heads', repo.branch))
  if (repo.pushRemote && repo.remoteBranch) relevantRefs.add(join('remotes', repo.pushRemote, repo.remoteBranch))

  const tryWatch = (path: string, recursive: boolean, filter: (name: string) => boolean) => {
    try {
      const watcher = watch(path, { recursive, persistent: false }, (_event, name) => {
        if (name && filter(name.toString())) fire()
      })
      watcher.on('error', () => watcher.close())
      watchers.push(watcher)
    } catch {
      // Directory missing or watching unsupported: polling still covers it
    }
  }

  tryWatch(repo.gitDir, false, name => name === 'HEAD')
  tryWatch(repo.commonDir, false, name => name === 'packed-refs' || (repo.commonDir === repo.gitDir && name === 'HEAD'))
  tryWatch(join(repo.commonDir, 'refs'), true, name => relevantRefs.has(name.replace(/\.lock$/, '')))

  return () => {
    if (timer) clearTimeout(timer)
    for (const watcher of watchers) watcher.close()
  }
}
