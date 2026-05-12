import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { unzipSync, strFromU8 } from 'fflate'
import {
  MARKETPLACE_ORIGIN_METADATA_FILE,
  publishLocalSkillToMarketplace,
  readMarketplaceOriginMetadata,
  suggestMarketplaceSlug,
  validateMarketplacePublishRequest,
  type MarketplacePublishApi,
  type MarketplacePublishRequest,
} from '../marketplace-publish.ts'

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'marketplace-publish-test-'))
}

function writeSkill(workspaceRoot: string, slug: string, skillMd: string): void {
  const skillDir = join(workspaceRoot, 'skills', slug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), skillMd)
  writeFileSync(join(skillDir, 'notes.md'), '# Notes\n')
}

function makeRequest(workspaceRoot: string, overrides: Partial<MarketplacePublishRequest> = {}): MarketplacePublishRequest {
  return {
    workspaceRoot,
    user: { id: 'owner_1' },
    skillSlug: 'review-helper',
    marketplaceSlug: 'review-helper',
    version: '1.0.0',
    category: 'Quality',
    tags: ['review', 'ci'],
    releaseNotes: 'Initial Marketplace release.',
    now: () => new Date('2026-05-12T10:00:00.000Z'),
    api: {
      async publishSkill() {
        throw new Error('test must provide api')
      },
    },
    ...overrides,
  }
}

