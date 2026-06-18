import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { getPiModelsForAuthProvider } from '../models-pi.ts'

const PI_ANTHROPIC_OPUS_DEFAULT = getPiModelsForAuthProvider('anthropic').some(m => m.id === 'pi/claude-opus-4-8')
  ? 'pi/claude-opus-4-8'
  : 'pi/claude-opus-4-7'
const PI_ANTHROPIC_OPUS_DEFAULT_NAME = PI_ANTHROPIC_OPUS_DEFAULT.endsWith('4-8') ? 'Opus 4.8' : 'Opus 4.7'
const PI_BEDROCK_OPUS_DEFAULT = getPiModelsForAuthProvider('amazon-bedrock').some(m => m.id === 'pi/us.anthropic.claude-opus-4-8')
  ? 'pi/us.anthropic.claude-opus-4-8'
  : 'pi/us.anthropic.claude-opus-4-7'
const PI_BEDROCK_OPUS_DEFAULT_NAME = PI_BEDROCK_OPUS_DEFAULT.endsWith('4-8') ? 'Opus 4.8' : 'Opus 4.7'

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
    const migratedModels = [PI_ANTHROPIC_OPUS_DEFAULT, 'pi/claude-sonnet-4-6', 'pi/claude-haiku-4-5']

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
    expect(connection.models).toEqual(migratedModels)
    expect(connection.defaultModel).toBe(migratedModels[0])
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
    expect(modelIds).toContain(PI_ANTHROPIC_OPUS_DEFAULT)
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
    expect(connection.models).toEqual([PI_ANTHROPIC_OPUS_DEFAULT, 'pi/claude-haiku-4-5'])
    expect(connection.defaultModel).toBe(PI_ANTHROPIC_OPUS_DEFAULT)
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
    expect(modelIds).toContain(PI_ANTHROPIC_OPUS_DEFAULT)
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

function readConfigJson(configPath: string): any {
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}

function findConnection(configPath: string, slug: string): any {
  return readConfigJson(configPath).llmConnections.find((c: any) => c.slug === slug)
}

function modelIdsOf(connection: any): string[] {
  return (connection?.models ?? []).map((m: any) => typeof m === 'string' ? m : m.id)
}

