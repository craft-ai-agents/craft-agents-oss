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
  publishDirectMarketplaceSkill,
  publishMarketplaceSkill,
  reportMarketplaceSkillFromDetail,
  SkillMarketplacePageHeader,
  updateMarketplaceSkillFromDetail,
  type MarketplaceApi,
  type MarketplaceCatalogFilters,
  type MarketplacePublishApi,
  type MarketplaceSkillDetail,
  type MarketplaceSkillListing,
} from '../SkillMarketplacePage'
import type {
  MarketplaceDirectSkillPublishInput,
  MarketplaceInstallResult,
  MarketplaceOriginMetadata,
  MarketplaceSkillInstallInput,
  MarketplaceSkillUpdateInput,
} from '@craft-agent/shared/skills'

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

interface LocalSkillState {
  slug: string
  name: string
  content: string
  marketplaceOrigin?: MarketplaceOriginMetadata
}

class MockMarketplaceRegressionService implements MarketplaceApi, MarketplacePublishApi {
  private readonly baseApi = createStaticMarketplaceApi()
  private readonly details = new Map<string, MarketplaceSkillDetail>()
  readonly localSkills = new Map<string, LocalSkillState>()
  readonly reports: unknown[] = []

  async listSkills(): Promise<MarketplaceSkillListing[]> {
    const base = await this.baseApi.listSkills()
    return [...base, ...Array.from(this.details.values())]
  }

  async getSkillDetail(slug: string): Promise<MarketplaceSkillDetail> {
    return this.details.get(slug) ?? this.baseApi.getSkillDetail(slug)
  }

  async reportSkill(input: Parameters<MarketplaceApi['reportSkill']>[0]) {
    this.reports.push(input)
    return { status: 'submitted' as const, reportId: `report_${input.marketplaceSlug}` }
  }

  async unpublishSkill(input: Parameters<MarketplaceApi['unpublishSkill']>[0]) {
    return this.baseApi.unpublishSkill(input)
  }

  async createInstallIntent(detail: MarketplaceSkillDetail, userId: string) {
    return this.baseApi.createInstallIntent(detail, userId)
  }

  async recordInstallComplete() {
    await this.baseApi.recordInstallComplete('')
  }

  async createUpdateIntent(detail: MarketplaceSkillDetail, userId: string) {
    return this.baseApi.createUpdateIntent(detail, userId)
  }

  async recordUpdateComplete() {
    await this.baseApi.recordUpdateComplete('')
  }

  async publishSkill(input: { userId: string; skillSlug: string }) {
    const local = this.localSkills.get(input.skillSlug)
    if (!local) throw new Error('Local Skill not found.')
    const marketplaceSlug = input.skillSlug
    this.upsertDetail({
      slug: marketplaceSlug,
      name: local.name,
      description: 'Published from Local Skills.',
      ownerId: input.userId,
      owner: 'Local Publisher',
      version: '1.0.0',
      category: 'Quality',
      tags: ['local'],
      content: local.content,
    })
    return { status: 'published' as const, marketplaceSlug }
  }

  async publishDirectSkill(input: MarketplaceDirectSkillPublishInput) {
    this.upsertDetail({
      slug: input.marketplaceSlug,
      name: input.skill.metadata.name,
      description: input.skill.metadata.description,
      ownerId: input.userId,
      owner: 'Direct Publisher',
      version: input.version,
      category: input.category,
      tags: input.tags ?? [],
      content: input.skill.content,
    })
    return {
      status: 'published' as const,
      marketplaceId: `mkt_skill_${input.marketplaceSlug.replaceAll('-', '_')}`,
      marketplaceSlug: input.marketplaceSlug,
      version: input.version,
    }
  }

