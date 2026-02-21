import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSession, createSubSession, getChildSessions, loadSession, updateSiblingOrder } from './storage.ts'

let workspaceRootPath = ''

beforeEach(() => {
  workspaceRootPath = mkdtempSync(join(tmpdir(), 'sessions-sub-session-test-'))
})

afterEach(() => {
  if (workspaceRootPath && existsSync(workspaceRootPath)) {
    rmSync(workspaceRootPath, { recursive: true, force: true })
  }
})

describe('createSubSession', () => {
  it('inherits parent session config when no overrides are provided', async () => {
    const parent = await createSession(workspaceRootPath, {
      workingDirectory: '/tmp/parent-working-dir',
      permissionMode: 'allow-all',
      enabledSourceSlugs: ['source-a', 'source-b'],
      model: 'claude-sonnet',
      llmConnection: 'conn-parent',
    })

    const child = await createSubSession(workspaceRootPath, parent.id)
    const storedChild = loadSession(workspaceRootPath, child.id)

    expect(child.parentSessionId).toBe(parent.id)
    expect(storedChild?.parentSessionId).toBe(parent.id)
    expect(storedChild?.workingDirectory).toBe('/tmp/parent-working-dir')
    expect(storedChild?.permissionMode).toBe('allow-all')
    expect(storedChild?.enabledSourceSlugs).toEqual(['source-a', 'source-b'])
    expect(storedChild?.model).toBe('claude-sonnet')
    expect(storedChild?.llmConnection).toBe('conn-parent')
  })

  it('applies explicit child overrides', async () => {
    const parent = await createSession(workspaceRootPath, {
      workingDirectory: '/tmp/parent-working-dir',
      permissionMode: 'ask',
      enabledSourceSlugs: ['source-a'],
      model: 'claude-sonnet',
      llmConnection: 'conn-parent',
    })

    const child = await createSubSession(workspaceRootPath, parent.id, {
      workingDirectory: '/tmp/child-working-dir',
      permissionMode: 'safe',
      enabledSourceSlugs: ['source-child'],
      model: 'o3',
      llmConnection: 'conn-child',
    })
    const storedChild = loadSession(workspaceRootPath, child.id)

    expect(storedChild?.workingDirectory).toBe('/tmp/child-working-dir')
    expect(storedChild?.permissionMode).toBe('safe')
    expect(storedChild?.enabledSourceSlugs).toEqual(['source-child'])
    expect(storedChild?.model).toBe('o3')
    expect(storedChild?.llmConnection).toBe('conn-child')
  })

  it('prevents creating a sub-session from another sub-session', async () => {
    const parent = await createSession(workspaceRootPath)
    const child = await createSubSession(workspaceRootPath, parent.id)

    await expect(createSubSession(workspaceRootPath, child.id)).rejects.toThrow(
      'Cannot create sub-session of a sub-session (max 1 level)'
    )
  })

  it('persists sibling order updates for child sessions', async () => {
    const parent = await createSession(workspaceRootPath)
    const firstChild = await createSubSession(workspaceRootPath, parent.id, { name: 'first' })
    const secondChild = await createSubSession(workspaceRootPath, parent.id, { name: 'second' })

    await updateSiblingOrder(workspaceRootPath, [secondChild.id, firstChild.id])

    const orderedChildren = getChildSessions(workspaceRootPath, parent.id)
    expect(orderedChildren.map(s => s.id)).toEqual([secondChild.id, firstChild.id])
    expect(orderedChildren[0]?.siblingOrder).toBe(0)
    expect(orderedChildren[1]?.siblingOrder).toBe(1)
  })
})
