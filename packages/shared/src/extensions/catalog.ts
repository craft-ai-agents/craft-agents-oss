/**
 * CatalogProvider interface + Craft curated provider (wraps marketplace catalog).
 * SiYuan Bazaar accepts optional listFn (W6 bridge); default empty.
 */

import type { MarketplaceCatalog, MarketplaceEntry } from '../marketplace/catalog.ts'
import { marketplaceEntryToCatalogEntry } from './adapters/marketplace.ts'
import type {
  CatalogEntry,
  CatalogFilter,
  ExtensionProviderId,
} from './types.ts'
import {
  SiyuanBazaarProvider as SiyuanBazaarProviderImpl,
  type SiyuanBazaarListFn,
} from './siyuan-bridge/bazaar.ts'

/** Opaque package bytes / metadata from a provider fetch (W5: unused beyond type). */
export interface ExtensionPackage {
  id: string
  version: string
  /** Provider-specific payload (e.g. marketplace entry). */
  payload: unknown
}

export interface CatalogProvider {
  id: ExtensionProviderId
  label: string
  list(filter?: CatalogFilter): Promise<CatalogEntry[]>
  fetch(id: string, version: string): Promise<ExtensionPackage | null>
}

function matchesFilter(entry: CatalogEntry, filter?: CatalogFilter): boolean {
  if (!filter) return true
  if (filter.category && filter.category !== 'all' && entry.category !== filter.category) {
    return false
  }
  if (filter.runtime && entry.runtime !== filter.runtime) return false
  if (filter.providerId && entry.providerId !== filter.providerId) return false
  if (filter.query) {
    const q = filter.query.trim().toLowerCase()
    if (!q) return true
    const hay = [entry.name, entry.description ?? '', entry.id, ...(entry.tags ?? [])]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

export interface CraftCuratedProviderOptions {
  /** Sync catalog loader (tests inject; production passes getCatalog().catalog). */
  loadCatalog: () => Promise<MarketplaceCatalog> | MarketplaceCatalog
}

/** Wraps existing marketplace catalog as CatalogProvider. */
export class CraftCuratedProvider implements CatalogProvider {
  readonly id = 'craft-curated' as const
  readonly label = 'Craft curated'
  private readonly loadCatalog: CraftCuratedProviderOptions['loadCatalog']

  constructor(options: CraftCuratedProviderOptions) {
    this.loadCatalog = options.loadCatalog
  }

  async list(filter?: CatalogFilter): Promise<CatalogEntry[]> {
    const catalog = await this.loadCatalog()
    const entries = (catalog.entries ?? []).map((e: MarketplaceEntry) =>
      marketplaceEntryToCatalogEntry(e),
    )
    return entries.filter((e) => matchesFilter(e, filter))
  }

  async fetch(id: string, _version: string): Promise<ExtensionPackage | null> {
    const marketplaceId = id.startsWith('marketplace:') ? id.slice('marketplace:'.length) : id
    const catalog = await this.loadCatalog()
    const entry = (catalog.entries ?? []).find((e) => e.id === marketplaceId)
    if (!entry) return null
    return {
      id: `marketplace:${entry.id}`,
      version: entry.source.ref,
      payload: entry,
    }
  }
}



export class CatalogRegistry {
  private readonly providers = new Map<ExtensionProviderId, CatalogProvider>()

  register(provider: CatalogProvider): void {
    this.providers.set(provider.id, provider)
  }

  get(id: ExtensionProviderId): CatalogProvider | undefined {
    return this.providers.get(id)
  }

  listProviders(): CatalogProvider[] {
    return [...this.providers.values()]
  }

  async listAll(filter?: CatalogFilter): Promise<CatalogEntry[]> {
    const batches = await Promise.all(this.listProviders().map((p) => p.list(filter)))
    return batches.flat()
  }
}

/** Default registry: craft-curated + siyuan-bazaar (optional listFn). */
export function createDefaultCatalogRegistry(
  loadCatalog: CraftCuratedProviderOptions['loadCatalog'],
  opts?: { bazaarListFn?: SiyuanBazaarListFn },
): CatalogRegistry {
  const registry = new CatalogRegistry()
  registry.register(new CraftCuratedProvider({ loadCatalog }))
  registry.register(new SiyuanBazaarProviderImpl(opts?.bazaarListFn))
  return registry
}
