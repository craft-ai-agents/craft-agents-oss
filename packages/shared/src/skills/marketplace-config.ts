import { deriveSkillSlug } from './slug.ts'
import type { SkillMetadata } from './types.ts'
import type { MarketplaceOriginMetadata } from './marketplace-install.ts'

/** Approved Marketplace service environments controlled by the product build. */
export type MarketplaceServiceEnvironment = 'production' | 'staging' | 'local'

/** Product release channels that determine whether non-production Marketplace services are selectable. */
export type MarketplaceBuildChannel = 'production' | 'development' | 'internal'

/** Resolved Marketplace service endpoint used by product code. */
export interface MarketplaceServiceConfig {
  environment: MarketplaceServiceEnvironment
  label: string
  baseUrl: string
}

/** Product-controlled inputs used to select an approved Marketplace service environment. */
export interface MarketplaceServiceConfigInput {
  buildChannel?: MarketplaceBuildChannel
  requestedEnvironment?: string | null
}

const PRODUCT_MARKETPLACE_SERVICE_CONFIGS: Record<MarketplaceServiceEnvironment, MarketplaceServiceConfig> = {
  production: {
    environment: 'production',
    label: 'Production',
    baseUrl: 'https://marketplace.craftagents.com',
  },
  staging: {
    environment: 'staging',
    label: 'Staging',
    baseUrl: 'https://staging.marketplace.craftagents.com',
  },
  local: {
    environment: 'local',
    label: 'Local',
    baseUrl: 'http://127.0.0.1:8791',
  },
}

const INTERNAL_BUILD_CHANNELS = new Set<MarketplaceBuildChannel>(['development', 'internal'])

/** Resolves the Marketplace service endpoint, ignoring unapproved environment selections. */
export function resolveMarketplaceServiceConfig(input: MarketplaceServiceConfigInput = {}): MarketplaceServiceConfig {
  const buildChannel = input.buildChannel ?? 'production'
  const requestedEnvironment = parseMarketplaceServiceEnvironment(input.requestedEnvironment)

  if (!requestedEnvironment || !INTERNAL_BUILD_CHANNELS.has(buildChannel)) {
    return PRODUCT_MARKETPLACE_SERVICE_CONFIGS.production
  }

  return PRODUCT_MARKETPLACE_SERVICE_CONFIGS[requestedEnvironment]
}

function parseMarketplaceServiceEnvironment(value?: string | null): MarketplaceServiceEnvironment | null {
  if (value === 'production' || value === 'staging' || value === 'local') return value
  return null
}

// ── Browser-safe Marketplace constants and slug helpers ─────────────────────
// These are re-exported from marketplace-publish.ts for server-side use.
// Kept here (no Node.js imports) so renderer components can import them
// via the @craft-agent/shared/skills/marketplace-config subpath without
// pulling in fs/os/path/crypto modules.

export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const
export type ProductMarketplaceCategory = typeof PRODUCT_MARKETPLACE_CATEGORIES[number]

/** Suggest a publish slug that preserves owner versioning and avoids original slugs for derived publishes. */
export function suggestMarketplacePublishSlug(input: {
  metadata: Pick<SkillMetadata, 'name'>
  origin?: Pick<MarketplaceOriginMetadata, 'ownerId' | 'marketplaceSlug'> | null
  currentUserId?: string | null
}): string {
  const baseSlug = deriveSkillSlug(input.metadata.name)
  if (!input.origin || input.origin.ownerId === input.currentUserId) return baseSlug
  if (baseSlug !== input.origin.marketplaceSlug) return baseSlug
  return `${baseSlug}-derived`
}
