import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupWorkspaceRemovalFixture() {
  const tempHome = mkdtempSync(join(tmpdir(), 'craft-agent-home-'))
  const configDir = join(tempHome, '.craft-agent')
  const workspacesDir = join(configDir, 'workspaces')
  const workspaceRoot = join(workspacesDir, 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify(
      {
        id: 'ws-managed',
        name: 'My Workspace',
        slug: 'my-workspace',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
    'utf-8',
  )

  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(
      {
        workspaces: [
          {
            id: 'ws-managed',
            name: 'My Workspace',
            rootPath: '~/.craft-agent/workspaces/my-workspace',
            createdAt: Date.now(),
            managedByApp: true,
          },
        ],
        activeWorkspaceId: 'ws-managed',
        activeSessionId: null,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return { tempHome, configDir, workspaceRoot, configPath: join(configDir, 'config.json') }
}

function removeWorkspaceInSubprocess(tempHome: string, configDir: string) {
  return Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { removeWorkspace } from '${STORAGE_MODULE_PATH}'; await removeWorkspace('ws-managed');`,
  ], {
    env: {
      ...process.env,
      HOME: tempHome,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

describe('removeWorkspace', () => {
  it('deletes managed local workspaces stored with a tilde rootPath', () => {
    const { tempHome, configDir, workspaceRoot, configPath } = setupWorkspaceRemovalFixture()

    const result = removeWorkspaceInSubprocess(tempHome, configDir)
    if (result.exitCode !== 0) {
      throw new Error(
        `removeWorkspace subprocess failed (exit ${result.exitCode})\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`,
      )
    }

    const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(savedConfig.workspaces).toEqual([])
    expect(savedConfig.activeWorkspaceId).toBeNull()
    expect(existsSync(workspaceRoot)).toBe(false)
  })

  it('does not delete imported workspaces under the default root when they are not marked managed', () => {
    const { tempHome, configDir, workspaceRoot, configPath } = setupWorkspaceRemovalFixture()

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          workspaces: [
            {
              id: 'ws-managed',
              name: 'Imported Workspace',
              rootPath: '~/.craft-agent/workspaces/my-workspace',
              createdAt: Date.now(),
              managedByApp: false,
            },
          ],
          activeWorkspaceId: 'ws-managed',
          activeSessionId: null,
        },
        null,
        2,
      ),
      'utf-8',
    )

    const result = removeWorkspaceInSubprocess(tempHome, configDir)
    if (result.exitCode !== 0) {
      throw new Error(
        `removeWorkspace subprocess failed (exit ${result.exitCode})\nstdout:\n${result.stdout.toString()}\nstderr:\n${result.stderr.toString()}`,
      )
    }

    const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(savedConfig.workspaces).toEqual([])
    expect(savedConfig.activeWorkspaceId).toBeNull()
    expect(existsSync(workspaceRoot)).toBe(true)
  })
})
