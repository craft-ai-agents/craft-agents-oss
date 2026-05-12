import { describe, expect, test } from 'bun:test'
import { resolveMarketplaceServiceConfig } from '../marketplace-config.ts'

describe('resolveMarketplaceServiceConfig', () => {
  test('uses product-owned production Marketplace configuration by default', () => {
    expect(resolveMarketplaceServiceConfig()).toEqual({
      environment: 'production',
      label: 'Production',
      baseUrl: 'https://marketplace.craftagents.com',
    })
  })

  test('allows development and internal builds to select approved Marketplace service environments', () => {
    expect(resolveMarketplaceServiceConfig({
      buildChannel: 'development',
      requestedEnvironment: 'staging',
    })).toEqual({
      environment: 'staging',
      label: 'Staging',
      baseUrl: 'https://staging.marketplace.craftagents.com',
    })

    expect(resolveMarketplaceServiceConfig({
      buildChannel: 'internal',
      requestedEnvironment: 'local',
    })).toEqual({
      environment: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:8791',
    })
  })

  test('ignores user-supplied URLs and unapproved environment names', () => {
    expect(resolveMarketplaceServiceConfig({
      buildChannel: 'production',
      requestedEnvironment: 'local',
      requestedBaseUrl: 'https://attacker.example',
    })).toEqual({
      environment: 'production',
      label: 'Production',
      baseUrl: 'https://marketplace.craftagents.com',
    })

    expect(resolveMarketplaceServiceConfig({
      buildChannel: 'development',
      requestedEnvironment: 'https://attacker.example',
      requestedBaseUrl: 'https://attacker.example',
    })).toEqual({
      environment: 'production',
      label: 'Production',
      baseUrl: 'https://marketplace.craftagents.com',
    })
  })
})
