/**
 * Which repositories a new Coding session can start a worktree from: the repos of recently used
 * working folders first, then every git repo found under the folders code lives in, which are the
 * workspace's default folder and the folder holding each recent repo (`~/code` for `~/code/app`
 * or `~/code/app/.bare`). Every worktree of a repository (a bare-repo layout can have dozens)
 * collapses into one entry, keyed by its shared git dir. Read-only: git is asked, nothing is changed.
 *
 * The scan (`findRepoDirs`) is breadth-first and bounded by depth, folder count and time. It stops
 * at each repo (nested and vendored repos are not entered), never follows symlinks, and skips
 * `node_modules`, macOS `Library`, every Craft workspace's data folder (`skipDirs`) and hidden
 * folders, which it only checks for being a bare repo (`.bare`).
 */

import type { Dirent } from 'node:fs'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve, sep } from 'node:path'
import type { LocalRepo } from '@craft-agent/shared/protocol'
import { runGit } from '../git'
import { parseRemoteUrl } from '../pr-watch/remote-url'

/** Levels below a scan root that are looked into (`<org>/<repo>` is 2, a bare layout's `.bare` 2) */
export const SCAN_DEPTH = 4
/** Folders read per listing, all roots together */
export const SCAN_MAX_DIRS = 20_000
/** Time budget per listing; what was found by then is kept */
export const SCAN_BUDGET_MS = 2_000
/** Folder names never entered (hidden folders are only checked for being a bare repo) */
const SKIP_NAMES = new Set(['node_modules', 'Library'])
const CONCURRENCY = 8

export interface DiscoverInput {
  /** The workspace's default working directory (may be unset or missing), already `~`-expanded */
  workspaceFolder?: string
  /** Recently used working folders, most recent first */
  recentDirs?: readonly string[]
  /** Folders never scanned: Craft workspace data folders (sessions, sources), which hold no code */
  skipDirs?: readonly string[]
}

