import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-callllm-'))
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
        thinkingLevel: 'medium',
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
  const imports = [
    'getCallLlmConnection',
    'setCallLlmConnection',
    'getCallLlmModel',
    'setCallLlmModel',
    'getCallLlmThinkingLevel',
    'setCallLlmThinkingLevel',
  ].join(', ')

  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import { ${imports} } from '${STORAGE_MODULE_PATH}'; ${code}`,
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

describe('call_llm settings storage', () => {
  // ============================================
  // Connection
  // ============================================

  describe('callLlmConnection', () => {
    it('returns undefined when not set', () => {
      const { configDir } = setupConfigDir()
      const output = runEval(configDir, "console.log(String(getCallLlmConnection()))")
      expect(output).toBe('undefined')
    })

    it('persists connection slug to config.json', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmConnection('my-conn'); console.log(String(getCallLlmConnection()))")
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmConnection).toBe('my-conn')
    })

    it('round-trips persisted value across processes', () => {
      const { configDir } = setupConfigDir()
      runEval(configDir, "setCallLlmConnection('anthropic-api')")
      const output = runEval(configDir, "console.log(String(getCallLlmConnection()))")
      expect(output).toBe('anthropic-api')
    })

    it('clears value when set to undefined', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmConnection('my-conn')")
      runEval(configDir, "setCallLlmConnection(undefined)")
      const output = runEval(configDir, "console.log(String(getCallLlmConnection()))")
      expect(output).toBe('undefined')
      // Verify the field is removed from config, not set to undefined
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmConnection).toBeUndefined()
    })
  })

  // ============================================
  // Model
  // ============================================

  describe('callLlmModel', () => {
    it('returns undefined when not set', () => {
      const { configDir } = setupConfigDir()
      const output = runEval(configDir, "console.log(String(getCallLlmModel()))")
      expect(output).toBe('undefined')
    })

    it('persists model to config.json', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmModel('claude-3-5-haiku-20241022')")
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmModel).toBe('claude-3-5-haiku-20241022')
    })

    it('round-trips persisted value', () => {
      const { configDir } = setupConfigDir()
      runEval(configDir, "setCallLlmModel('gemini-2.0-flash')")
      const output = runEval(configDir, "console.log(String(getCallLlmModel()))")
      expect(output).toBe('gemini-2.0-flash')
    })

    it('clears value when set to undefined', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmModel('some-model')")
      runEval(configDir, "setCallLlmModel(undefined)")
      const output = runEval(configDir, "console.log(String(getCallLlmModel()))")
      expect(output).toBe('undefined')
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmModel).toBeUndefined()
    })
  })

  // ============================================
  // Thinking Level
  // ============================================

  describe('callLlmThinkingLevel', () => {
    it('returns undefined when not set', () => {
      const { configDir } = setupConfigDir()
      const output = runEval(configDir, "console.log(String(getCallLlmThinkingLevel()))")
      expect(output).toBe('undefined')
    })

    it('persists thinking level to config.json', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmThinkingLevel('high')")
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmThinkingLevel).toBe('high')
    })

    it('round-trips valid thinking levels', () => {
      const { configDir } = setupConfigDir()
      // Single subprocess to set then verify — avoids timeout from multiple spawns
      const output = runEval(configDir, `
        setCallLlmThinkingLevel('off');
        const v1 = getCallLlmThinkingLevel();
        setCallLlmThinkingLevel('max');
        const v2 = getCallLlmThinkingLevel();
        console.log(v1 + ',' + v2);
      `)
      expect(output).toBe('off,max')
    })

    it('clears value when set to undefined', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, "setCallLlmThinkingLevel('max')")
      runEval(configDir, "setCallLlmThinkingLevel(undefined)")
      const output = runEval(configDir, "console.log(String(getCallLlmThinkingLevel()))")
      expect(output).toBe('undefined')
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmThinkingLevel).toBeUndefined()
    })
  })

  // ============================================
  // Multiple settings together
  // ============================================

  describe('combined settings', () => {
    it('persists all three settings independently', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, `
        setCallLlmConnection('my-conn');
        setCallLlmModel('claude-3-haiku');
        setCallLlmThinkingLevel('low');
      `)
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmConnection).toBe('my-conn')
      expect(config.callLlmModel).toBe('claude-3-haiku')
      expect(config.callLlmThinkingLevel).toBe('low')
    })

    it('can clear one setting without affecting others', () => {
      const { configDir, configPath } = setupConfigDir()
      runEval(configDir, `
        setCallLlmConnection('my-conn');
        setCallLlmModel('claude-3-haiku');
        setCallLlmThinkingLevel('low');
      `)
      runEval(configDir, "setCallLlmModel(undefined)")
      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      expect(config.callLlmConnection).toBe('my-conn')
      expect(config.callLlmModel).toBeUndefined()
      expect(config.callLlmThinkingLevel).toBe('low')
    })
  })
})
