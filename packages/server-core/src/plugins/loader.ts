import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePluginManifest, type CraftPluginManifest } from '@craft-agent/shared/plugins'

export async function loadPluginManifest(filePath: string): Promise<CraftPluginManifest> {
  const raw = await readFile(filePath, 'utf-8')
  return parsePluginManifest(JSON.parse(raw))
}

export async function loadPluginManifestsFromDirectory(dirPath: string): Promise<CraftPluginManifest[]> {
  if (!existsSync(dirPath)) {
    return []
  }

  const entries = await readdir(dirPath, { withFileTypes: true })
  const pluginDirs = entries.filter((entry) => entry.isDirectory())
  const manifests = await Promise.all(
    pluginDirs.map(async (entry) => loadPluginManifest(join(dirPath, entry.name, 'plugin.json'))),
  )

  return manifests
}
