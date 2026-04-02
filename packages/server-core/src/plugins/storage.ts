import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface PluginStateEntry {
  enabled?: boolean
  status?: 'active' | 'disabled' | 'incompatible' | 'quarantined'
  error?: string
}

export interface PluginStateStore {
  plugins: Record<string, PluginStateEntry>
}

export function getDefaultPluginDirectory(): string {
  return join(homedir(), '.craft-agent', 'plugins')
}

export function getDefaultPluginStatePath(): string {
  return join(homedir(), '.craft-agent', 'plugin-state.json')
}

export async function readPluginState(filePath = getDefaultPluginStatePath()): Promise<PluginStateStore> {
  if (!existsSync(filePath)) {
    return { plugins: {} }
  }

  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PluginStateStore
    return {
      plugins: parsed.plugins ?? {},
    }
  } catch {
    return { plugins: {} }
  }
}

export async function writePluginState(
  state: PluginStateStore,
  filePath = getDefaultPluginStatePath(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2))
}
