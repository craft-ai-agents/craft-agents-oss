/**
 * Marketplace — curated catalog, install registry, stats, installer.
 * Spec: docs/runtime-context-marketplace-prd.md §8, plan §5 (M4a).
 */

export * from './catalog.ts'
export * from './catalog-signing.ts'
export * from './lock.ts'
export * from './stats.ts'
export * from './installer.ts'

import type { CatalogLoadResult } from './catalog.ts'
import type { MarketplaceLockRecord } from './lock.ts'

/** marketplace:catalog / marketplace:refresh result — catalog view plus the local install registry. */
export interface MarketplaceCatalogResult extends CatalogLoadResult {
  /** Installed entries by id (lock.json). */
  installs: Record<string, MarketplaceLockRecord>
}
