import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  prepareHermesPluginBackendRegistration,
  type HermesRuntimeOptions,
} from '../hermes-runtime'

let tempRoot = ''

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'hermes-runtime-'))
})

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

function createOptions(overrides: Partial<HermesRuntimeOptions> = {}): HermesRuntimeOptions {
  return {
    pluginId: 'external.hermes',
    backendId: 'hermes',
    helperPath: '/tmp/hermes-helper.mjs',
    env: {},
    homeRoot: tempRoot,
    ...overrides,
  }
}

describe('prepareHermesPluginBackendRegistration', () => {
  it('prepares a managed craft-bridge profile with a stable api key and helper env', async () => {
    const registration = await prepareHermesPluginBackendRegistration(createOptions())

    expect(registration.backendId).toBe('hermes')
    expect(registration.pluginId).toBe('external.hermes')
    expect(registration.envOverrides?.CRAFT_HERMES_MODE).toBe('managed')
    expect(registration.envOverrides?.CRAFT_HERMES_PROFILE).toBe('craft-bridge')
    expect(registration.envOverrides?.CRAFT_HERMES_BASE_URL).toBe('http://127.0.0.1:8642')
    expect(registration.envOverrides?.CRAFT_HERMES_API_KEY).toBeTruthy()
    expect(registration.envOverrides?.CRAFT_HERMES_TRANSPORT).toBe('api')
    expect(registration.supportsBranching).toBe(false)

    const profileDir = join(tempRoot, 'profiles', 'craft-bridge')
    const envFile = await readFile(join(profileDir, '.env'), 'utf8')
    const soulFile = await readFile(join(profileDir, 'SOUL.md'), 'utf8')
    const configFile = await readFile(join(profileDir, 'config.yaml'), 'utf8')

    expect(envFile).toContain('API_SERVER_ENABLED=true')
    expect(envFile).toContain('API_SERVER_PORT=8642')
    expect(envFile).toContain(`API_SERVER_KEY=${registration.envOverrides?.CRAFT_HERMES_API_KEY}`)
    expect(soulFile).toContain('Craft Agents')
    expect(configFile).toContain('mcp_servers')

    const second = await prepareHermesPluginBackendRegistration(createOptions())
    expect(second.envOverrides?.CRAFT_HERMES_API_KEY).toBe(registration.envOverrides?.CRAFT_HERMES_API_KEY)
  })

  it('uses external mode only when base url and api key are supplied', async () => {
    await expect(prepareHermesPluginBackendRegistration(createOptions({
      env: {
        CRAFT_HERMES_MODE: 'external',
        CRAFT_HERMES_BASE_URL: 'http://127.0.0.1:9000',
      },
    }))).rejects.toThrow('CRAFT_HERMES_API_KEY')

    const external = await prepareHermesPluginBackendRegistration(createOptions({
      env: {
        CRAFT_HERMES_MODE: 'external',
        CRAFT_HERMES_BASE_URL: 'http://127.0.0.1:9000',
        CRAFT_HERMES_API_KEY: 'secret',
        CRAFT_HERMES_TRANSPORT: 'cli',
      },
    }))

    expect(external.envOverrides?.CRAFT_HERMES_MODE).toBe('external')
    expect(external.envOverrides?.CRAFT_HERMES_BASE_URL).toBe('http://127.0.0.1:9000')
    expect(external.envOverrides?.CRAFT_HERMES_API_KEY).toBe('secret')
    expect(external.envOverrides?.CRAFT_HERMES_TRANSPORT).toBe('cli')
  })

  it('preserves an existing api key in the profile env file', async () => {
    const profileDir = join(tempRoot, 'profiles', 'craft-bridge')
    await mkdir(profileDir, { recursive: true })
    await writeFile(join(profileDir, '.env'), 'API_SERVER_KEY=existing-key\n')

    const registration = await prepareHermesPluginBackendRegistration(createOptions())
    expect(registration.envOverrides?.CRAFT_HERMES_API_KEY).toBe('existing-key')
  })
})
