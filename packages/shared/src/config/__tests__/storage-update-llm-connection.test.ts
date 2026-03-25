import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href

/**
 * Create isolated config dir with a root config containing the given connections.
 * Returns paths needed by tests plus a runner to call updateLlmConnection in a subprocess.
 */
function setup(llmConnections: any[]) {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-'))
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
      defaultLlmConnection: llmConnections[0]?.slug ?? null,
      llmConnections,
    }, null, 2),
    'utf-8',
  )

  function runUpdate(slug: string, updates: Record<string, unknown>): boolean {
    const updatesJson = JSON.stringify(updates)
    const run = Bun.spawnSync([
      process.execPath,
      '--eval',
      `import { updateLlmConnection } from '${STORAGE_MODULE_PATH}'; const ok = updateLlmConnection(${JSON.stringify(slug)}, ${updatesJson}); process.exit(ok ? 0 : 1);`,
    ], {
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (run.exitCode !== 0 && run.stderr.toString().trim()) {
      throw new Error(`update subprocess failed:\n${run.stderr.toString()}`)
    }
    return run.exitCode === 0
  }

  function readConnection(slug: string): any {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config.llmConnections.find((c: any) => c.slug === slug)
  }

  return { configDir, configPath, runUpdate, readConnection }
}

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'custom-compat',
    name: 'My Custom Endpoint',
    providerType: 'pi_compat',
    authType: 'api_key_with_endpoint',
    createdAt: Date.now(),
    baseUrl: 'http://localhost:8085',
    piAuthProvider: 'anthropic',
    ...overrides,
  }
}

describe('updateLlmConnection – customEndpoint', () => {
  it('preserves customEndpoint when provided in updates', () => {
    const { runUpdate, readConnection } = setup([makeConnection()])
    const customEndpoint = { api: 'anthropic-messages' }

    const ok = runUpdate('custom-compat', { customEndpoint })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual(customEndpoint)
  })

  it('preserves existing customEndpoint when updates do not include it', () => {
    const customEndpoint = { api: 'openai-completions' }
    const { runUpdate, readConnection } = setup([makeConnection({ customEndpoint })])

    // Update an unrelated field
    const ok = runUpdate('custom-compat', { name: 'Renamed Endpoint' })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual(customEndpoint)
    expect(conn.name).toBe('Renamed Endpoint')
  })

  it('overwrites customEndpoint protocol when updated', () => {
    const { runUpdate, readConnection } = setup([
      makeConnection({ customEndpoint: { api: 'openai-completions' } }),
    ])

    const ok = runUpdate('custom-compat', { customEndpoint: { api: 'anthropic-messages' } })
    expect(ok).toBe(true)

    const conn = readConnection('custom-compat')
    expect(conn.customEndpoint).toEqual({ api: 'anthropic-messages' })
  })
})
