import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultStatusConfig, loadStatusConfig, saveStatusConfig } from './storage.ts'

describe('status storage defaults', () => {
  const workspaceRoots: string[] = []

  afterEach(() => {
    for (const workspaceRoot of workspaceRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  function createWorkspaceRoot(): string {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'craft-statuses-'))
    workspaceRoots.push(workspaceRoot)
    return workspaceRoot
  }

  it('keeps a persisted status color override instead of replacing it with a default', () => {
    const workspaceRoot = createWorkspaceRoot()
    const config = getDefaultStatusConfig()
    const override = { light: '#123456', dark: '#abcdef' }
    const inProgress = config.statuses.find((status) => status.id === 'in-progress')

    if (!inProgress) throw new Error('missing in-progress built-in status')
    inProgress.color = override
    saveStatusConfig(workspaceRoot, config)

    const loaded = loadStatusConfig(workspaceRoot)
    expect(loaded.statuses.find((status) => status.id === 'in-progress')?.color).toEqual(override)
  })
})
