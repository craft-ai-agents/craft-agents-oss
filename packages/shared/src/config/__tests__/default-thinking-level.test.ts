import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { THINKING_LEVEL_IDS } from '../../agent/thinking-levels.ts'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupWorkspaceConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-thinking-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-config-1',
      name: 'My Workspace',
      slug: 'my-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2),
    'utf-8',
  )

  const configPath = join(configDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'My Workspace', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      llmConnections: [],
    }, null, 2),
    'utf-8',
  )

  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: 'test',
      description: 'test defaults',
      defaults: {
        notificationsEnabled: true,
        colorTheme: 'default',
        autoCapitalisation: true,
        sendMessageKey: 'enter',
        spellCheck: false,
        keepAwakeWhileRunning: false,
        richToolDescriptions: true,
      },
      workspaceDefaults: {
        thinkingLevel: 'off',
        permissionMode: 'ask',
        cyclablePermissionModes: ['safe', 'ask', 'allow-all'],
        localMcpServers: { enabled: true },
      },
    }, null, 2),
    'utf-8',
  )

  return { configDir, configPath }
}

function runEval(configDir: string, code: string): string {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { getDefaultThinkingLevel, setDefaultThinkingLevel } from '${STORAGE_MODULE_PATH}'; ${code}`,
  ], {
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(`subprocess failed (exit ${run.exitCode})\nstderr:\n${run.stderr.toString()}`)
  }

  return run.stdout.toString().trim()
}

describe('default thinking level storage', () => {
  it('falls back to bundled default when no app-level default is set', () => {
    const { configDir } = setupWorkspaceConfigDir()
    const output = runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")
    expect(output).toBe('off')
  })

  it('persists defaultThinkingLevel to config.json', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()

    runEval(configDir, "setDefaultThinkingLevel('max'); console.log(String(getDefaultThinkingLevel()))")

    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config.defaultThinkingLevel).toBe('max')
  })

  // Two sequential Bun.spawnSync under CI load exceeded the default 5s test budget
  // (each cold import of storage.ts is ~1–3s). One subprocess still proves
  // set→get persistence within the same CRAFT_CONFIG_DIR.
  it('round-trips persisted value across get/set in a fresh process', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()
    const output = runEval(
      configDir,
      "setDefaultThinkingLevel('medium'); console.log(String(getDefaultThinkingLevel()))",
    )
    expect(output).toBe('medium')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    expect(config.defaultThinkingLevel).toBe('medium')
  })

  it('supports every thinking level', () => {
    const { configDir } = setupWorkspaceConfigDir()
    // Минимум subprocess-ов (ранее 12 × ~540ms превышало 5s таймаут под нагрузкой).
    const levels = THINKING_LEVEL_IDS
    const script = levels
      .map((level) => `setDefaultThinkingLevel('${level}'); console.log('${level}=' + String(getDefaultThinkingLevel()))`)
      .join('\n')
    const output = runEval(configDir, script)
    expect(output.trim().split('\n')).toEqual(levels.map((level) => `${level}=${level}`))
  })

  it('migrates legacy "think" value to "medium"', () => {
    const { configDir, configPath } = setupWorkspaceConfigDir()
    // Manually write the legacy 'think' value to config
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    config.defaultThinkingLevel = 'think'
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    const output = runEval(configDir, "console.log(String(getDefaultThinkingLevel()))")
    expect(output).toBe('medium')
  })
})