describe('publishLocalSkillToMarketplace', () => {
  test('suggests a marketplace slug from bundled SKILL.md frontmatter name', () => {
    expect(suggestMarketplaceSlug({
      name: 'Review Helper!',
    })).toBe('review-helper')
  })

  test('publishes a Local Skill bundle and links it through Marketplace sidecar metadata', async () => {
    const workspaceRoot = makeWorkspace()
    const skillMd = [
      '---',
      'name: Review Helper',
      'description: Reviews pull requests before release.',
      '---',
      '',
      '# Review Helper',
      '',
      'Check diffs and tests.',
    ].join('\n')
    writeSkill(workspaceRoot, 'review-helper', skillMd)
    writeFileSync(
      join(workspaceRoot, 'skills', 'review-helper', MARKETPLACE_ORIGIN_METADATA_FILE),
      '{"marketplaceSlug":"old"}\n',
    )

    const publishedInputs: Parameters<MarketplacePublishApi['publishSkill']>[0][] = []
    const api: MarketplacePublishApi = {
      async publishSkill(input) {
        publishedInputs.push(input)
        return {
          status: 'published',
          marketplaceId: 'mkt_skill_review_helper',
          marketplaceSlug: input.marketplaceSlug,
          version: input.version,
          ownerId: input.userId,
          ownerDisplayName: 'Avery Lee',
        }
      },
    }

    try {
      const result = await publishLocalSkillToMarketplace(makeRequest(workspaceRoot, { api }))

      expect(result).toEqual({
        status: 'published',
        marketplaceId: 'mkt_skill_review_helper',
        marketplaceSlug: 'review-helper',
        version: '1.0.0',
      })
      expect(publishedInputs).toHaveLength(1)
      expect(publishedInputs[0]).toMatchObject({
        userId: 'owner_1',
        marketplaceSlug: 'review-helper',
        version: '1.0.0',
        category: 'Quality',
        tags: ['review', 'ci'],
        releaseNotes: 'Initial Marketplace release.',
      })
      expect(Object.keys(publishedInputs[0] as unknown as Record<string, unknown>)).not.toContain('name')
      expect(Object.keys(publishedInputs[0] as unknown as Record<string, unknown>)).not.toContain('description')
      const files = unzipSync(publishedInputs[0]!.bundle)
      expect(strFromU8(files['SKILL.md']!)).toBe(skillMd)
      expect(strFromU8(files['notes.md']!)).toBe('# Notes\n')
      expect(files[MARKETPLACE_ORIGIN_METADATA_FILE]).toBeUndefined()
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'review-helper')).toMatchObject({
        marketplaceId: 'mkt_skill_review_helper',
        marketplaceSlug: 'review-helper',
        ownerId: 'owner_1',
        ownerDisplayName: 'Avery Lee',
        installedVersion: '1.0.0',
        installedAt: '2026-05-12T10:00:00.000Z',
        lastCheckedAt: '2026-05-12T10:00:00.000Z',
        modified: false,
        safetyStatus: 'ok',
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('sends based-on origin when publishing a derived Local Skill', async () => {
    const workspaceRoot = makeWorkspace()
    writeSkill(workspaceRoot, 'review-helper', '---\nname: Review Helper\ndescription: Reviews pull requests.\n---\n\nBody\n')
    writeFileSync(
      join(workspaceRoot, 'skills', 'review-helper', MARKETPLACE_ORIGIN_METADATA_FILE),
      JSON.stringify({
        marketplaceId: 'mkt_original',
        marketplaceSlug: 'original-skill',
        ownerId: 'owner_2',
        ownerDisplayName: 'Original Owner',
        installedVersion: '2.3.4',
        installedAt: '2026-05-01T00:00:00.000Z',
        lastCheckedAt: '2026-05-01T00:00:00.000Z',
        modified: true,
        sourceBundleHash: 'hash',
        safetyStatus: 'ok',
      }, null, 2),
    )
    const basedOn: unknown[] = []

    try {
      await publishLocalSkillToMarketplace(makeRequest(workspaceRoot, {
        user: { id: 'owner_1' },
        marketplaceSlug: 'review-helper-fork',
        api: {
          async publishSkill(input) {
            basedOn.push(input.basedOn)
            return {
              status: 'published',
              marketplaceId: 'mkt_review_helper_fork',
              marketplaceSlug: input.marketplaceSlug,
              version: input.version,
              ownerId: input.userId,
              ownerDisplayName: 'Avery Lee',
            }
          },
        },
      }))

      expect(basedOn).toEqual([{ marketplaceId: 'mkt_original', marketplaceSlug: 'original-skill', version: '2.3.4' }])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('allows owners to publish a new immutable version to an existing slug', async () => {
    const workspaceRoot = makeWorkspace()
    writeSkill(workspaceRoot, 'review-helper', '---\nname: Review Helper\ndescription: Reviews pull requests.\n---\n\nBody\n')
    writeFileSync(
      join(workspaceRoot, 'skills', 'review-helper', MARKETPLACE_ORIGIN_METADATA_FILE),
      JSON.stringify({
        marketplaceId: 'mkt_skill_review_helper',
        marketplaceSlug: 'review-helper',
        ownerId: 'owner_1',
        ownerDisplayName: 'Avery Lee',
        installedVersion: '1.0.0',
        installedAt: '2026-05-01T00:00:00.000Z',
        lastCheckedAt: '2026-05-01T00:00:00.000Z',
        modified: true,
        sourceBundleHash: 'old-hash',
        safetyStatus: 'ok',
      }, null, 2),
    )

    try {
      const result = await publishLocalSkillToMarketplace(makeRequest(workspaceRoot, {
        version: '1.1.0',
        api: {
          async publishSkill(input) {
            expect(input.marketplaceSlug).toBe('review-helper')
            expect(input.version).toBe('1.1.0')
            return {
              status: 'published',
              marketplaceId: 'mkt_skill_review_helper',
              marketplaceSlug: input.marketplaceSlug,
              version: input.version,
              ownerId: input.userId,
              ownerDisplayName: 'Avery Lee',
            }
          },
        },
      }))

      expect(result.status).toBe('published')
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'review-helper')).toMatchObject({
        marketplaceId: 'mkt_skill_review_helper',
        installedVersion: '1.1.0',
        modified: false,
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('returns slug ownership conflict without changing Local Skill sidecar metadata', async () => {
    const workspaceRoot = makeWorkspace()
    writeSkill(workspaceRoot, 'review-helper', '---\nname: Review Helper\ndescription: Reviews pull requests.\n---\n\nBody\n')

    try {
      const result = await publishLocalSkillToMarketplace(makeRequest(workspaceRoot, {
        api: {
          async publishSkill() {
            return { status: 'slug-conflict', marketplaceSlug: 'review-helper', message: 'Slug is owned by another publisher.' }
          },
        },
      }))

      expect(result).toEqual({ status: 'slug-conflict', marketplaceSlug: 'review-helper', message: 'Slug is owned by another publisher.' })
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'review-helper')).toBeNull()
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('validates authenticated context and Marketplace-only publish requirements before upload', async () => {
    const workspaceRoot = makeWorkspace()
    writeSkill(workspaceRoot, 'review-helper', '---\nname: Review Helper\ndescription: Reviews pull requests.\n---\n\nBody\n')
    const api: MarketplacePublishApi = {
      async publishSkill() {
        throw new Error('should not upload')
      },
    }

    try {
      await expect(publishLocalSkillToMarketplace(makeRequest(workspaceRoot, { user: null, api }))).rejects.toThrow('Sign in is required')
      expect(validateMarketplacePublishRequest({
        marketplaceSlug: 'Review Helper',
        version: '1',
        category: 'Other',
        tags: ['Needs Spaces'],
      })).toEqual([
        'Marketplace slug must use lowercase letters, numbers, and single hyphens.',
        'Version must be a valid SemVer version.',
        'Category must be one of Documentation, Product, Quality, Security.',
        'Tags must use lowercase letters, numbers, and hyphens.',
      ])
      await expect(publishLocalSkillToMarketplace(makeRequest(workspaceRoot, {
        marketplaceSlug: 'Review Helper',
        api,
      }))).rejects.toThrow('Marketplace slug must use lowercase')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('rejects invalid Local Skills before upload', async () => {
    const workspaceRoot = makeWorkspace()
    mkdirSync(join(workspaceRoot, 'skills', 'broken-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'broken-skill', 'SKILL.md'), '# Missing frontmatter\n')
    const api: MarketplacePublishApi = {
      async publishSkill() {
        throw new Error('should not upload')
      },
    }

    try {
      await expect(publishLocalSkillToMarketplace(makeRequest(workspaceRoot, {
        skillSlug: 'broken-skill',
        marketplaceSlug: 'broken-skill',
        api,
      }))).rejects.toThrow('Local Skill must have valid SKILL.md frontmatter')
      expect(existsSync(join(workspaceRoot, 'skills', 'broken-skill', MARKETPLACE_ORIGIN_METADATA_FILE))).toBe(false)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
