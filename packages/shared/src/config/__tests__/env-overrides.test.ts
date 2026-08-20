/**
 * setRuntimeEnvOverrides — key validation + denylist (PATH/DYLD/NODE_OPTIONS/…).
 * CONFIG_DIR captured at module load → each scenario runs in a subprocess.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

function setupConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-env-overrides-'))
  const workspaceRoot = join(configDir, 'workspaces', 'ws')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify({
      id: 'ws-1',
      name: 'WS',
      slug: 'ws',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  )
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({
      workspaces: [{ id: 'ws-1', name: 'WS', rootPath: workspaceRoot, createdAt: Date.now() }],
      activeWorkspaceId: 'ws-1',
      activeSessionId: null,
      llmConnections: [],
    }),
  )
  writeFileSync(
    join(configDir, 'config-defaults.json'),
    JSON.stringify({
      version: 'test',
      description: 'test',
      defaults: {},
      workspaceDefaults: {},
    }),
  )
  return configDir
}

function runEval(configDir: string, code: string): { stdout: string; stderr: string; exitCode: number } {
  const run = Bun.spawnSync(
    [
      process.execPath,
      '--eval',
      `import { getRuntimeEnvOverrides, setRuntimeEnvOverrides } from '${STORAGE_MODULE_PATH}'; ${code}`,
    ],
    {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  return {
    stdout: run.stdout.toString().trim(),
    stderr: run.stderr.toString(),
    exitCode: run.exitCode ?? 1,
  }
}

describe('setRuntimeEnvOverrides', () => {
  it('persists valid keys and drops empty ones', () => {
    const configDir = setupConfigDir()
    const r = runEval(
      configDir,
      `setRuntimeEnvOverrides({ FOO: 'bar', '  ': 'x', BAZ: '1' }); console.log(JSON.stringify(getRuntimeEnvOverrides()))`,
    )
    expect(r.exitCode).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ FOO: 'bar', BAZ: '1' })
  })

  it('rejects PATH / DYLD_INSERT_LIBRARIES / NODE_OPTIONS / CRAFT_CONFIG_DIR', () => {
    const configDir = setupConfigDir()
    for (const key of ['PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'CRAFT_CONFIG_DIR', 'LD_PRELOAD']) {
      const r = runEval(configDir, `try { setRuntimeEnvOverrides({ ${JSON.stringify(key)}: 'x' }); console.log('OK') } catch (e) { console.log('ERR:' + e.message) }`)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toMatch(/^ERR:env override key not allowed/)
    }
    // nothing persisted
    const cfg = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'))
    expect(cfg.runtime?.envOverrides ?? {}).toEqual({})
  })

  it('rejects invalid key shapes (spaces, dashes, leading digit)', () => {
    const configDir = setupConfigDir()
    for (const key of ['HAS SPACE', 'foo-bar', '1ABC', 'foo=bar']) {
      const r = runEval(
        configDir,
        `try { setRuntimeEnvOverrides({ ${JSON.stringify(key)}: 'x' }); console.log('OK') } catch (e) { console.log('ERR:' + e.message) }`,
      )
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toMatch(/^ERR:invalid env override key/)
    }
  })
})
