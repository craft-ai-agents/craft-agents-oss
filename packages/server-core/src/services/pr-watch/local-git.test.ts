import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '../git'
import { localStatus, resolveRepo, watchRefs } from './local-git'

let base: string
let clone: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pr-watch-git-')))
  const remote = join(base, 'remote.git')
  git(base, 'init', '--bare', '-b', 'main', remote)
  clone = join(base, 'clone')
  git(base, 'clone', remote, clone)
  git(clone, 'checkout', '-b', 'main')
  writeFileSync(join(clone, 'a.txt'), 'a')
  git(clone, 'add', '.')
  git(clone, 'commit', '-m', 'init')
  git(clone, 'push', '-u', 'origin', 'main')
  git(clone, 'checkout', '-b', 'feat/pr-watch')
  writeFileSync(join(clone, 'b.txt'), 'b')
  git(clone, 'add', '.')
  git(clone, 'commit', '-m', 'feature')
  git(clone, 'push', '-u', 'origin', 'feat/pr-watch')
  // Point the remote at GitHub after pushing: tracking refs stay, the URL is what the watcher reads
  git(clone, 'remote', 'set-url', 'origin', 'git@github.com:acme/app.git')
  git(clone, 'remote', 'add', 'upstream', 'https://github.com/upstream-org/app.git')
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('resolveRepo', () => {
  it('reads branch, push remote, remote branch and both repositories', async () => {
    const repo = await resolveRepo(join(clone))
    expect(repo).toMatchObject({
      root: clone,
      gitDir: join(clone, '.git'),
      commonDir: join(clone, '.git'),
      branch: 'feat/pr-watch',
      pushRemote: 'origin',
      remoteBranch: 'feat/pr-watch',
      repo: { host: 'github.com', owner: 'acme', repo: 'app' },
      upstreamRepo: { host: 'github.com', owner: 'upstream-org', repo: 'app' },
    })
  })

  it('returns null outside a repository', async () => {
    expect(await resolveRepo(base)).toBeNull()
  })

  it('has no branch on a detached HEAD', async () => {
    const worktree = join(base, 'detached')
    git(clone, 'worktree', 'add', '--detach', worktree, 'main')
    const repo = await resolveRepo(worktree)
    expect(repo?.branch).toBeNull()
    expect(repo?.commonDir).toBe(join(clone, '.git'))
    expect(repo?.gitDir).not.toBe(repo?.commonDir)
  })
})

describe('localStatus', () => {
  it('is clean and level right after a push', async () => {
    const head = git(clone, 'rev-parse', 'HEAD')
    expect(await localStatus(clone, head)).toEqual({ localAhead: 0, localDirty: false })
  })

  it('counts unpushed commits and sees uncommitted files', async () => {
    const prHead = git(clone, 'rev-parse', 'HEAD')
    writeFileSync(join(clone, 'c.txt'), 'c')
    git(clone, 'add', '.')
    git(clone, 'commit', '-m', 'local only')
    writeFileSync(join(clone, 'untracked.txt'), 'u')
    expect(await localStatus(clone, prHead)).toEqual({ localAhead: 1, localDirty: true })
    // An unknown PR head falls back to the push branch
    expect((await localStatus(clone, 'f'.repeat(40))).localAhead).toBe(1)
  })
})

describe('watchRefs', () => {
  it('fires when the branch moves', async () => {
    const repo = (await resolveRepo(clone))!
    let fired = 0
    const stop = watchRefs(repo, () => fired++, 50)
    await new Promise(r => setTimeout(r, 100))
    git(clone, 'commit', '--allow-empty', '-m', 'move')
    await new Promise(r => setTimeout(r, 600))
    stop()
    expect(fired).toBeGreaterThanOrEqual(1)
  })
})

describe('runGit', () => {
  it('returns null instead of throwing', async () => {
    expect(await runGit(base, ['rev-parse', 'HEAD'])).toBeNull()
  })
})
