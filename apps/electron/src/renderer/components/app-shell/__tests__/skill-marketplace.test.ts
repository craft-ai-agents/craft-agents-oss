import { describe, expect, mock, test } from 'bun:test'
import '../../../__tests__/mock-i18n'
import { setupI18n } from '@craft-agent/shared/i18n'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import {
  createStaticMarketplaceApi,
  installMarketplaceSkillFromDetail,
  loadMarketplaceCatalog,
  loadMarketplaceDetail,
  MARKETPLACE_DIRECT_PUBLISH_TABS,
  MarketplaceDetail,
  MarketplaceError,
  MarketplaceEmptyState,
  MarketplaceListingCard,
  LocalSkillMarketplaceStatus,
  publishDirectMarketplaceSkill,
  publishMarketplaceSkill,
  publishOwnerMarketplaceVersionFromDetail,
  reportMarketplaceSkillFromDetail,
  SkillMarketplacePageHeader,
  unpublishOwnerMarketplaceSkillFromDetail,
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

setupI18n([initReactI18next])

async function loadReadyReportDetail() {
  const api = createStaticMarketplaceApi()
  const result = await loadMarketplaceDetail(api, 'test-writer')
  if (result.status !== 'ready') throw new Error('Expected ready detail state')
  return { api, detail: result.detail }
}

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

  test('renders based-on attribution on Marketplace listings and detail pages', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const basedOn = { marketplaceId: 'mkt_skill_original', marketplaceSlug: 'original-skill', version: '1.2.3' }

    const listingHtml = renderToStaticMarkup(React.createElement(MarketplaceListingCard, {
      listing: { ...result.detail, basedOn },
      selected: false,
      onSelect: () => {},
    }))
    const detailHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: { ...result.detail, basedOn },
    }))

    expect(listingHtml).toContain('Based on /original-skill v1.2.3')
    expect(detailHtml).toContain('Based on')
    expect(detailHtml).toContain('/original-skill v1.2.3')
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
    expect(html).toContain('Report')
    expect(html).not.toContain('Owner actions')
  })

  test('renders owner actions only for the Marketplace Skill owner', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const ownerHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: result.detail,
      currentUserId: 'owner_1',
      onOwnerPublishVersion: () => {},
      onOwnerUnpublish: () => {},
    }))
    const nonOwnerHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: result.detail,
      currentUserId: 'user_2',
      onOwnerPublishVersion: () => {},
      onOwnerUnpublish: () => {},
    }))

    expect(ownerHtml).toContain('Owner actions')
    expect(ownerHtml).toContain('Publish version')
    expect(ownerHtml).toContain('Unpublish')
    expect(nonOwnerHtml).not.toContain('Owner actions')
    expect(nonOwnerHtml).not.toContain('Publish version')
    expect(nonOwnerHtml).not.toContain('Unpublish')
  })

  test('submits Marketplace Skill reports with authenticated user context and report details', async () => {
    const { api, detail } = await loadReadyReportDetail()
    const reports: unknown[] = []

    const reportResult = await reportMarketplaceSkillFromDetail({
      userId: 'user_1',
      detail,
      context: 'This skill asks users to paste production credentials into chat.',
      api: {
        ...api,
        async reportSkill(input) {
          reports.push(input)
          return { status: 'submitted', reportId: 'report_1' }
        },
      },
    })

    expect(reportResult).toEqual({ status: 'submitted', reportId: 'report_1' })
    expect(reports).toEqual([{
      userId: 'user_1',
      marketplaceId: 'mkt_skill_test_writer',
      marketplaceSlug: 'test-writer',
      context: 'This skill asks users to paste production credentials into chat.',
    }])
  })

  test('does not submit Marketplace Skill reports for anonymous users', async () => {
    const { api, detail } = await loadReadyReportDetail()

    const reportResult = await reportMarketplaceSkillFromDetail({
      userId: null,
      detail,
      context: 'Unsafe behavior.',
      api: {
        ...api,
        async reportSkill() {
          throw new Error('should not submit report')
        },
      },
    })

    expect(reportResult).toEqual({
      status: 'auth-required',
      message: 'Sign in is required to report Marketplace Skills.',
    })
  })

  test('shows validation failure for blank Marketplace Skill report details', async () => {
    const { api, detail } = await loadReadyReportDetail()

    const reportResult = await reportMarketplaceSkillFromDetail({
      userId: 'user_1',
      detail,
      context: '   ',
      api,
    })
    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail,
      reportState: reportResult,
    }))

    expect(reportResult).toEqual({
      status: 'validation-error',
      message: 'Add report details before submitting.',
    })
    expect(html).toContain('Add report details before submitting.')
  })

  test('shows success confirmation after Marketplace Skill report submission', async () => {
    const { detail } = await loadReadyReportDetail()

    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail,
      reportState: { status: 'submitted', reportId: 'report_1' },
    }))

    expect(html).toContain('Report submitted')
  })

  test('shows Marketplace Skill report service failure messages', async () => {
    const { api, detail } = await loadReadyReportDetail()

    const reportResult = await reportMarketplaceSkillFromDetail({
      userId: 'user_1',
      detail,
      context: 'This skill links to a suspicious credential collection page.',
      api: {
        ...api,
        async reportSkill() {
          throw new Error('Marketplace reports are temporarily unavailable.')
        },
      },
    })
    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail,
      reportState: reportResult,
    }))

    expect(reportResult).toEqual({
      status: 'error',
      message: 'Marketplace reports are temporarily unavailable.',
    })
    expect(html).toContain('Marketplace reports are temporarily unavailable.')
  })

  test('renders Marketplace Skill report action as sign-in blocked for anonymous users', async () => {
    const { detail } = await loadReadyReportDetail()

    const html = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail,
      canReport: false,
      currentUserId: null,
    }))

    expect(html).toContain('Sign in to report')
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
          expect(input.skill.basedOn).toBeUndefined()
          return { status: 'installed', slug: 'test-writer' }
        },
      },
    })

    expect(installResult).toEqual({ status: 'installed', slug: 'test-writer' })
    expect(completed).toEqual(['intent_1'])
  })

  test('passes based-on attribution into Marketplace installs when detail metadata includes it', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'test-writer')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const basedOn = { marketplaceId: 'mkt_skill_original', marketplaceSlug: 'original-skill', version: '1.2.3' }

    await installMarketplaceSkillFromDetail({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      detail: { ...result.detail, basedOn },
      api: {
        ...api,
        async createInstallIntent() {
          return { intentId: 'intent_1', downloadUrl: 'data:application/zip;base64,AA==', expectedSha256: 'hash' }
        },
      },
      electronAPI: {
        async installMarketplaceSkill(_workspaceId, input) {
          expect(input.skill.basedOn).toEqual(basedOn)
          return { status: 'installed', slug: 'test-writer' }
        },
      },
    })
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

  test('direct Marketplace publish calls publish-only RPC without creating Local Skills', async () => {
    const calls: unknown[] = []
    const result = await publishDirectMarketplaceSkill({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      skill: {
        slug: 'direct-helper',
        metadata: { name: 'Direct Helper', description: 'Published directly.' },
        content: 'Direct publish body.',
        sourcePath: 'marketplace-create',
      },
      marketplaceSlug: 'direct-helper',
      version: '1.0.0',
      category: 'Quality',
      tags: ['direct'],
      releaseNotes: 'Initial release.',
      electronAPI: {
        async publishDirectMarketplaceSkill(workspaceId, input) {
          calls.push({ workspaceId, input })
          return {
            status: 'published',
            marketplaceId: 'mkt_direct_helper',
            marketplaceSlug: input.marketplaceSlug,
            version: input.version,
          }
        },
      },
    })

    expect(result).toEqual({
      status: 'published',
      marketplaceId: 'mkt_direct_helper',
      marketplaceSlug: 'direct-helper',
      version: '1.0.0',
    })
    expect(calls).toEqual([{
      workspaceId: 'workspace_1',
      input: {
        userId: 'user_1',
        skill: {
          slug: 'direct-helper',
          metadata: { name: 'Direct Helper', description: 'Published directly.' },
          content: 'Direct publish body.',
        },
        marketplaceSlug: 'direct-helper',
        version: '1.0.0',
        category: 'Quality',
        tags: ['direct'],
        releaseNotes: 'Initial release.',
      },
    }])
  })

  test('owner Marketplace detail publish sends a new immutable SemVer version through publish RPC', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const calls: unknown[] = []

    const publishResult = await publishOwnerMarketplaceVersionFromDetail({
      workspaceId: 'workspace_1',
      userId: 'owner_1',
      detail: result.detail,
      version: '1.9.0',
      releaseNotes: 'Owner release notes.',
      electronAPI: {
        async publishDirectMarketplaceSkill(workspaceId, input) {
          calls.push({ workspaceId, input })
          return {
            status: 'published',
            marketplaceId: result.detail.metadata.marketplaceId,
            marketplaceSlug: input.marketplaceSlug,
            version: input.version,
          }
        },
      },
    })

    expect(publishResult).toEqual({
      status: 'published',
      marketplaceId: 'mkt_skill_release-notes',
      marketplaceSlug: 'release-notes',
      version: '1.9.0',
    })
    expect(calls).toEqual([{
      workspaceId: 'workspace_1',
      input: {
        userId: 'owner_1',
        skill: {
          slug: 'release-notes',
          metadata: {
            name: 'Release Notes',
            description: 'Turns merged changes into concise release notes for product teams.',
          },
          content: '# Release Notes\n\nSummarize completed work by user-visible outcome and include migration notes when needed.',
        },
        marketplaceSlug: 'release-notes',
        version: '1.9.0',
        category: 'Product',
        tags: ['release', 'writing'],
        releaseNotes: 'Owner release notes.',
      },
    }])
  })

  test('owner Marketplace detail unpublish calls owner-only service boundary', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')
    const calls: unknown[] = []

    const unpublishResult = await unpublishOwnerMarketplaceSkillFromDetail({
      userId: 'owner_1',
      detail: result.detail,
      api: {
        ...api,
        async unpublishSkill(input) {
          calls.push(input)
          return {
            status: 'unpublished',
            marketplaceSlug: input.marketplaceSlug,
            message: 'Removed from Marketplace discovery. Published versions are preserved.',
          }
        },
      },
    })

    expect(unpublishResult).toEqual({
      status: 'unpublished',
      marketplaceSlug: 'release-notes',
      message: 'Removed from Marketplace discovery. Published versions are preserved.',
    })
    expect(calls).toEqual([{
      userId: 'owner_1',
      marketplaceId: 'mkt_skill_release-notes',
      marketplaceSlug: 'release-notes',
    }])
  })

  test('owner unpublish removes Marketplace Skill from discovery while preserving detail versions', async () => {
    const api = createStaticMarketplaceApi()
    const detailBefore = await loadMarketplaceDetail(api, 'release-notes')
    if (detailBefore.status !== 'ready') throw new Error('Expected ready detail state')

    await unpublishOwnerMarketplaceSkillFromDetail({
      userId: 'owner_1',
      detail: detailBefore.detail,
      api,
    })
    const catalogAfter = await loadMarketplaceCatalog(api, {})
    const detailAfter = await loadMarketplaceDetail(api, 'release-notes')

    if (catalogAfter.status !== 'ready' || detailAfter.status !== 'ready') {
      throw new Error('Expected ready Marketplace state')
    }
    expect(catalogAfter.listings.map((listing) => listing.slug)).not.toContain('release-notes')
    expect(detailAfter.detail.versions.map((version) => version.version)).toEqual(['1.8.0', '1.7.1'])
  })

  test('direct Marketplace publish validates auth and form fields before RPC', async () => {
    const result = await publishDirectMarketplaceSkill({
      workspaceId: 'workspace_1',
      userId: null,
      skill: {
        slug: 'direct-helper',
        metadata: { name: 'Direct Helper', description: 'Published directly.' },
        content: 'Direct publish body.',
        sourcePath: 'marketplace-create',
      },
      marketplaceSlug: 'direct-helper',
      version: '1.0.0',
      category: 'Quality',
      electronAPI: {
        async publishDirectMarketplaceSkill() {
          throw new Error('should not publish')
        },
      },
    })
    const invalid = await publishDirectMarketplaceSkill({
      workspaceId: 'workspace_1',
      userId: 'user_1',
      skill: {
        slug: '',
        metadata: { name: '', description: '' },
        content: '',
        sourcePath: '',
      },
      marketplaceSlug: 'Bad Slug',
      version: '1',
      category: 'Other',
      electronAPI: {
        async publishDirectMarketplaceSkill() {
          throw new Error('should not publish')
        },
      },
    })

    expect(result).toEqual({
      status: 'auth-required',
      message: 'Sign in is required to publish Marketplace Skills.',
    })
    expect(invalid.status).toBe('validation-error')
    if (invalid.status !== 'validation-error') throw new Error('Expected validation error')
    expect(invalid.message).toContain('Skill name is required.')
    expect(invalid.message).toContain('Marketplace slug must use lowercase')
  })

  test('renders direct Marketplace publish entry points and keeps AI Assist out of the dialog', () => {
    const headerHtml = renderToStaticMarkup(React.createElement(SkillMarketplacePageHeader, {
      currentUserId: 'user_1',
      serviceEnvironmentLabel: 'Production',
      onPublishClick: () => {},
    }))
    const emptyHtml = renderToStaticMarkup(React.createElement(MarketplaceEmptyState, {
      canPublish: true,
      onPublishClick: () => {},
    }))

    expect(headerHtml).toContain('Publish Skill')
    expect(emptyHtml).toContain('Publish Skill')
    expect(MARKETPLACE_DIRECT_PUBLISH_TABS).toEqual(['create', 'remote', 'upload'])
    expect(MARKETPLACE_DIRECT_PUBLISH_TABS).not.toContain('ai')
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

  test('renders owner-unpublished state as unavailable without deleting Local Skill files', async () => {
    const api = createStaticMarketplaceApi()
    const result = await loadMarketplaceDetail(api, 'release-notes')
    if (result.status !== 'ready') throw new Error('Expected ready detail state')

    const detailHtml = renderToStaticMarkup(React.createElement(MarketplaceDetail, {
      detail: { ...result.detail, installState: 'unavailable' },
    }))
    const localHtml = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: {
        marketplaceId: 'mkt_skill_release_notes',
        marketplaceSlug: 'release-notes',
        ownerId: 'owner_1',
        ownerDisplayName: 'Launch Team',
        installedVersion: '1.7.1',
        installedAt: '2026-05-12T10:00:00.000Z',
        lastCheckedAt: '2026-05-12T12:00:00.000Z',
        modified: false,
        sourceBundleHash: 'hash',
        safetyStatus: 'unavailable',
      },
    }))

    expect(detailHtml).toContain('Owner unpublished')
    expect(detailHtml).toContain('stops future Marketplace install and update distribution')
    expect(detailHtml).toContain('Existing Local Skill files are preserved.')
    expect(localHtml).toContain('Owner unpublished')
    expect(localHtml).toContain('Local files preserved')
  })

  test('renders admin-unpublished safety-blocked Local Skill status', () => {
    const html = renderToStaticMarkup(React.createElement(LocalSkillMarketplaceStatus, {
      metadata: {
        marketplaceId: 'mkt_skill_security_review',
        marketplaceSlug: 'security-review',
        ownerId: 'owner_2',
        ownerDisplayName: 'Secure Build',
        installedVersion: '3.0.0',
        installedAt: '2026-05-12T10:00:00.000Z',
        lastCheckedAt: '2026-05-12T12:00:00.000Z',
        modified: false,
        sourceBundleHash: 'hash',
        safetyStatus: 'safety-blocked',
      },
    }))

    expect(html).toContain('Admin unpublished')
    expect(html).toContain('Safety blocked')
    expect(html).toContain('Local files preserved')
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