  installLocalSkill(input: MarketplaceSkillInstallInput): MarketplaceInstallResult {
    this.localSkills.set(input.skill.skillSlug, {
      slug: input.skill.skillSlug,
      name: input.skill.marketplaceSlug,
      content: 'Installed from Marketplace.',
      marketplaceOrigin: {
        marketplaceId: input.skill.marketplaceId,
        marketplaceSlug: input.skill.marketplaceSlug,
        ownerId: input.skill.ownerId,
        ownerDisplayName: input.skill.ownerDisplayName,
        installedVersion: input.skill.version,
        installedAt: '2026-05-13T00:00:00.000Z',
        lastCheckedAt: '2026-05-13T00:00:00.000Z',
        modified: false,
        sourceBundleHash: input.intent.expectedSha256,
        safetyStatus: 'ok',
        basedOn: input.skill.basedOn,
      },
    })
    return { status: 'installed', slug: input.skill.skillSlug }
  }

  updateLocalSkill(input: MarketplaceSkillUpdateInput): MarketplaceInstallResult {
    const local = this.localSkills.get(input.slug)
    if (!local?.marketplaceOrigin) return { status: 'conflict', slug: input.slug }
    local.marketplaceOrigin = {
      ...local.marketplaceOrigin,
      installedVersion: input.targetVersion,
      lastCheckedAt: '2026-05-13T01:00:00.000Z',
      modified: false,
      sourceBundleHash: input.intent.expectedSha256,
    }
    return { status: 'installed', slug: input.slug }
  }

  markLocalModified(slug: string) {
    const local = this.localSkills.get(slug)
    if (local?.marketplaceOrigin) {
      local.marketplaceOrigin = { ...local.marketplaceOrigin, modified: true }
      this.localSkills.set(slug, local)
    }
  }

  private upsertDetail(input: {
    slug: string
    name: string
    description: string
    ownerId: string
    owner: string
    version: string
    category: string
    tags: string[]
    content: string
  }) {
    const id = `mkt_skill_${input.slug.replaceAll('-', '_')}`
    const detail: MarketplaceSkillDetail = {
      id,
      slug: input.slug,
      ownerId: input.ownerId,
      icon: input.name.slice(0, 2).toUpperCase(),
      name: input.name,
      description: input.description,
      owner: input.owner,
      category: input.category,
      tags: input.tags,
      latestVersion: input.version,
      installCount: 0,
      installState: 'install',
      skillMarkdown: [
        '---',
        `name: ${input.name}`,
        `description: ${input.description}`,
        '---',
        '',
        input.content,
      ].join('\n'),
      requiredSources: [],
      versions: [{ version: input.version, publishedAt: '2026-05-13', releaseNotes: 'Regression publish.' }],
      metadata: {
        marketplaceId: id,
        marketplaceSlug: input.slug,
        publishedAt: '2026-05-13',
        updatedAt: '2026-05-13',
      },
    }
    this.details.set(input.slug, detail)
  }
}

async function loadReadyDetail(api: MarketplaceApi, slug: string): Promise<MarketplaceSkillDetail> {
  const result = await loadMarketplaceDetail(api, slug)
  if (result.status !== 'ready') throw new Error(`Expected ready detail for ${slug}`)
  return result.detail
}

async function loadReadyCatalog(api: MarketplaceApi, filters: MarketplaceCatalogFilters = {}) {
  const result = await loadMarketplaceCatalog(api, filters)
  if (result.status !== 'ready') throw new Error('Expected ready catalog')
  return result
}

