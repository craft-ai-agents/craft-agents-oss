import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '../services/git.ts'
import { spawnRequestError, spawnedSessionOptions, type SpawnParent } from './spawn-options.ts'

const parent: SpawnParent = {
  id: 'parent',
  llmConnection: 'anthropic',
  model: 'claude-opus-5-5',
  enabledSourceSlugs: ['github'],
  thinkingLevel: 'high',
  labels: ['bug'],
  projectId: 'app',
  workingDirectory: '/repos/app-feature',
  codingMode: true,
}

describe('spawnedSessionOptions', () => {
  it('inherits everything the request leaves out, the folder and Coding mode included', () => {
    expect(spawnedSessionOptions({ name: 'child' }, parent)).toEqual({
      name: 'child',
      llmConnection: 'anthropic',
      model: 'claude-opus-5-5',
      enabledSourceSlugs: ['github'],
      thinkingLevel: 'high',
      labels: ['bug'],
      workingDirectory: '/repos/app-feature',
      projectId: 'app',
      codingMode: true,
      parentSessionId: 'parent',
    })
  })

  it('lets the request override what it names', () => {
    const options = spawnedSessionOptions({ model: 'claude-haiku-5-5', enabledSourceSlugs: [], workingDirectory: '/repos/app-other' }, parent)
    expect(options).toMatchObject({ model: 'claude-haiku-5-5', enabledSourceSlugs: [], workingDirectory: '/repos/app-other', projectId: 'app' })
  })

  it("leaves the folder to another project's own setting when the child moves there", () => {
    expect(spawnedSessionOptions({ projectId: 'docs' }, parent)).toMatchObject({ projectId: 'docs', workingDirectory: undefined })
    expect(spawnedSessionOptions({ projectId: 'app' }, parent).workingDirectory).toBe('/repos/app-feature')
    expect(spawnedSessionOptions({ projectId: 'docs', workingDirectory: '/repos/docs' }, parent).workingDirectory).toBe('/repos/docs')
  })

  it('keeps a default-mode parent\'s child out of Coding mode even where the workspace default is on', () => {
    // false (not undefined) so createSession doesn't fall back to the workspace default
    expect(spawnedSessionOptions({}, { ...parent, codingMode: undefined }).codingMode).toBe(false)
    expect(spawnedSessionOptions({}, { ...parent, codingMode: false }).codingMode).toBe(false)
  })
})

describe('spawnedSessionOptions Coding mode and worktree', () => {
  it('lets the request choose Coding mode either way', () => {
    expect(spawnedSessionOptions({ codingMode: false }, parent).codingMode).toBe(false)
    expect(spawnedSessionOptions({ codingMode: true }, { ...parent, codingMode: undefined }).codingMode).toBe(true)
  })

  it('runs a worktree child in Coding mode in that worktree, whatever the parent does', () => {
    const options = spawnedSessionOptions({ worktreePath: '/repos/app-child' }, { ...parent, codingMode: undefined })
    expect(options).toMatchObject({ workingDirectory: '/repos/app-child', codingMode: true, projectId: 'app' })
  })
})

describe('spawnRequestError', () => {
  const inWorkTree = async (dir: string) => dir
  const outsideWorkTree = async () => null

  it('accepts requests without a worktree without asking git', async () => {
    let asked = false
    const error = await spawnRequestError({ workingDirectory: '/anywhere', codingMode: false }, async () => {
      asked = true
      return null
    })
    expect(error).toBeUndefined()
    expect(asked).toBe(false)
  })

  it('rejects a worktree child forced out of Coding mode', async () => {
    expect(await spawnRequestError({ worktreePath: '/repos/app-child', codingMode: false }, inWorkTree)).toContain('Coding mode')
  })

  it('rejects two different folders but accepts the same one twice', async () => {
    expect(await spawnRequestError({ worktreePath: '/repos/app-child', workingDirectory: '/repos/other' }, inWorkTree)).toContain('not both')
    expect(await spawnRequestError({ worktreePath: '/repos/app-child', workingDirectory: '/repos/app-child/' }, inWorkTree)).toBeUndefined()
  })

  it('rejects a path outside a git work tree with how to create one', async () => {
    expect(await spawnRequestError({ worktreePath: '/repos/missing' }, outsideWorkTree)).toContain('git worktree add')
  })

  describe('with real git', () => {
    let scratch: string
    const gitTopLevel = (dir: string) => runGit(dir, ['rev-parse', '--show-toplevel'])

    beforeAll(() => {
      scratch = mkdtempSync(join(tmpdir(), 'spawn-worktree-'))
      execFileSync('git', ['init', '-q', join(scratch, 'repo')])
      mkdirSync(join(scratch, 'plain'))
    })

    afterAll(() => rmSync(scratch, { recursive: true, force: true }))

    it('accepts a git checkout and rejects a plain or missing folder', async () => {
      expect(await spawnRequestError({ worktreePath: join(scratch, 'repo') }, gitTopLevel)).toBeUndefined()
      expect(await spawnRequestError({ worktreePath: join(scratch, 'plain') }, gitTopLevel)).toContain('not inside a git work tree')
      expect(await spawnRequestError({ worktreePath: join(scratch, 'missing') }, gitTopLevel)).toContain('not inside a git work tree')
    })
  })
})
