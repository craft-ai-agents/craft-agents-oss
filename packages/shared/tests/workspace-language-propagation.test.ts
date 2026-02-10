import { describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

describe('addWorkspace language propagation', () => {
  it('seeds status and labels with app language when no explicit language is provided', async () => {
    const testRoot = join(process.cwd(), '.tmp-test-workspace-language-propagation')
    const configDir = join(testRoot, 'config')
    const workspaceRoot = join(testRoot, 'workspaces', 'seed-by-app-language')

    rmSync(testRoot, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(join(testRoot, 'workspaces'), { recursive: true })

    process.env.CRAFT_CONFIG_DIR = configDir

    const { addWorkspace } = await import('../src/config/storage')

    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify(
        {
          language: 'zh-CN',
          workspaces: [],
          activeWorkspaceId: null,
          activeSessionId: null,
        },
        null,
        2,
      ),
      'utf-8',
    )

    addWorkspace({ name: 'Seeded Workspace', rootPath: workspaceRoot })

    const statusConfig = JSON.parse(readFileSync(join(workspaceRoot, 'statuses/config.json'), 'utf-8'))
    const labelConfig = JSON.parse(readFileSync(join(workspaceRoot, 'labels/config.json'), 'utf-8'))

    expect(statusConfig.statuses.find((s: any) => s.id === 'todo')?.label).toBe('待处理')
    expect(labelConfig.labels.find((l: any) => l.id === 'development')?.name).toBe('开发')

    rmSync(testRoot, { recursive: true, force: true })
  })
})
