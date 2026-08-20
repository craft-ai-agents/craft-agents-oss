/**
 * SiYuan Bazaar catalog provider (W6).
 *
 * Accepts an optional listFn for fixtures / in-memory catalogs. Default is
 * empty — live kernel Bazaar listing is residual and fail-soft.
 * listFn may return CatalogEntry[] (already mapped with bazaar coords),
 * SiYuanBridgeManifest[], or PluginBridgeListItem[].
 */

import type { CatalogProvider, ExtensionPackage } from '../catalog.ts'
import type { CatalogEntry, CatalogFilter } from '../types.ts'
import { detectCompatLevel, parseSiYuanPluginManifest, localizedText } from './manifest.ts'
import { pluginJsonToCatalogEntry } from './record.ts'
import type {
  PluginBridgeListItem,
  SiYuanBridgeManifest,
} from './types.ts'

export type SiyuanBazaarListFn = () =>
  | Promise<CatalogEntry[] | SiYuanBridgeManifest[] | PluginBridgeListItem[]>
  | CatalogEntry[]
  | SiYuanBridgeManifest[]
  | PluginBridgeListItem[]

function isListItem(value: unknown): value is PluginBridgeListItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string') return false
  if (typeof v.name !== 'string') return false
  if (typeof v.version !== 'string') return false
  if (typeof v.level !== 'number') return false
  if (typeof v.enabled !== 'boolean') return false
  // Full manifests carry craft / plugin.json-only fields; list items do not.
  if ('craft' in v || 'minAppVersion' in v || 'backends' in v || 'frontends' in v) return false
  return true
}
function listItemToCatalogEntry(item: PluginBridgeListItem): CatalogEntry {
  const id = item.id.startsWith('siyuan-plugin:')
    ? item.id
    : `siyuan-plugin:${item.name}`
  const tags = [`compat-l${item.level}`, `level:${item.level}`, 'siyuan-plugin']
  if (item.requiresFullChrome) tags.push('requiresFullChrome')
  return {
    id,
    name: item.displayName ?? item.name,
    version: item.version,
    description: item.description,
    category: 'knowledge',
    runtime: 'siyuan-plugin',
    providerId: 'siyuan-bazaar',
    permissions: item.level >= 2 ? ['ui.command'] : [],
    worksIn:
      item.level >= 3
        ? [
            'Knowledge surface',
            'Compatibility mode',
            'Command palette',
            'Status bar',
            'Panels',
            'Agent tools',
          ]
        : item.level >= 2
          ? ['Knowledge surface', 'Compatibility mode', 'Command palette', 'Status bar']
          : item.level >= 1
            ? ['Knowledge surface', 'Compatibility mode']
            : ['Compatibility mode'],
    tags,
  }
}

function matchesFilter(entry: CatalogEntry, filter?: CatalogFilter): boolean {
  if (!filter) return true
  if (filter.category && filter.category !== 'all' && entry.category !== filter.category) {
    return false
  }
  if (filter.runtime && entry.runtime !== filter.runtime) return false
  if (filter.providerId && entry.providerId !== filter.providerId) return false
  if (filter.query) {
    const q = filter.query.toLowerCase()
    const hay = `${entry.name} ${entry.description ?? ''} ${(entry.tags ?? []).join(' ')}`.toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.version === 'string' &&
    typeof v.runtime === 'string' &&
    typeof v.providerId === 'string' &&
    Array.isArray(v.permissions) &&
    Array.isArray(v.worksIn)
  )
}

function toCatalogEntries(
  items: CatalogEntry[] | SiYuanBridgeManifest[] | PluginBridgeListItem[],
): CatalogEntry[] {
  return items.map((item) => {
    if (isCatalogEntry(item)) return item
    // Prefer full manifests when present.
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as SiYuanBridgeManifest).name === 'string' &&
      typeof (item as SiYuanBridgeManifest).version === 'string' &&
      ('craft' in item || !isListItem(item))
    ) {
      const parsed =
        parseSiYuanPluginManifest(item) ??
        (item as SiYuanBridgeManifest)
      const level = detectCompatLevel(parsed)
      return pluginJsonToCatalogEntry(parsed, level)
    }
    return listItemToCatalogEntry(item as PluginBridgeListItem)
  })
}

export class SiyuanBazaarProvider implements CatalogProvider {
  readonly id = 'siyuan-bazaar' as const
  readonly label = 'SiYuan Bazaar'
  private readonly listFn: SiyuanBazaarListFn

  constructor(listFn?: SiyuanBazaarListFn) {
    this.listFn = listFn ?? (() => [])
  }

  async list(filter?: CatalogFilter): Promise<CatalogEntry[]> {
    try {
      const raw = await this.listFn()
      if (!Array.isArray(raw)) return []
      return toCatalogEntries(raw).filter((e) => matchesFilter(e, filter))
    } catch {
      return []
    }
  }

  async fetch(id: string, version: string): Promise<ExtensionPackage | null> {
    try {
      const entries = await this.list()
      const hit = entries.find((e) => e.id === id && e.version === version)
      if (!hit) return null
      return { id: hit.id, version: hit.version, payload: hit }
    } catch {
      return null
    }
  }
}

/** Factory matching createSiyuanBazaarProvider(listFn?) contract. */
export function createSiyuanBazaarProvider(listFn?: SiyuanBazaarListFn): CatalogProvider {
  return new SiyuanBazaarProvider(listFn)
}

/** Re-export for callers that want localized display helpers alongside bazaar. */
export { localizedText }