describe('legacy Opus migration to default Opus (integration)', () => {
  it('migrates direct Anthropic default/model entries from Opus 4.6 to Opus 4.8 while keeping Opus 4.7', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: [
          { id: 'claude-opus-4-6', name: 'Opus 4.6', shortName: 'Opus', provider: 'anthropic', contextWindow: 200_000 },
          { id: 'claude-opus-4-7', name: 'Opus 4.7', shortName: 'Opus', provider: 'anthropic', contextWindow: 1_000_000 },
          { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', shortName: 'Sonnet', provider: 'anthropic', contextWindow: 200_000 },
        ],
        defaultModel: 'claude-opus-4-6',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'anthropic')
    const ids = modelIdsOf(connection)
    expect(connection.defaultModel).toBe('claude-opus-4-8')
    expect(ids).toContain('claude-opus-4-8')
    expect(ids).toContain('claude-opus-4-7')
    expect(ids).not.toContain('claude-opus-4-6')
    expect(ids.filter(id => id === 'claude-opus-4-8')).toHaveLength(1)
    const opus = connection.models.find((m: any) => (typeof m === 'string' ? m : m.id) === 'claude-opus-4-8')
    expect(typeof opus).toBe('object')
    expect(opus.name).toBe('Opus 4.8')
  })

  it('migrates direct Anthropic Opus 4.5 defaults straight to Opus 4.8', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-5-20251101',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'anthropic')
    const ids = modelIdsOf(connection)
    expect(connection.defaultModel).toBe('claude-opus-4-8')
    expect(ids).toContain('claude-opus-4-8')
    expect(ids).not.toContain('claude-opus-4-5-20251101')
  })

  it('migrates previous direct Anthropic Opus 4.7 defaults to Opus 4.8 while keeping 4.7 selectable', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: ['claude-opus-4-7', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-7',
      },
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Anthropic)',
        providerType: 'pi',
        authType: 'api_key',
        piAuthProvider: 'anthropic',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['pi/claude-opus-4-7', 'pi/claude-sonnet-4-6'],
        defaultModel: 'pi/claude-opus-4-7',
      },
    ])

    runMigration(configDir)

    const anthropic = findConnection(configPath, 'anthropic')
    expect(anthropic.defaultModel).toBe('claude-opus-4-8')
    expect(modelIdsOf(anthropic)).toEqual(['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6'])

    const pi = readPiApiKeyConnection(configPath)
    expect(pi.defaultModel).toBe('pi/claude-opus-4-7')
    expect(modelIdsOf(pi)).toEqual(['pi/claude-opus-4-7', 'pi/claude-sonnet-4-6'])
  })

  it('migrates workspace default Opus 4.6 to Opus 4.8', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()
    const wsConfigPath = join(workspaceRoot, 'config.json')
    const wsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf-8'))
    wsConfig.defaults = { model: 'claude-opus-4-6' }
    writeFileSync(wsConfigPath, JSON.stringify(wsConfig, null, 2), 'utf-8')

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-8',
      },
    ])

    runMigration(configDir)

    const migratedWsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf-8'))
    expect(migratedWsConfig.defaults.model).toBe('claude-opus-4-8')
  })

  it('migrates workspace default Opus 4.7 to Opus 4.8', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()
    const wsConfigPath = join(workspaceRoot, 'config.json')
    const wsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf-8'))
    wsConfig.defaults = { model: 'claude-opus-4-7' }
    writeFileSync(wsConfigPath, JSON.stringify(wsConfig, null, 2), 'utf-8')

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        providerType: 'anthropic',
        authType: 'api_key',
        createdAt: Date.now(),
        models: ['claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-8',
      },
    ])

    runMigration(configDir)

    const migratedWsConfig = JSON.parse(readFileSync(wsConfigPath, 'utf-8'))
    expect(migratedWsConfig.defaults.model).toBe('claude-opus-4-8')
  })

  it('migrates Pi Anthropic Opus 4.6 IDs to the best available Opus default', () => {
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
        models: [
          { id: 'pi/claude-opus-4-6', name: 'Opus 4.6', shortName: 'Opus', provider: 'pi', contextWindow: 200_000 },
          'pi/claude-sonnet-4-6',
        ],
        defaultModel: 'pi/claude-opus-4-6',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection.defaultModel).toBe(PI_ANTHROPIC_OPUS_DEFAULT)
    expect(modelIdsOf(connection)).toEqual([PI_ANTHROPIC_OPUS_DEFAULT, 'pi/claude-sonnet-4-6'])
    expect(connection.models[0].name).toBe(PI_ANTHROPIC_OPUS_DEFAULT_NAME)
  })

  it('migrates Pi Bedrock Opus 4.6 IDs to the best available Opus native IDs', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'pi-api-key',
        name: 'Craft Agents Backend (Bedrock)',
        providerType: 'pi',
        authType: 'iam_credentials',
        piAuthProvider: 'amazon-bedrock',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: [
          { id: 'pi/us.anthropic.claude-opus-4-6-v1', name: 'Opus 4.6', shortName: 'Opus', provider: 'pi', contextWindow: 200_000 },
          'pi/us.anthropic.claude-sonnet-4-6',
        ],
        defaultModel: 'pi/us.anthropic.claude-opus-4-6-v1',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection.defaultModel).toBe(PI_BEDROCK_OPUS_DEFAULT)
    expect(modelIdsOf(connection)).toEqual([PI_BEDROCK_OPUS_DEFAULT, 'pi/us.anthropic.claude-sonnet-4-6'])
    expect(connection.models[0].name).toBe(PI_BEDROCK_OPUS_DEFAULT_NAME)
  })

  it('migrates legacy unprefixed Pi Anthropic Opus 4.6 IDs to pi-prefixed best available Opus', () => {
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
        models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-6',
      },
    ])

    runMigration(configDir)

    const connection = readPiApiKeyConnection(configPath)
    expect(connection.defaultModel).toBe(PI_ANTHROPIC_OPUS_DEFAULT)
    expect(modelIdsOf(connection)).toEqual([PI_ANTHROPIC_OPUS_DEFAULT, 'pi/claude-sonnet-4-6'])
  })

  it('migrates legacy Bedrock provider Opus 4.6 IDs to Pi Bedrock best available Opus', () => {
    const { configDir, workspaceRoot, configPath } = setupWorkspaceConfigDir()

    writeRootConfig(configPath, workspaceRoot, [
      {
        slug: 'legacy-bedrock',
        name: 'Legacy Bedrock',
        providerType: 'bedrock',
        authType: 'iam_credentials',
        modelSelectionMode: 'userDefined3Tier',
        createdAt: Date.now(),
        models: ['claude-opus-4-6', 'claude-sonnet-4-6'],
        defaultModel: 'claude-opus-4-6',
      },
    ])

    runMigration(configDir)

    const connection = findConnection(configPath, 'legacy-bedrock')
    expect(connection.providerType).toBe('pi')
    expect(connection.piAuthProvider).toBe('amazon-bedrock')
    expect(connection.defaultModel).toBe(PI_BEDROCK_OPUS_DEFAULT)
    expect(modelIdsOf(connection)).toEqual([PI_BEDROCK_OPUS_DEFAULT, 'pi/us.anthropic.claude-sonnet-4-6'])
  })
})
