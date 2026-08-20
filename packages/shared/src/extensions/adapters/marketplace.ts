/**
 * MarketplaceEntry → CatalogEntry / ExtensionRecord (projection only).
 */

import type { MarketplaceEntry, MarketplaceEntryKind } from '../../marketplace/catalog.ts'
import type { MarketplaceLockRecord } from '../../marketplace/lock.ts'
import type {
  CatalogCategory,
  CatalogEntry,
  ExtensionInstallTarget,
  ExtensionPermission,
  ExtensionRecord,
  ExtensionRuntime,
  ExtensionStatus,
} from '../types.ts'
import { parseExtensionManifest } from '../manifest.ts'

const KIND_RUNTIME: Record<MarketplaceEntryKind, ExtensionRuntime> = {
  skillpack: 'skill-pack',
  tool: 'agent-runtime',
  'context-doc': 'craft-native',
}

const KIND_CATEGORY: Record<MarketplaceEntryKind, CatalogCategory> = {
  skillpack: 'skills',
  tool: 'agent-runtimes',
  'context-doc': 'knowledge',
}

const KIND_PERMISSIONS: Record<MarketplaceEntryKind, ExtensionPermission[]> = {
  skillpack: ['ui.command'],
  tool: ['shell.execute', 'network.request'],
  'context-doc': ['filesystem.read', 'ui.command'],
}

const KIND_WORKS_IN: Record<MarketplaceEntryKind, string[]> = {
  skillpack: ['Agent sessions', 'Command palette', 'Skills panel'],
  tool: ['Toolchain', 'Agent sessions'],
  'context-doc': ['Context docs', 'Agent sessions'],
}

const KIND_INSTALL: Record<MarketplaceEntryKind, ExtensionInstallTarget> = {
  skillpack: 'global',
  tool: 'global',
  'context-doc': 'global',
}

export function marketplaceKindToRuntime(kind: MarketplaceEntryKind): ExtensionRuntime {
  return KIND_RUNTIME[kind]
}

export function marketplaceKindToCategory(kind: MarketplaceEntryKind): CatalogCategory {
  return KIND_CATEGORY[kind]
}

/** Pure: MarketplaceEntry → CatalogEntry. */
export function marketplaceEntryToCatalogEntry(entry: MarketplaceEntry): CatalogEntry {
  return {
    id: `marketplace:${entry.id}`,
    name: entry.title,
    version: entry.source.ref.slice(0, 7),
    description: entry.descriptionRu,
    category: KIND_CATEGORY[entry.kind],
    runtime: KIND_RUNTIME[entry.kind],
    providerId: 'craft-curated',
    permissions: KIND_PERMISSIONS[entry.kind],
    worksIn: KIND_WORKS_IN[entry.kind],
    installTarget: KIND_INSTALL[entry.kind],
    tags: entry.tags,
    marketplaceKind: entry.kind,
    marketplaceId: entry.id,
    dependencies: entry.skills,
  }
}

export interface MarketplaceRecordOptions {
  /** Lock record when installed. */
  lock?: MarketplaceLockRecord | null
  /** Explicit enable flag from extensions state store; default true when installed. */
  enabled?: boolean
}

/** Pure: MarketplaceEntry (+ optional lock) → ExtensionRecord. */
export function marketplaceEntryToRecord(
  entry: MarketplaceEntry,
  options: MarketplaceRecordOptions = {},
): ExtensionRecord {
  const catalog = marketplaceEntryToCatalogEntry(entry)
  const installed = Boolean(options.lock)
  let status: ExtensionStatus = 'available'
  if (installed) {
    // Catalog tip ahead of lock → surface update before enabled/disabled.
    if (options.lock && options.lock.ref !== entry.source.ref) {
      status = 'update-available'
    } else if (options.enabled === false) {
      status = 'disabled'
    } else {
      status = 'enabled'
    }
  }

  const manifest = parseExtensionManifest({
    id: catalog.id,
    name: catalog.name,
    version: catalog.version,
    runtime: catalog.runtime,
    permissions: catalog.permissions,
    dependencies: catalog.dependencies,
    contributes:
      entry.kind === 'skillpack'
        ? { skills: (entry.skills ?? []).map((slug) => ({ slug })) }
        : entry.kind === 'tool'
          ? { agentActions: [{ id: entry.toolName ?? entry.id }] }
          : undefined,
  })

  return {
    id: catalog.id,
    manifest,
    category: catalog.category,
    providerId: 'craft-curated',
    status,
    worksIn: catalog.worksIn,
    installTarget: catalog.installTarget,
    description: catalog.description,
    readOnly: false,
    marketplaceKind: entry.kind,
    marketplaceId: entry.id,
    tags: entry.tags,
  }
}
