import { describe, expect, mock, test } from 'bun:test'
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
  LocalSkillMarketplaceStatus,
  publishMarketplaceSkill,
  SkillMarketplacePageHeader,
  updateMarketplaceSkillFromDetail,
} from '../SkillMarketplacePage'

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
mock.module('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}))
mock.module('@/components/ui/menu-context', () => ({
  useMenuComponents: () => ({
    MenuItem: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => (
      React.createElement('button', { disabled }, children)
    ),
    Separator: () => React.createElement('hr'),
  }),
}))

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

  test('renders install actions as sign-in blocked for anonymous detail viewers', async () => {
    const api = createStaticMarketplaceApi()
    const installResult = await loadMarketplaceDetail(api, 'test-writer')
    const updateResult = await loadMarketplaceDetail(api, 'release-notes')
    if (installResult.status !== 'ready' || updateResult.status !== 'ready') throw new Error('Expected ready detail state')

    const installHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: installResult.detail,
      canInstall: false,
      currentUserId: null,
    }))
    const updateHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: updateResult.detail,
      canInstall: false,
      currentUserId: null,
    }))

    expect(installHtml).toContain('Sign in to install')
    expect(updateHtml).toContain('Sign in to update')
  })

  test('requires authenticated user context before Marketplace publish handoff', async () => {
    const anonymousResult = await publishMarketplaceSkill({
      userId: null,
      skillSlug: 'local-helper',
      api: {
        async publishSkill() {
          throw new Error('should not publish')
        },
      },
    })

    expect(anonymousResult).toEqual({
      status: 'auth-required',
      message: 'Sign in is required to publish Marketplace Skills.',
    })

    const published: unknown[] = []
    const authenticatedResult = await publishMarketplaceSkill({
      userId: 'user_1',
      skillSlug: 'local-helper',
      api: {
        async publishSkill(input) {
          published.push(input)
          return { status: 'published', marketplaceSlug: 'local-helper' }
        },
      },
    })

    expect(authenticatedResult).toEqual({ status: 'published', marketplaceSlug: 'local-helper' })
    expect(published).toEqual([{ userId: 'user_1', skillSlug: 'local-helper' }])
  })

  test('renders Marketplace publish as sign-in blocked for anonymous users', () => {
    const anonymousHtml = renderToStaticMarkup(React.createElement(SkillMarketplacePageHeader, {
      currentUserId: null,
      serviceEnvironmentLabel: 'Production',
    }))
    const authenticatedHtml = renderToStaticMarkup(React.createElement(SkillMarketplacePageHeader, {
      currentUserId: 'user_1',
      serviceEnvironmentLabel: 'Production',
    }))

    expect(anonymousHtml).toContain('Browse public Marketplace Skills anonymously.')
    expect(anonymousHtml).toContain('Sign in to publish')
    expect(anonymousHtml).toContain('Production')
    expect(authenticatedHtml).toContain('Publish Skill')
    expect(authenticatedHtml).not.toContain('Sign in to publish')
  })

  test('renders Publish Skill when a Local Skill menu provides a publish action', async () => {
    const { SkillMenu } = await import('../SkillMenu')
    const html = renderToStaticMarkup(React.createElement(SkillMenu, {
      skillSlug: 'local-helper',
      skillName: 'Local Helper',
      onOpenInNewWindow: () => {},
      onShowInFinder: () => {},
      onPublishSkill: () => {},
    }))

    expect(html).toContain('Publish Skill')
  })

  test('renders Local Skill Marketplace status after a successful publish', () => {
    const publishedHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      publishState: { status: 'published', marketplaceSlug: 'local-helper' },
    }))
    const linkedHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: {
        marketplaceId: 'mkt_skill_local_helper',
        marketplaceSlug: 'local-helper',
        ownerId: 'owner_1',
        ownerDisplayName: 'Avery Lee',
        installedVersion: '1.2.0',
        installedAt: '2026-05-12T10:00:00.000Z',
        lastCheckedAt: '2026-05-12T10:00:00.000Z',
        modified: true,
        sourceBundleHash: 'hash',
        safetyStatus: 'ok',
      },
    }))

    expect(publishedHtml).toContain('Published to Marketplace')
    expect(publishedHtml).toContain('/local-helper')
    expect(linkedHtml).toContain('Marketplace linked')
    expect(linkedHtml).toContain('v1.2.0')
    expect(linkedHtml).toContain('Unpublished changes')
  })

  test('updates Marketplace Skill detail only after authenticated update intent and local update succeed', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const completed: string[] = []

    const updateResult = await updateMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail: result.detail,
      api: {
        ...api,
        async createUpdateIntent() {
          return { intentId: 'update_1', downloadUrl: 'data:application/zip;base64,AA==', expectedSha256: 'hash' }
        },
        async recordUpdateComplete(intentId) {
          completed.push(intentId)
        },
      },
      electronAPI: {
        async updateMarketplaceSkill(_workspaceId, input) {
          expect(input.userId).toBe('user_1')
          expect(input.slug).toBe('release-notes')
          expect(input.targetVersion).toBe('1.8.0')
          return { status: 'installed', slug: 'release-notes' }
        },
      },
    })

    expect(updateResult).toEqual({ status: 'installed', slug: 'release-notes' })
    expect(completed).toEqual(['update_1'])
  })

  test('renders Marketplace update actions without auto-updating unavailable or safety-blocked skills', async () => {
    const api = createStaticMarketplaceApi()
    const updateResult = await loadMarketplaceDetail(api, 'release-notes')
    const blockedResult = await loadMarketplaceDetail(api, 'security-review')
    if (updateResult.status !== 'ready' || blockedResult.status !== 'ready') throw new Error('Expected ready detail state')

    const updateHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, { detail: updateResult.detail }))
    const blockedHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, { detail: blockedResult.detail }))

    expect(updateHtml).toContain('Update')
    expect(updateHtml).not.toContain('Update placeholder')
    expect(blockedHtml).toContain('Safety blocked')
    expect(blockedHtml).toContain('prevents Marketplace install and update distribution')
  })

  test('renders an overwrite warning before updating modified Marketplace-installed Local Skills', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: { ...result.detail, installState: 'modified-locally' },
      currentUserId: 'user_1',
    }))

    expect(html).toContain('Modified locally')
    expect(html).toContain('Updating will overwrite local changes.')
    expect(html).toContain('Update')
  })

  test('renders unpublished changes and blocks sync latest for owner-linked modified Local Skills', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: { ...result.detail, installState: 'modified-locally', ownerId: 'owner_1' },
      currentUserId: 'owner_1',
    }))

    expect(html).toContain('Unpublished changes')
    expect(html).toContain('Publish or discard changes')
    expect(html).toContain('cannot sync latest')
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
