import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneRootFor, discoverLocalRepos, findRepoDirs, SCAN_DEPTH, scanRoots } from './discover'
import { isValidNameWithOwner, parseGhRepoList } from './github'
import { branchSlug, createWorktree, gitReason, worktreePath, WorktreeError } from './worktree'

let base: string
let workspace: string
let plain: string
let bareLayout: string
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim()

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'coding-repos-')))
  workspace = join(base, 'code')
  mkdirSync(workspace)
  // An "upstream" with main + a remote HEAD, so clones get origin/HEAD
  const upstream = join(base, 'upstream.git')
  git(base, 'init', '--bare', '-b', 'main', upstream)
  const seed = join(base, 'seed')
  git(base, 'clone', upstream, seed)
  writeFileSync(join(seed, 'a.txt'), 'a')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'init')
  git(seed, 'push', 'origin', 'HEAD:main')

  // 1. A plain clone in the workspace folder, origin pointing at GitHub
  plain = join(workspace, 'app')
  git(base, 'clone', upstream, plain)
  git(plain, 'remote', 'set-url', '--push', 'origin', 'git@github.com:acme/app.git')
  // 2. A bare layout with two worktrees, outside the workspace (found through a recent folder)
  bareLayout = join(base, 'layout')
  mkdirSync(bareLayout)
  git(bareLayout, 'clone', '--bare', upstream, '.bare')
  git(join(bareLayout, '.bare'), 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
  git(join(bareLayout, '.bare'), 'fetch', 'origin')
  git(join(bareLayout, '.bare'), 'worktree', 'add', join(bareLayout, 'one'), '-b', 'one', 'origin/main')
  git(join(bareLayout, '.bare'), 'worktree', 'add', join(bareLayout, 'two'), '-b', 'two', 'origin/main')
  // 3. Noise: a plain folder
  mkdirSync(join(workspace, 'notes'))
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('discoverLocalRepos', () => {
  it('lists recent repos first, then the ones found under the workspace folder and next to recent repos', async () => {
    const repos = await discoverLocalRepos({
      workspaceFolder: workspace,
      recentDirs: [join(bareLayout, 'two'), join(bareLayout, 'one'), join(base, 'gone')],
    })
    // The bare layout's worktrees collapse into one entry; its home (`base`) also holds `seed` and the
    // `upstream.git` bare repo, found next to it
    expect(repos.map(r => [r.name, r.origin, r.worktrees])).toEqual([
      ['layout', 'recent', 2],
      ['app', 'workspace', 1],
      ['seed', 'workspace', 1],
      ['upstream', 'workspace', 0],
    ])
    expect(repos[0]!.gitDir).toBe(join(bareLayout, '.bare'))
    expect(repos[0]!.worktreeParent).toBe(bareLayout)
    expect(repos[1]!.worktreeParent).toBe(workspace)
  })

  it('never scans a workspace data folder', async () => {
    expect(await discoverLocalRepos({ workspaceFolder: workspace, skipDirs: [workspace] })).toEqual([])
    expect(await discoverLocalRepos({ workspaceFolder: workspace, skipDirs: [base] })).toEqual([])
  })

  it('names a repo after its origin when the origin is on a git host', async () => {
    git(plain, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git')
    const [repo] = await discoverLocalRepos({ workspaceFolder: workspace })
    expect(repo).toMatchObject({ name: 'app', nameWithOwner: 'acme/app' })
    git(plain, 'remote', 'set-url', 'origin', join(base, 'upstream.git'))
  })

  it('copes with a missing workspace folder', async () => {
    expect(await discoverLocalRepos({ workspaceFolder: join(base, 'nope') })).toEqual([])
  })
})

describe('findRepoDirs', () => {
  it('finds nested repos breadth-first and skips what holds no code of its own', async () => {
    // Its own folder: the other tests scan `base`
    const scan = realpathSync(mkdtempSync(join(tmpdir(), 'coding-repos-scan-')))
    const init = (...parts: string[]) => {
      const dir = join(scan, ...parts)
      mkdirSync(dir, { recursive: true })
      git(dir, 'init', '-q')
      return dir
    }
    const deep = init('org', 'deep-repo') // 2 levels down
    const edge = init('w', 'x', 'y', 'edge-repo') // SCAN_DEPTH levels down: still found
    init('a', 'b', 'c', 'd', 'too-deep') // one level past SCAN_DEPTH
    init('node_modules', 'pkg')
    init('Library', 'thing')
    init('.hidden', 'repo') // hidden folders are only checked for being a bare repo
    const outer = init('outer')
    init('outer', 'vendor', 'inner') // inside a repo: not entered
    init('data-ws', 'sessions', 's1', 'clone') // a workspace data folder: skipped
    const bare = join(scan, 'layout', '.bare')
    mkdirSync(join(scan, 'layout'))
    git(base, 'init', '-q', '--bare', bare)
    symlinkSync(join(scan, 'org'), join(scan, 'link')) // never followed
    expect(SCAN_DEPTH).toBe(4)

    try {
      const found = await findRepoDirs([{ dir: scan, depth: SCAN_DEPTH }], [join(scan, 'data-ws')])
      expect(found.sort()).toEqual([bare, deep, outer, edge].sort())
    } finally {
      rmSync(scan, { recursive: true, force: true })
    }
  })

  it('stops when the time budget runs out', async () => {
    let clock = 0
    const found = await findRepoDirs([{ dir: workspace, depth: SCAN_DEPTH }], [], () => (clock += 10_000))
    expect(found).toEqual([])
  })
})

describe('scanRoots', () => {
  const home = '/Users/me'

  it("scans the workspace folder and each recent repo's home once, the home folder itself shallowly", () => {
    expect(scanRoots({
      workspaceFolder: '/Users/me/code',
      recentGitDirs: ['/Users/me/code/app/.git', '/Users/me/work/layout/.bare', '/Users/me/code/lib.git', '/Users/me/solo/.git'],
      skipDirs: [],
      home,
    })).toEqual([
      { dir: '/Users/me/code', depth: SCAN_DEPTH },
      { dir: '/Users/me/work', depth: SCAN_DEPTH },
      { dir: '/Users/me', depth: 1 },
    ])
  })

  it('drops roots inside workspace data folders', () => {
    expect(scanRoots({ workspaceFolder: '/Users/me/Workspace/CraftAgentWS', recentGitDirs: [], skipDirs: ['/Users/me/Workspace/CraftAgentWS'], home })).toEqual([])
    expect(scanRoots({ workspaceFolder: '/Users/me/ws/sessions', recentGitDirs: [], skipDirs: ['/Users/me/ws'], home })).toEqual([])
    expect(scanRoots({ workspaceFolder: '/Users/me/ws-other', recentGitDirs: [], skipDirs: ['/Users/me/ws'], home })).toEqual([{ dir: '/Users/me/ws-other', depth: SCAN_DEPTH }])
  })
})

describe('cloneRootFor', () => {
  it('picks the folder most repositories live in, never the workspace data folder', async () => {
    const repos = await discoverLocalRepos({ workspaceFolder: workspace, recentDirs: [join(bareLayout, 'one')] })
    // plain clone lives in `code`, the bare layout's folder lives in `base`: a tie goes to the first
    expect([workspace, base]).toContain(cloneRootFor(repos, workspace, '/ws')!)
    expect(cloneRootFor([], '/ws', '/ws')).toBeNull()
  })
})

describe('worktree naming', () => {
  it('uses the last branch segment, file-system safe', () => {
    expect(branchSlug('craft/261018-ivory-badger')).toBe('261018-ivory-badger')
    expect(branchSlug('feat/My Thing!')).toBe('My-Thing-')
  })
  it('puts plain-clone worktrees next to the clone and bare-layout ones inside the layout, de-duplicated', () => {
    const taken = new Set(['/code/app-x'])
    expect(worktreePath('/code/app/.git', 'feat/x', p => taken.has(p))).toBe('/code/app-x-2')
    expect(worktreePath('/code/layout/.bare', 'feat/x', () => false)).toBe('/code/layout/x')
  })
})

describe('createWorktree', () => {
  it('branches from origin/HEAD next to a plain clone', async () => {
    const result = await createWorktree({ gitDir: join(plain, '.git'), branch: 'craft/test-one' }, { cloneRoot: workspace })
    expect(result).toMatchObject({ path: join(workspace, 'app-test-one'), branch: 'craft/test-one', base: 'origin/main', cloned: false })
    expect(git(result.path, 'symbolic-ref', '--short', 'HEAD')).toBe('craft/test-one')
    expect(existsSync(join(result.path, 'a.txt'))).toBe(true)
  })

  it('works in a bare layout', async () => {
    const result = await createWorktree({ gitDir: join(bareLayout, '.bare'), branch: 'craft/test-two' }, { cloneRoot: null })
    expect(result.path).toBe(join(bareLayout, 'test-two'))
    expect(git(result.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('craft/test-two')
  })

  it('rejects invalid branch names before touching git', async () => {
    for (const branch of ['', 'bad..name', '-x', 'has space']) {
      await expect(createWorktree({ gitDir: join(plain, '.git'), branch }, { cloneRoot: null })).rejects.toBeInstanceOf(WorktreeError)
    }
  })

  it("reports git's reason when the branch already exists", async () => {
    const error = await createWorktree({ gitDir: join(plain, '.git'), branch: 'craft/test-one' }, { cloneRoot: null }).catch(e => e)
    expect(error).toBeInstanceOf(WorktreeError)
    expect(error.message).toBe("a branch named 'craft/test-one' already exists")
  })

  it('keeps only git\'s reason, not its progress lines', () => {
    expect(gitReason("Preparing worktree (new branch 'x')\nfatal: a branch named 'x' already exists")).toBe("a branch named 'x' already exists")
    expect(gitReason('something odd')).toBe('something odd')
  })

  it('refuses to reuse a folder that is not a clone of the repository', async () => {
    mkdirSync(join(workspace, 'taken'))
    const error = await createWorktree({ cloneNameWithOwner: 'acme/taken', branch: 'craft/x' }, { cloneRoot: workspace }).catch(e => e)
    expect(error?.code).toBe('clone-failed')
  })

  it('rejects a non-repository folder', async () => {
    const error = await createWorktree({ gitDir: join(workspace, 'notes'), branch: 'craft/x' }, { cloneRoot: null }).catch(e => e)
    expect(error?.code).toBe('not-a-repo')
  })
})

describe('github helpers', () => {
  it('parses gh repo list JSON', () => {
    expect(parseGhRepoList('[{"nameWithOwner":"acme/app","description":"","isPrivate":true,"updatedAt":"2026-10-01T00:00:00Z"}]')).toEqual([
      { kind: 'github', nameWithOwner: 'acme/app', description: undefined, isPrivate: true, updatedAt: Date.parse('2026-10-01T00:00:00Z') },
    ])
  })
  it('accepts owner/repo only', () => {
    expect(isValidNameWithOwner('acme/app.js')).toBe(true)
    for (const bad of ['acme', 'acme/../x', 'acme/app;rm', '../x/y', 'a/b/c']) expect(isValidNameWithOwner(bad)).toBe(false)
  })
})
