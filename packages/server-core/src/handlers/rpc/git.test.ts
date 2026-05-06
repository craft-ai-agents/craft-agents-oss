import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import { registerGitHandlers } from './git'

let tempRoot: string | null = null

function createHarness() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }

  registerGitHandlers(server)

  const getLog = handlers.get(RPC_CHANNELS.git.GET_LOG)
  const getStatus = handlers.get(RPC_CHANNELS.git.GET_STATUS)
  const getFileDiff = handlers.get(RPC_CHANNELS.git.GET_FILE_DIFF)
  const getCommitDetail = handlers.get(RPC_CHANNELS.git.GET_COMMIT_DETAIL)
  if (!getLog || !getStatus || !getFileDiff || !getCommitDetail) {
    throw new Error('git handlers not registered')
  }

  return { getLog, getStatus, getFileDiff, getCommitDetail }
}

function ctx(): RequestContext {
  return { clientId: 'client-1', workspaceId: 'ws-1', webContentsId: 1 }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Ada Lovelace',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada Lovelace',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
    },
  }).trim()
}

function createRepo(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'craft-git-rpc-'))
  git(tempRoot, ['init'])
  writeFileSync(join(tempRoot, 'README.md'), '# Test\n')
  git(tempRoot, ['add', 'README.md'])
  git(tempRoot, ['commit', '-m', 'Initial commit'])
  return tempRoot
}

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  tempRoot = null
})

describe('git RPC handlers', () => {
  it('getGitLog returns correctly shaped GitCommit entries', async () => {
    const repo = createRepo()
    const { getLog } = createHarness()

    const commits = await getLog(ctx(), repo)

    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({
      shortHash: expect.stringMatching(/^[0-9a-f]{7,}$/),
      message: 'Initial commit',
      author: 'Ada Lovelace',
    })
    expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/)
    expect(new Date(commits[0].date).toString()).not.toBe('Invalid Date')
    expect(commits[0].filesChanged).toEqual([
      { path: 'README.md', additions: 1, deletions: 0, status: 'added' },
    ])
  })

  it('getGitStatus categorises modified, staged, untracked, and deleted files', async () => {
    const repo = createRepo()
    const { getStatus } = createHarness()
    writeFileSync(join(repo, 'README.md'), '# Test\nchanged\n')
    writeFileSync(join(repo, 'untracked.txt'), 'untracked\n')
    writeFileSync(join(repo, 'delete-me.txt'), 'delete\n')
    git(repo, ['add', 'delete-me.txt'])
    git(repo, ['commit', '-m', 'Add deletion fixture'])
    writeFileSync(join(repo, 'staged.txt'), 'staged\n')
    git(repo, ['add', 'staged.txt'])
    rmSync(join(repo, 'delete-me.txt'))

    const status = await getStatus(ctx(), repo)

    expect(status).toEqual(expect.arrayContaining([
      { path: 'README.md', status: 'modified' },
      { path: 'staged.txt', status: 'staged' },
      { path: 'untracked.txt', status: 'untracked' },
      { path: 'delete-me.txt', status: 'deleted' },
    ]))
  })

  it('getGitFileDiff returns a unified patch for a known modified file', async () => {
    const repo = createRepo()
    const { getFileDiff } = createHarness()
    writeFileSync(join(repo, 'README.md'), '# Test\nchanged\n')

    const diff = await getFileDiff(ctx(), repo, 'README.md')

    expect(diff).toContain('diff --git a/README.md b/README.md')
    expect(diff).toContain('+changed')
  })

  it('getGitCommitDetail includes per-file diff strings', async () => {
    const repo = createRepo()
    const { getLog, getCommitDetail } = createHarness()
    const [commit] = await getLog(ctx(), repo)

    const detail = await getCommitDetail(ctx(), repo, commit.hash)

    expect(detail?.hash).toBe(commit.hash)
    expect(detail?.filesChanged[0]).toMatchObject({
      path: 'README.md',
      status: 'added',
    })
    expect(detail?.filesChanged[0]?.diff).toContain('diff --git a/README.md b/README.md')
  })

  it('returns graceful empty values for non-git directories', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'craft-git-rpc-non-git-'))
    mkdirSync(join(tempRoot, 'plain'))
    const workspacePath = join(tempRoot, 'plain')
    const { getLog, getStatus, getFileDiff, getCommitDetail } = createHarness()

    await expect(getLog(ctx(), workspacePath)).resolves.toEqual([])
    await expect(getStatus(ctx(), workspacePath)).resolves.toEqual([])
    await expect(getFileDiff(ctx(), workspacePath, 'README.md')).resolves.toBe('')
    await expect(getCommitDetail(ctx(), workspacePath, 'abc123')).resolves.toBeNull()
  })
})
