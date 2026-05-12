import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createStaticMarketplaceApi,
  installMarketplaceSkillFromDetail,
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
    expect(html).toContain('Install')
    expect(html).toContain('Report placeholder')
    expect(html).toContain('Owner actions')
  })

  test('installs Marketplace Skill detail only after authenticated intent and local install succeed', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const completed: string[] = []

    const installResult = await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail: result.detail,
      api: {
        ...api,
        async createInstallIntent() {
          return { intentId: 'intent_1', downloadUrl: 'data:application/zip;base64,AA==', expectedSha256: 'hash' }
        },
        async recordInstallComplete(intentId) {
          completed.push(intentId)
        },
      },
      electronAPI: {
        async installMarketplaceSkill(_workspaceId, input) {
          expect(input.userId).toBe('user_1')
          expect(input.skill.marketplaceId).toBe('mkt_skill_test_writer')
          return { status: 'installed', slug: 'test-writer' }
        },
      },
    })

    expect(installResult).toEqual({ status: 'installed', slug: 'test-writer' })
    expect(completed).toEqual(['intent_1'])
  })

  test('does not request install intent for anonymous Marketplace install action', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const installResult = await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: null,
      detail: result.detail,
      api: {
        ...api,
        async createInstallIntent() {
          throw new Error('should not request intent')
        },
      },
      electronAPI: {
        async installMarketplaceSkill() {
          throw new Error('should not install locally')
        },
      },
    })

    expect(installResult).toEqual({
      status: 'auth-required',
      message: 'Sign in is required to install Marketplace Skills.',
    })
  })

  test('renders install progress and conflict recovery states', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const installingHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: result.detail,
      installState: { status: 'installing' },
    }))
    const conflictHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: result.detail,
      installState: { status: 'conflict', message: 'A Local Skill with this slug already exists.' },
    }))

    expect(installingHtml).toContain('Installing...')
    expect(conflictHtml).toContain('A Local Skill with this slug already exists.')
    expect(conflictHtml).toContain('Overwrite')
    expect(conflictHtml).toContain('Skip')
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
