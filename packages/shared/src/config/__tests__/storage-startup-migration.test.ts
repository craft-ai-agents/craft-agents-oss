import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

const STORAGE_MODULE_PATH = pathToFileURL(join(import.meta.dir, '..', 'storage.ts')).href
const PI_RESOLVER_SETUP_PATH = pathToFileURL(join(import.meta.dir, '..', '..', '..', 'tests', 'setup', 'register-pi-model-resolver.ts')).href

function setupWorkspaceConfigDir() {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-agent-config-'))
  const workspaceRoot = join(configDir, 'workspaces', 'my-workspace')
  mkdirSync(workspaceRoot, { recursive: true })

  // Make workspace appear valid to loadStoredConfig() so migration can run.
  writeFileSync(
    join(workspaceRoot, 'config.json'),
    JSON.stringify(
      {
        id: 'ws-config-1',
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

  return { configDir, workspaceRoot, configPath: join(configDir, 'config.json') }
}

function writeRootConfig(configPath: string, workspaceRoot: string, llmConnections: any[]) {
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        workspaces: [
          {
            id: 'ws-1',
            name: 'My Workspace',
            rootPath: workspaceRoot,
            createdAt: Date.now(),
          },
        ],
        activeWorkspaceId: 'ws-1',
        activeSessionId: null,
        defaultLlmConnection: 'pi-api-key',
        llmConnections,
      },
      null,
      2,
    ),
    'utf-8',
  )
}

function runMigration(configDir: string) {
  const run = Bun.spawnSync([
    process.execPath,
    '--eval',
    `import '${PI_RESOLVER_SETUP_PATH}'; import { migrateLegacyLlmConnectionsConfig } from '${STORAGE_MODULE_PATH}'; migrateLegacyLlmConnectionsConfig();`,
  ], {
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (run.exitCode !== 0) {
    throw new Error(
      `migration subprocess failed (exit ${run.exitCode})\nstdout:\n${run.stdout.toString()}\nstderr:\n${run.stderr.toString()}`,
    )
  }
}

function readPiApiKeyConnection(configPath: string): any {
  const migrated = JSON.parse(readFileSync(configPath, 'utf-8'))
  return migrated.llmConnections.find((c: any) => c.slug === 'pi-api-key')
}

function getModelIds(connection: any): string[] {
  return (connection.models ?? []).map((m: any) => typeof m === 'string' ? m : m.id)
}

describe('startup migration (integration)', () => {
  it('repairs broken pi-api-key openai-codex provider on startup migration', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (OpenAI)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openai-codex',
        createdAt: Date.now(),
        models: [],
        defaultModel: '',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.piAuthProvider).toBe('openai')
    expect(connection.authType).toBe('api_key')
  })

  it('preserves userDefined3Tier model subsets during startup migration', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()
    const userDefinedModels = ['pi/claude-opus-4-6', 'pi/claude-sonnet-4-6', 'pi/claude-haiku-4-5']

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: userDefinedModels,
        defaultModel: userDefinedModels[0],
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    expect(connection.models).toEqual(userDefinedModels)
    expect(connection.defaultModel).toBe(userDefinedModels[0])
  })

  it('normalizes auto mode model set back to provider defaults', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'automaticallySyncedFromProvider',
        createdAt: Date.now(),
        models: ['pi/claude-haiku-4-5'],
        defaultModel: 'pi/claude-haiku-4-5',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('automaticallySyncedFromProvider')
    const modelIds = getModelIds(connection)
    expect(modelIds.length).toBeGreaterThan(1)
    expect(modelIds).toContain('pi/claude-opus-4-6')
    expect(modelIds).toContain(connection.defaultModel)
  })

  it('repairs userDefined3Tier lists by removing invalid IDs and fixing default model', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/claude-opus-4-6', 'pi/not-real', 'pi/claude-haiku-4-5'],
        defaultModel: 'pi/not-real',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    expect(connection.models).toEqual(['pi/claude-opus-4-6', 'pi/claude-haiku-4-5'])
    expect(connection.defaultModel).toBe('pi/claude-opus-4-6')
  })

  it('falls back to provider defaults when userDefined3Tier becomes empty after filtering', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/not-real-1', 'pi/not-real-2'],
        defaultModel: 'pi/not-real-1',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    const modelIds = getModelIds(connection)
    expect(modelIds.length).toBeGreaterThan(1)
    expect(modelIds).toContain('pi/claude-opus-4-6')
    expect(modelIds).not.toContain('pi/not-real-1')
    expect(connection.defaultModel).toBe(modelIds[0])
  })

  it('normalizes legacy unprefixed userDefined3Tier model IDs instead of resetting', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (OpenRouter)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'openrouter',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['x-ai/grok-4', 'openrouter/auto'],
        defaultModel: 'x-ai/grok-4',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection).toBeDefined()
    expect(connection.modelSelectionMode).toBe('userDefined3Tier')
    const modelIds = getModelIds(connection)
    expect(modelIds).toEqual(['pi/x-ai/grok-4', 'pi/openrouter/auto'])
    expect(connection.defaultModel).toBe('pi/x-ai/grok-4')
  })
})
