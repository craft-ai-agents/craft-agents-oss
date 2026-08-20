/**
 * SiYuan bridge manifest → ExtensionRecord / CatalogEntry projections (W6).
 */

import { parseExtensionManifest } from '../manifest.ts'
import type { CatalogEntry, ExtensionRecord } from '../types.ts'
import { localizedText } from './manifest.ts'
import type { CompatLevel, SiYuanBridgeManifest } from './types.ts'

function worksInForLevel(level: CompatLevel): string[] {
  switch (level) {
    case 0:
      return ['Compatibility mode']
    case 1:
      return ['Knowledge surface', 'Compatibility mode']
    case 2:
      return ['Knowledge surface', 'Compatibility mode', 'Command palette', 'Status bar']
    case 3:
      return [
        'Knowledge surface',
        'Compatibility mode',
        'Command palette',
        'Status bar',
        'Panels',
        'Agent tools',
      ]
    default:
      return ['Compatibility mode']
  }
}

function tagsFor(
  level: CompatLevel,
  opts?: { requiresFullChrome?: boolean; extra?: string[] },
): string[] {
  const tags = [`compat-l${level}`, `level:${level}`, 'siyuan-plugin']
  if (opts?.requiresFullChrome) {
    tags.push('requiresFullChrome')
  }
  if (opts?.extra) {
    for (const t of opts.extra) {
      if (t && !tags.includes(t)) tags.push(t)
    }
  }
  return tags
}

function extensionId(name: string): string {
  return `siyuan-plugin:${name}`
}

/** Pure: SiYuan bridge manifest → ExtensionRecord. */
export function pluginJsonToExtensionRecord(
  manifest: SiYuanBridgeManifest,
  level: CompatLevel,
  enabled: boolean,
): ExtensionRecord {
  const id = extensionId(manifest.name)
  const description = localizedText(manifest.description)
  const displayName = localizedText(manifest.displayName) ?? manifest.name

  const permissions =
    level >= 3
      ? (['ui.panel', 'ui.command'] as const)
      : level >= 2
        ? (['ui.command'] as const)
        : ([] as const)

  const extManifest = parseExtensionManifest({
    id,
    name: displayName,
    version: manifest.version,
    runtime: 'siyuan-plugin',
    permissions: [...permissions],
  })

  return {
    id,
    manifest: extManifest,
    category: 'knowledge',
    providerId: 'siyuan-bazaar',
    status: enabled ? 'enabled' : 'disabled',
    worksIn: worksInForLevel(level),
    description,
    // Bazaar-managed: uninstall via kernel is allowed (not a read-only projection).
    readOnly: false,
    tags: tagsFor(level, { requiresFullChrome: manifest.craft?.requiresFullChrome }),
    sourceEnabled: enabled,
  }
}

export interface PluginJsonToCatalogEntryOptions {
  bazaar?: {
    packageName: string
    repoURL: string
    repoHash: string
  }
}

/** Pure: SiYuan bridge manifest → CatalogEntry. */
export function pluginJsonToCatalogEntry(
  manifest: SiYuanBridgeManifest,
  level: CompatLevel,
  opts?: PluginJsonToCatalogEntryOptions,
): CatalogEntry {
  const id = extensionId(manifest.name)
  const description = localizedText(manifest.description)
  const displayName = localizedText(manifest.displayName) ?? manifest.name

  const permissions =
    level >= 3
      ? (['ui.panel', 'ui.command'] as const)
      : level >= 2
        ? (['ui.command'] as const)
        : ([] as const)

  return {
    id,
    name: displayName,
    version: manifest.version,
    description,
    category: 'knowledge',
    runtime: 'siyuan-plugin',
    providerId: 'siyuan-bazaar',
    permissions: [...permissions],
    worksIn: worksInForLevel(level),
    tags: tagsFor(level, { requiresFullChrome: manifest.craft?.requiresFullChrome }),
    ...(opts?.bazaar ? { bazaar: opts.bazaar } : {}),
  }
}