describe('Marketplace mocked-service regression suite', () => {
  test('covers browse navigation and read-only detail inspection', async () => {
    const service = new MockMarketplaceRegressionService()
    const catalog = await loadReadyCatalog(service, { search: 'test', category: 'Quality', tag: 'ci' })
    const detail = await loadReadyDetail(service, catalog.listings[0]!.slug)

    const headerHtml = renderToStaticMarkup(React.createElement(SkillMarketplacePageHeader, {
      currentUserId: 'user_1',
      serviceEnvironmentLabel: 'Mock Marketplace',
    }))
    const listingHtml = renderToStaticMarkup(React.createElement(MarketplaceListingCard, {
      listing: catalog.listings[0]!,
      selected: true,
      onSelect: () => {},
    }))
    const detailHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, { detail }))

    expect(catalog.listings.map((listing) => listing.slug)).toEqual(['test-writer'])
    expect(headerHtml).toContain('Marketplace')
    expect(headerHtml).toContain('Mock Marketplace')
    expect(listingHtml).toContain('Test Writer')
    expect(listingHtml).toContain('Install')
    expect(detailHtml).toContain('Published SKILL.md')
    expect(detailHtml).toContain('Version History')
    expect(detailHtml).toContain('Required Sources')
    expect(detailHtml).not.toContain('Edit')
  })

  test('installs a Marketplace Skill and shows it as a Marketplace-linked Local Skill', async () => {
    const service = new MockMarketplaceRegressionService()
    const detail = await loadReadyDetail(service, 'test-writer')

    const result = await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail,
      api: service,
      electronAPI: {
        installMarketplaceSkill: async (_workspaceId, input) => service.installLocalSkill(input),
      },
    })
    const local = service.localSkills.get('test-writer')
    const localHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: local?.marketplaceOrigin,
    }))

    expect(result).toEqual({ status: 'installed', slug: 'test-writer' })
    expect(localHtml).toContain('Marketplace linked')
    expect(localHtml).toContain('/test-writer')
    expect(localHtml).toContain('v1.4.2')
  })

  test('covers update available state and a manual Marketplace update', async () => {
    const service = new MockMarketplaceRegressionService()
    const installDetail = await loadReadyDetail(service, 'test-writer')
    await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail: installDetail,
      api: service,
      electronAPI: { installMarketplaceSkill: async (_workspaceId, input) => service.installLocalSkill(input) },
    })
    const updateDetail = await loadReadyDetail(service, 'release-notes')
    service.localSkills.set('release-notes', {
      slug: 'release-notes',
      name: 'Release Notes',
      content: 'Existing local install.',
      marketplaceOrigin: {
        marketplaceId: 'mkt_skill_release-notes',
        marketplaceSlug: 'release-notes',
        ownerId: 'owner_1',
        ownerDisplayName: 'Launch Team',
        installedVersion: '1.7.1',
        installedAt: '2026-05-12T00:00:00.000Z',
        lastCheckedAt: '2026-05-12T00:00:00.000Z',
        modified: false,
        sourceBundleHash: 'old-hash',
        safetyStatus: 'ok',
      },
    })

    const beforeHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, { detail: updateDetail }))
    const updateResult = await updateMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail: updateDetail,
      api: service,
      electronAPI: { updateMarketplaceSkill: async (_workspaceId, input) => service.updateLocalSkill(input) },
    })
    const afterHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: service.localSkills.get('release-notes')?.marketplaceOrigin,
    }))

    expect(beforeHtml).toContain('Update')
    expect(updateResult).toEqual({ status: 'installed', slug: 'release-notes' })
    expect(afterHtml).toContain('v1.8.0')
  })

  test('warns before updating modified marketplace-installed Local Skills', async () => {
    const service = new MockMarketplaceRegressionService()
    const detail = await loadReadyDetail(service, 'release-notes')
    service.localSkills.set('release-notes', {
      slug: 'release-notes',
      name: 'Release Notes',
      content: 'Edited local copy.',
      marketplaceOrigin: {
        marketplaceId: 'mkt_skill_release-notes',
        marketplaceSlug: 'release-notes',
        ownerId: 'owner_1',
        ownerDisplayName: 'Launch Team',
        installedVersion: '1.7.1',
        installedAt: '2026-05-12T00:00:00.000Z',
        lastCheckedAt: '2026-05-12T00:00:00.000Z',
        modified: false,
        sourceBundleHash: 'old-hash',
        safetyStatus: 'ok',
      },
    })
    service.markLocalModified('release-notes')

    const detailHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: { ...detail, installState: 'modified-locally' },
      currentUserId: 'user_1',
    }))
    const localHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: service.localSkills.get('release-notes')?.marketplaceOrigin,
    }))

    expect(detailHtml).toContain('Modified locally')
    expect(detailHtml).toContain('Updating will overwrite local changes.')
    expect(localHtml).toContain('Unpublished changes')
  })

  test('publishes an existing Local Skill into Marketplace discovery', async () => {
    const service = new MockMarketplaceRegressionService()
    service.localSkills.set('local-helper', {
      slug: 'local-helper',
      name: 'Local Helper',
      content: 'Local instructions.',
    })

    const result = await publishMarketplaceSkill({
      userId: 'user_1',
      skillSlug: 'local-helper',
      api: service,
    })
    const catalog = await loadReadyCatalog(service, { search: 'local helper' })
    const detail = await loadReadyDetail(service, 'local-helper')

    expect(result).toEqual({ status: 'published', marketplaceSlug: 'local-helper' })
    expect(catalog.listings.map((listing) => listing.slug)).toContain('local-helper')
    expect(detail.skillMarkdown).toContain('Local instructions.')
  })

  test('direct Marketplace publish supports Create, Remote, and Upload paths without creating Local Skills', async () => {
    const service = new MockMarketplaceRegressionService()
    const electronAPI = {
      publishDirectMarketplaceSkill: async (_workspaceId: string, input: MarketplaceDirectSkillPublishInput) => service.publishDirectSkill(input),
    }

    for (const source of ['create', 'remote', 'upload'] as const) {
      const slug = `${source}-helper`
      const result = await publishDirectMarketplaceSkill({
        workspaceId: 'workspace_1',
        userId: 'user_1',
        skill: {
          slug,
          metadata: { name: `${source} Helper`, description: `Published from ${source}.` },
          content: `${source} instructions.`,
          sourcePath: `marketplace-${source}`,
        },
        marketplaceSlug: slug,
        version: '1.0.0',
        category: 'Quality',
        electronAPI,
      })

      expect(result).toMatchObject({ status: 'published', marketplaceSlug: slug })
      expect(service.localSkills.has(slug)).toBe(false)
      expect((await loadReadyDetail(service, slug)).skillMarkdown).toContain(`${source} instructions.`)
    }
  })

  test('submits Marketplace reports with the selected Marketplace Skill identity', async () => {
    const service = new MockMarketplaceRegressionService()
    const detail = await loadReadyDetail(service, 'test-writer')

    const result = await reportMarketplaceSkillFromDetail({
      userId: 'user_1',
      detail,
      context: 'Suspicious behavior in published instructions.',
      api: service,
    })
    const detailHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail,
      reportState: result,
    }))

    expect(result).toEqual({ status: 'submitted', reportId: 'report_test-writer' })
    expect(service.reports).toEqual([{
      userId: 'user_1',
      marketplaceId: 'mkt_skill_test_writer',
      marketplaceSlug: 'test-writer',
      context: 'Suspicious behavior in published instructions.',
    }])
    expect(detailHtml).toContain('Report submitted')
  })

  test('shows Marketplace outage while Marketplace-linked Local Skills remain usable', async () => {
    const service = new MockMarketplaceRegressionService()
    const detail = await loadReadyDetail(service, 'test-writer')
    await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail,
      api: service,
      electronAPI: { installMarketplaceSkill: async (_workspaceId, input) => service.installLocalSkill(input) },
    })
    const outageApi = createStaticMarketplaceApi({ listError: 'Mock Marketplace outage.' })
    const outage = await loadMarketplaceCatalog(outageApi, {})
    const outageHtml = renderToStaticMarkup(React.createElement(MarketplaceError, {
      message: outage.status === 'error' ? outage.message : '',
      onRetry: () => {},
    }))
    const localHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: service.localSkills.get('test-writer')?.marketplaceOrigin,
    }))

    expect(outage).toEqual({ status: 'error', message: 'Mock Marketplace outage.' })
    expect(outageHtml).toContain('Marketplace is unavailable')
    expect(localHtml).toContain('Marketplace linked')
    expect(localHtml).toContain('/test-writer')
  })
})
