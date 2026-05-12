export type MarketplaceServiceEnvironment = 'production' | 'staging' | 'local'

export type MarketplaceBuildChannel = 'production' | 'development' | 'internal'

export interface MarketplaceServiceConfig {
  environment: MarketplaceServiceEnvironment
  label: string
  baseUrl: string
}

export interface MarketplaceServiceConfigInput {
  buildChannel?: MarketplaceBuildChannel
  requestedEnvironment?: string | null
  requestedBaseUrl?: string | null
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
