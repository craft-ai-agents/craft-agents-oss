import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePluginManifest, type CraftPluginManifest } from '@craft-agent/shared/plugins'

export interface PluginManifestLoadFailure {
  pluginPath: string
  error: string
}

export interface PluginManifestDirectoryLoadResult {
  manifests: Array<{ manifest: CraftPluginManifest; pluginRoot: string }>
  failures: PluginManifestLoadFailure[]
}

type PluginManifestLoadResult
  = | { manifest: CraftPluginManifest; pluginPath: string; pluginRoot: string }
    | PluginManifestLoadFailure

export async function loadPluginManifest(filePath: string): Promise<CraftPluginManifest> {
  const raw = await readFile(filePath, 'utf-8')
  return parsePluginManifest(JSON.parse(raw))
}

export async function loadPluginManifestsFromDirectory(
  dirPath: string,
): Promise<PluginManifestDirectoryLoadResult> {
  if (!existsSync(dirPath)) {
    return { manifests: [], failures: [] }
  }

  const entries = await readdir(dirPath, { withFileTypes: true })
  const pluginDirs = entries.filter((entry) => entry.isDirectory())
  const results: PluginManifestLoadResult[] = await Promise.all(
    pluginDirs.map(async (entry) => {
      const pluginRoot = join(dirPath, entry.name)
      const pluginPath = join(dirPath, entry.name, 'plugin.json')
      try {
        return { manifest: await loadPluginManifest(pluginPath), pluginPath, pluginRoot }
      } catch (error) {
        return {
          pluginPath,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )

  const manifests: Array<{ manifest: CraftPluginManifest; pluginRoot: string }> = []
  const failures: PluginManifestLoadFailure[] = []

  for (const result of results) {
    if ('manifest' in result) {
      manifests.push({ manifest: result.manifest, pluginRoot: result.pluginRoot })
      continue
    }
    failures.push(result)
  }

  return { manifests, failures }
}
