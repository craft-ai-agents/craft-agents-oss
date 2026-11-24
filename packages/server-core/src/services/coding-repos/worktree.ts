/**
 * Creates the worktree a new Coding session works in: a new branch from the remote's default branch
 * (fetched first when possible), in a folder next to the repository's other work trees. A GitHub-only
 * repository is cloned with `gh` first. Never touches existing branches or folders.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { CreateWorktreeRequest, CreateWorktreeResult } from '@craft-agent/shared/protocol'
import { runGit, runGitResult } from '../git'
import { commonGitDir, repoCommandDir, worktreeParentFor } from './discover'
import { isValidNameWithOwner } from './github'

const FETCH_TIMEOUT_MS = 60_000
const CLONE_TIMEOUT_MS = 10 * 60_000

export class WorktreeError extends Error {
  constructor(message: string, readonly code: 'invalid-branch' | 'not-a-repo' | 'invalid-repo' | 'clone-failed' | 'git-failed' | 'no-clone-root') {
    super(message)
    this.name = 'WorktreeError'
  }
}

/** The folder-name part a branch contributes: its last segment, safe for every file system. */
export function branchSlug(branch: string): string {
  return (branch.split('/').pop() ?? branch).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '') || 'worktree'
}

/**
 * The new worktree's folder: `<repo>-<slug>` next to a plain clone, `<slug>` inside a bare layout
 * (whose siblings are all worktrees of the one repo); `-2`, `-3`… when taken.
 */
export function worktreePath(gitDir: string, branch: string, exists: (path: string) => boolean = existsSync): string {
  const parent = worktreeParentFor(gitDir)
  const slug = branchSlug(branch)
  const base = basename(gitDir) === '.git' ? `${basename(repoCommandDir(gitDir))}-${slug}` : slug
  let candidate = join(parent, base)
  for (let n = 2; exists(candidate); n++) candidate = join(parent, `${base}-${n}`)
  return candidate
}

/** What to branch from: the remote's default branch, refreshed when the network allows. */
async function resolveBase(dir: string): Promise<string> {
  const remoteHead = await runGit(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const candidates = remoteHead ? [remoteHead] : ['origin/main', 'origin/master']
  for (const ref of candidates) {
    const branch = ref.replace(/^origin\//, '')
    // Best effort: offline or no access still leaves the last fetched state usable
    await runGitResult(dir, ['fetch', '--quiet', 'origin', branch], FETCH_TIMEOUT_MS)
    if (await runGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref
  }
  return (await runGit(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) ?? 'HEAD'
}

function ghClone(nameWithOwner: string, target: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((done) => {
    execFile('gh', ['repo', 'clone', nameWithOwner, target], { timeout: CLONE_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
      done({ ok: !error, message: String(stderr).trim() || (error?.message ?? '') })
    })
  })
}

/** git's reason from its stderr: the `fatal:`/`error:` lines without the prefix, not its progress chatter. */
export function gitReason(stderr: string): string {
  const reasons = stderr.split('\n').map(line => line.trim()).filter(line => /^(fatal|error):/i.test(line))
  return (reasons.length ? reasons : [stderr.trim()]).map(line => line.replace(/^(fatal|error):\s*/i, '')).join('\n')
}

export async function createWorktree(request: CreateWorktreeRequest, { cloneRoot }: { cloneRoot: string | null }): Promise<CreateWorktreeResult> {
  const branch = request.branch.trim()
  // `check-ref-format --branch` is git's own rule for branch names (no "..", no spaces, no leading "-")
  if (!branch || branch.startsWith('-') || !(await runGit(homedir(), ['check-ref-format', '--branch', branch]))) {
    throw new WorktreeError(`"${branch}" is not a valid branch name`, 'invalid-branch')
  }

  let gitDir: string | null = null
  let cloned = false
  if (request.cloneNameWithOwner) {
    if (!isValidNameWithOwner(request.cloneNameWithOwner)) throw new WorktreeError('Invalid repository name', 'invalid-repo')
    if (!cloneRoot) throw new WorktreeError('No folder to clone into: open a local repository once, or set the workspace folder', 'no-clone-root')
    const target = join(cloneRoot, request.cloneNameWithOwner.split('/')[1]!)
    if (existsSync(target)) {
      // Reuse an earlier clone of the same repository; never clone into an unrelated folder
      gitDir = await commonGitDir(target)
      const url = gitDir ? await runGit(repoCommandDir(gitDir), ['config', '--get', 'remote.origin.url']) : null
      if (!gitDir || !url?.toLowerCase().includes(request.cloneNameWithOwner.toLowerCase())) {
        throw new WorktreeError(`${target} already exists and is not a clone of ${request.cloneNameWithOwner}`, 'clone-failed')
      }
    } else {
      const result = await ghClone(request.cloneNameWithOwner, target)
      if (!result.ok) throw new WorktreeError(result.message || 'gh repo clone failed', 'clone-failed')
      gitDir = await commonGitDir(target)
      cloned = true
    }
  } else if (request.gitDir) {
    gitDir = await commonGitDir(request.gitDir)
  }
  if (!gitDir) throw new WorktreeError('Not a git repository', 'not-a-repo')

  const dir = repoCommandDir(gitDir)
  const base = await resolveBase(dir)
  const path = worktreePath(gitDir, branch)
  const added = await runGitResult(dir, ['worktree', 'add', '-b', branch, path, base], FETCH_TIMEOUT_MS)
  if (!added.ok) throw new WorktreeError(gitReason(added.stderr) || 'git worktree add failed', 'git-failed')
  return { path, branch, base, cloned }
}
