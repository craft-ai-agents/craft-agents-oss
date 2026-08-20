import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function writeConfigDefaults(configDir: string): void {
  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: '1.0',
      description: 'Test configuration defaults',
      defaults: {
        notificationsEnabled: true,
        colorTheme: 'pierre',
        autoCapitalisation: true,
        sendMessageKey: 'enter',
        spellCheck: false,
        keepAwakeWhileRunning: false,
        richToolDescriptions: true,
        defaultZoomLevel: 90,
        extendedPromptCache: false,
        browserToolEnabled: true,
        allowRemoteEvaluate: true,
      },
      workspaceDefaults: {
        thinkingLevel: 'medium',
        permissionMode: 'allow-all',
        cyclablePermissionModes: ['safe', 'allow-all'],
        localMcpServers: { enabled: true },
      },
    }),
    'utf-8',
  )
}

function getDefaultZoom(config?: unknown): number {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-zoom-'))
  writeConfigDefaults(configDir)

  if (config !== undefined) {
    writeFileSync(join(configDir, 'config.json'), JSON.stringify(config), 'utf-8')
  }

  const result = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getDefaultZoomLevel } from '${STORAGE_MODULE_PATH}'; process.stdout.write(String(getDefaultZoomLevel()));`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(`zoom subprocess failed (exit ${result.exitCode}): ${result.stderr.toString()}`)
  }

  return Number(result.stdout.toString())
}

function getFreshDefaultZoom(): number {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-zoom-'))
  const result = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { ensureConfigDir, getDefaultZoomLevel } from '${STORAGE_MODULE_PATH}'; ensureConfigDir(); process.stdout.write(String(getDefaultZoomLevel()));`,
  ], {
    cwd: configDir,
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (result.exitCode !== 0) {
    throw new Error(`fresh zoom subprocess failed (exit ${result.exitCode}): ${result.stderr.toString()}`)
  }

  return Number(result.stdout.toString())
}

describe('default zoom storage', () => {
  it('falls back to 90 when fresh config uses persisted fallback defaults', () => {
    expect(getFreshDefaultZoom()).toBe(90)
  })

  it('falls back to 90 when the persisted zoom is invalid', () => {
    expect(getDefaultZoom({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      defaultZoomLevel: null,
    })).toBe(90)
  })

  it('preserves an explicit stored zoom override', () => {
    expect(getDefaultZoom({
      workspaces: [],
      activeWorkspaceId: null,
      activeSessionId: null,
      defaultZoomLevel: 110,
    })).toBe(110)
  })
})
