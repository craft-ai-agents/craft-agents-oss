import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ExternalPluginBackendRegistration } from '@craft-agent/shared/agent/backend'

export interface HermesRuntimeOptions {
  pluginId: string
  backendId: string
  helperPath: string
  helperRuntimePath?: string
  env?: Record<string, string | undefined>
  homeRoot?: string
}

const DEFAULT_HERMES_HOME = join(process.env.HOME || '/tmp', '.hermes')
const DEFAULT_PROFILE = 'craft-bridge'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = '8642'

export async function prepareHermesPluginBackendRegistration(
  options: HermesRuntimeOptions,
): Promise<ExternalPluginBackendRegistration> {
  const env = options.env ?? process.env
  const mode = env.CRAFT_HERMES_MODE === 'external' ? 'external' : 'managed'
  const transport = env.CRAFT_HERMES_TRANSPORT === 'cli' ? 'cli' : 'api'

  if (mode === 'external') {
    const baseUrl = env.CRAFT_HERMES_BASE_URL?.trim()
    const apiKey = env.CRAFT_HERMES_API_KEY?.trim()
    if (!baseUrl) {
      throw new Error('CRAFT_HERMES_BASE_URL is required when CRAFT_HERMES_MODE=external')
    }
    if (!apiKey) {
      throw new Error('CRAFT_HERMES_API_KEY is required when CRAFT_HERMES_MODE=external')
    }

    return {
      backendId: options.backendId,
      pluginId: options.pluginId,
      helperPath: options.helperPath,
      helperRuntimePath: options.helperRuntimePath,
      supportsBranching: false,
      envOverrides: {
        CRAFT_HERMES_MODE: 'external',
        CRAFT_HERMES_BASE_URL: baseUrl,
        CRAFT_HERMES_API_KEY: apiKey,
        CRAFT_HERMES_TRANSPORT: transport,
      },
    }
  }

  const homeRoot = options.homeRoot || env.CRAFT_HERMES_HOME || DEFAULT_HERMES_HOME
  const profile = env.CRAFT_HERMES_PROFILE?.trim() || DEFAULT_PROFILE
  const host = env.CRAFT_HERMES_HOST?.trim() || DEFAULT_HOST
  const port = env.CRAFT_HERMES_PORT?.trim() || DEFAULT_PORT
  const baseUrl = env.CRAFT_HERMES_BASE_URL?.trim() || `http://${host}:${port}`
  const profileDir = join(homeRoot, 'profiles', profile)
  const envPath = join(profileDir, '.env')
  const configPath = join(profileDir, 'config.yaml')
  const soulPath = join(profileDir, 'SOUL.md')

  await mkdir(profileDir, { recursive: true })

  const existingEnv = await readIfExists(envPath)
  const currentApiKey = parseEnvFile(existingEnv).API_SERVER_KEY?.trim() || env.CRAFT_HERMES_API_KEY?.trim()
  const apiKey = currentApiKey || randomUUID()

  await writeFile(envPath, mergeEnvContent(existingEnv, {
    API_SERVER_ENABLED: 'true',
    API_SERVER_HOST: host,
    API_SERVER_PORT: port,
    API_SERVER_KEY: apiKey,
  }))

  await writeIfMissing(
    configPath,
    [
      'platforms:',
      '  api_server:',
      '    enabled: true',
      '    extra:',
      `      host: ${host}`,
      `      port: ${port}`,
      'mcp_servers: {}',
      '',
    ].join('\n'),
  )

  await writeIfMissing(
    soulPath,
    [
      '# Craft Agents Hermes Bridge',
      '',
      'This profile is managed by Craft Agents for Hermes backend integration.',
      'Keep Hermes-native skills and runtime defaults here.',
      '',
    ].join('\n'),
  )

  return {
    backendId: options.backendId,
    pluginId: options.pluginId,
    helperPath: options.helperPath,
    helperRuntimePath: options.helperRuntimePath,
    supportsBranching: false,
    envOverrides: {
      CRAFT_HERMES_MODE: 'managed',
      CRAFT_HERMES_PROFILE: profile,
      CRAFT_HERMES_HOME: homeRoot,
      CRAFT_HERMES_BASE_URL: baseUrl,
      CRAFT_HERMES_API_KEY: apiKey,
      CRAFT_HERMES_TRANSPORT: transport,
    },
  }
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  const existing = await readIfExists(path)
  if (existing.trim()) return
  await writeFile(path, content)
}

function parseEnvFile(content: string): Record<string, string> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf('=')
      if (separator <= 0) return acc
      acc[line.slice(0, separator)] = line.slice(separator + 1)
      return acc
    }, {})
}

function mergeEnvContent(existing: string, updates: Record<string, string>): string {
  const merged = {
    ...parseEnvFile(existing),
    ...updates,
  }

  return `${Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`
}
