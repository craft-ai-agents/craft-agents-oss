import { describe, it, expect } from 'bun:test'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { createWorkspaceAtPath } from '../src/workspaces/storage'
import { saveStatusConfig, loadStatusConfig, getDefaultStatusConfig } from '../src/statuses/storage'
import { saveLabelConfig, loadLabelConfig, getDefaultLabelConfig } from '../src/labels/storage'

describe('createWorkspaceAtPath', () => {
  it('seeds localized status and label configs when language is zh-CN', () => {
    const rootPath = join(process.cwd(), '.tmp-test-workspace-language-seed')

    rmSync(rootPath, { recursive: true, force: true })
    mkdirSync(rootPath, { recursive: true })

    // New workspace should use the app language as seed
    createWorkspaceAtPath(rootPath, 'Test Workspace', undefined, 'zh-CN')

    const statusConfig = JSON.parse(readFileSync(join(rootPath, 'statuses/config.json'), 'utf-8'))
    const labelConfig = JSON.parse(readFileSync(join(rootPath, 'labels/config.json'), 'utf-8'))

    expect(statusConfig.statuses.map((s: any) => s.label)).toEqual([
      '待办队列',
      '待处理',
      '需要复核',
      '已完成',
      '已取消',
    ])
    expect(labelConfig.labels.map((l: any) => l.name)).toEqual([
      '开发',
      '内容',
      '优先级',
      '项目',
    ])

    rmSync(rootPath, { recursive: true, force: true })
  })

  it('keeps existing status and label configs unchanged after initialization', () => {
    const rootPath = join(process.cwd(), '.tmp-test-workspace-language-existing')

    rmSync(rootPath, { recursive: true, force: true })
    mkdirSync(rootPath, { recursive: true })

    createWorkspaceAtPath(rootPath, 'Existing Workspace', undefined, 'en')

    const existingStatus = getDefaultStatusConfig('en')
    existingStatus.statuses = existingStatus.statuses.map((status) =>
      status.id === 'todo' ? { ...status, label: 'My Custom Todo' } : status,
    )
    saveStatusConfig(rootPath, existingStatus)

    const existingLabels = getDefaultLabelConfig('en')
    existingLabels.labels = existingLabels.labels.map((label) =>
      label.id === 'development' ? { ...label, name: 'My Dev Labels' } : label,
    )
    saveLabelConfig(rootPath, existingLabels)

    // Simulate normal load path after app language changes.
    // Existing persisted configs should be used as-is.
    const loadedStatus = loadStatusConfig(rootPath)
    const loadedLabels = loadLabelConfig(rootPath)

    expect(loadedStatus.statuses.find((s: any) => s.id === 'todo')?.label).toBe('My Custom Todo')
    expect(loadedLabels.labels.find((l: any) => l.id === 'development')?.name).toBe('My Dev Labels')

    rmSync(rootPath, { recursive: true, force: true })
  })
})
