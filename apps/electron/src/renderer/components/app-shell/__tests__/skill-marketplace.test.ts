import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createStaticMarketplaceApi,
  loadMarketplaceCatalog,
  loadMarketplaceDetail,
  MarketplaceDetail,
  MarketplaceError,
  MarketplaceListingCard,
} from '../SkillMarketplacePage'

describe('SkillMarketplacePage API boundary', () => {
  test('loads list results filtered by search, product category, and publisher tag', async () => {
    const api = createStaticMarketplaceApi()

    const result = await loadMarketplaceCatalog(api, {
      search: 'test',
      category: 'Quality',
      tag: 'ci',
    })

    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready catalog state')
    expect(result.listings.map((listing) => listing.slug)).toEqual(['test-writer'])
    expect(result.availableCategories).toContain('Quality')
    expect(result.availableTags).toContain('ci')
  })

  test('renders listing card metadata and install/update placeholders', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceCatalog(api, {})
    if (result.status !== 'ready') throw new Error('Expected ready catalog state')

    const html = renderToStaticMarkup(React.createElement(MarketplaceListingCard, {
      listing: result.listings[2],
      selected: false,
      onSelect: () => {},
    }))

    expect(html).toContain('Release Notes')
    expect(html).toContain('Launch Team')
    expect(html).toContain('v1.8.0')
    expect(html).toContain('Product')
    expect(html).toContain('release')
    expect(html).toContain('Update available')
  })

  test('loads and renders Marketplace Skill detail content read-only', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, { detail: result.detail }))

    expect(html).toContain('Published SKILL.md')
    expect(html).toContain('name: Test Writer')
    expect(html).toContain('Version History')
    expect(html).toContain('Adds CI-focused assertion guidance.')
    expect(html).toContain('Required Sources')
    expect(html).toContain('GitHub repository')
    expect(html).toContain('Marketplace ID')
    expect(html).toContain('Install placeholder')
    expect(html).toContain('Report placeholder')
    expect(html).toContain('Owner actions')
  })

  test('returns and renders Marketplace outage states without local skills coupling', async () => {
    const api = createStaticMarketplaceApi({ listError: 'Service maintenance window.' })

    const result = await loadMarketplaceCatalog(api, {})
    const html = renderToStaticMarkup(React.createElement(MarketplaceError, {
      message: result.status === 'error' ? result.message : '',
      onRetry: () => {},
    }))

    expect(result).toEqual({ status: 'error', message: 'Service maintenance window.' })
    expect(html).toContain('Marketplace is unavailable')
    expect(html).toContain('Service maintenance window.')
    expect(html).not.toContain('Local Skills')
  })
})