/** A shared git dir for `dir` (a work tree, a subfolder of one, or a bare repo), or null. */
export async function commonGitDir(dir: string): Promise<string | null> {
  const out = await runGit(dir, ['rev-parse', '--git-common-dir'])
  if (!out) return null
  const absolute = resolve(dir, out)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

/** The folder git commands for a repository run in: the main work tree, or the bare repo itself. */
export function repoCommandDir(gitDir: string): string {
  return basename(gitDir) === '.git' ? dirname(gitDir) : gitDir
}

/**
 * Where new worktrees go: next to the main work tree of a plain clone (`~/code/app` →
 * `~/code/app-<branch>`), or next to the bare repo in a bare layout (`~/code/app/.bare` →
 * `~/code/app/<branch>`), matching how both layouts are usually organised.
 */
export function worktreeParentFor(gitDir: string): string {
  return basename(gitDir) === '.git' ? dirname(dirname(gitDir)) : dirname(gitDir)
}

/**
 * The folder a repository lives in, where its neighbours usually are: `~/code` for a plain clone
 * (`~/code/app/.git`), a bare layout (`~/code/app/.bare`) and a bare repo (`~/code/app.git`).
 */
export function repoHome(gitDir: string): string {
  const name = basename(gitDir)
  const repoFolder = name === '.git' || name.startsWith('.') ? dirname(gitDir) : gitDir
  return dirname(repoFolder)
}

function realpathOr(dir: string): string {
  try {
    return realpathSync(dir)
  } catch {
    return resolve(dir)
  }
}

function isInside(dir: string, parent: string): boolean {
  return dir === parent || dir.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

export interface ScanRoot {
  dir: string
  /** Levels below `dir` that are looked into */
  depth: number
}

/**
 * Where to look for repositories: the workspace's default folder and the home of each recent repo,
 * once each, never inside a skipped (workspace data) folder. The user's home folder and a disk root
 * are only looked at one level deep, like the default folder used to be.
 */
export function scanRoots(input: { workspaceFolder?: string; recentGitDirs: readonly string[]; skipDirs: readonly string[]; home?: string }): ScanRoot[] {
  const home = input.home ?? homedir()
  const candidates = [input.workspaceFolder, ...input.recentGitDirs.map(repoHome)].filter((dir): dir is string => !!dir)
  const roots: ScanRoot[] = []
  for (const dir of new Set(candidates)) {
    if (input.skipDirs.some(skip => isInside(dir, skip))) continue
    roots.push({ dir, depth: dir === home || dir === parse(dir).root ? 1 : SCAN_DEPTH })
  }
  return roots
}

/** What a folder's listing says it is: a work tree (a `.git` folder or file), a bare repo, or neither. */
function isRepoListing(entries: readonly Dirent[]): boolean {
  let head = false
  let objects = false
  for (const entry of entries) {
    if (entry.name === '.git') return true
    if (entry.name === 'HEAD' && entry.isFile()) head = true
    if (entry.name === 'objects' && entry.isDirectory()) objects = true
  }
  return head && objects
}

/**
 * Repository folders under `roots`, breadth-first (see the module comment). Overlapping roots are
 * read once. Bounded by `SCAN_DEPTH` per root, `SCAN_MAX_DIRS` and `SCAN_BUDGET_MS` overall; the
 * order of the result is not meaningful.
 */
export async function findRepoDirs(roots: readonly ScanRoot[], skipDirs: readonly string[] = [], now: () => number = Date.now): Promise<string[]> {
  const skip = new Set(skipDirs)
  const deadline = now() + SCAN_BUDGET_MS
  const seen = new Set<string>()
  const found: string[] = []
  /** `left`: levels still to enter below `dir`; `probe`: a hidden folder, only checked for a bare repo */
  let level = roots.map(root => ({ dir: root.dir, left: root.depth, probe: false }))
  let read = 0
  while (level.length > 0 && read < SCAN_MAX_DIRS && now() < deadline) {
    const batch: typeof level = []
    for (const item of level) {
      if (seen.has(item.dir) || skip.has(item.dir)) continue
      seen.add(item.dir)
      batch.push(item)
      if (read + batch.length >= SCAN_MAX_DIRS) break
    }
    read += batch.length
    const next: typeof level = []
    await mapLimited(batch, CONCURRENCY, async (item) => {
      let entries: Dirent[]
      try {
        entries = await readdir(item.dir, { withFileTypes: true })
      } catch {
        return
      }
      if (isRepoListing(entries)) {
        found.push(item.dir)
        return
      }
      if (item.probe || item.left <= 0) return
      for (const entry of entries) {
        // Dirent.isDirectory() is false for symlinks, so links are never followed (no cycles)
        if (!entry.isDirectory() || SKIP_NAMES.has(entry.name)) continue
        const dir = join(item.dir, entry.name)
        next.push(entry.name.startsWith('.') ? { dir, left: 0, probe: true } : { dir, left: item.left - 1, probe: false })
      }
    })
    level = next
  }
  return found
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function describeRepo(gitDir: string, origin: LocalRepo['origin']): Promise<LocalRepo> {
  const dir = repoCommandDir(gitDir)
  const [originUrl, worktreeList] = await Promise.all([
    runGit(dir, ['config', '--get', 'remote.origin.url']),
    runGit(dir, ['worktree', 'list', '--porcelain']),
  ])
  const coords = originUrl ? parseRemoteUrl(originUrl) : null
  // `worktree list` includes a bare repo itself as an entry marked "bare"
  const blocks = (worktreeList ?? '').split('\n\n').filter(block => block.startsWith('worktree '))
  const worktrees = blocks.filter(block => !block.split('\n').includes('bare')).length
  const folderName = basename(gitDir) === '.git' || basename(gitDir) === '.bare' ? basename(dirname(gitDir)) : basename(gitDir).replace(/\.git$/, '')
  return {
    kind: 'local',
    name: coords?.repo ?? folderName,
    nameWithOwner: coords ? `${coords.owner}/${coords.repo}` : undefined,
    gitDir,
    worktreeParent: worktreeParentFor(gitDir),
    worktrees,
    origin,
  }
}

export async function discoverLocalRepos({ workspaceFolder, recentDirs = [], skipDirs = [] }: DiscoverInput): Promise<LocalRepo[]> {
  const recent = recentDirs.filter(dir => {
    try {
      return statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
  const recentGitDirs = (await mapLimited(recent, CONCURRENCY, commonGitDir)).filter((dir): dir is string => !!dir)

  const skip = skipDirs.map(realpathOr)
  const folder = workspaceFolder && existsSync(workspaceFolder) ? realpathOr(workspaceFolder) : undefined
  const roots = scanRoots({ workspaceFolder: folder, recentGitDirs, skipDirs: skip })
  const scannedGitDirs = await mapLimited(await findRepoDirs(roots, skip), CONCURRENCY, commonGitDir)

  // Recent repos first (in recency order), then the scanned ones by path, each repository once
  const ordered = new Map<string, LocalRepo['origin']>()
  for (const gitDir of recentGitDirs) if (!ordered.has(gitDir)) ordered.set(gitDir, 'recent')
  const scannedOnly = [...new Set(scannedGitDirs.filter((d): d is string => !!d && !ordered.has(d)))].sort((a, b) => a.localeCompare(b))
  for (const gitDir of scannedOnly) ordered.set(gitDir, 'workspace')

  return mapLimited([...ordered], CONCURRENCY, ([gitDir, origin]) => describeRepo(gitDir, origin))
}

/**
 * Where a GitHub repo is cloned: the folder most local repositories live in (`repoHome`), else the
 * workspace folder, else none (the picker then hides GitHub-only repos rather than guess).
 */
export function cloneRootFor(repos: readonly LocalRepo[], workspaceFolder: string | undefined, workspaceRoot: string | undefined): string | null {
  const counts = new Map<string, number>()
  for (const repo of repos) {
    const home = repoHome(repo.gitDir)
    counts.set(home, (counts.get(home) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (best) return best
  // The workspace's own data folder is not a place for code
  if (workspaceFolder && workspaceFolder !== workspaceRoot && existsSync(workspaceFolder)) return workspaceFolder
  return null
}
