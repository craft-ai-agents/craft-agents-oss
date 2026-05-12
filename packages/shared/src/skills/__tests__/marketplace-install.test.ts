import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync, strToU8 } from 'fflate'
import { createHash } from 'crypto'
import {
  applyMarketplaceSkillUpdate,
  checkMarketplaceSkillUpdates,
  installMarketplaceSkill,
  readMarketplaceOriginMetadata,
  type MarketplaceInstallApi,
} from '../marketplace-install.ts'

function makeWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'marketplace-install-test-'))
}

function makeSkillZip(skillMd: string): Uint8Array {
  return zipSync({
    'SKILL.md': strToU8(skillMd),
    'references/guide.md': strToU8('# Guide\n'),
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function makeApi(bytes: Uint8Array): MarketplaceInstallApi & {
  intents: string[]
  completed: string[]
  integrityFailures: string[]
  failComplete?: boolean
} {
  const intents: string[] = []
  const completed: string[] = []
  const integrityFailures: string[] = []
  return {
    intents,
    completed,
    integrityFailures,
    async createInstallIntent() {
      intents.push('intent')
      return {
        intentId: 'intent_123',
        downloadUrl: 'https://marketplace.example/bundles/test-writer.zip',
        expectedSha256: sha256(bytes),
      }
    },
    async recordInstallComplete(intentId) {
      if (this.failComplete) throw new Error('Completion endpoint unavailable.')
      completed.push(intentId)
    },
    async reportIntegrityFailure(input) {
      integrityFailures.push(input.actualSha256)
    },
  }
}

describe('installMarketplaceSkill', () => {
  test('installs an authenticated Marketplace Skill into Local Skills with origin metadata', async () => {
    const workspaceRoot = makeWorkspace()
    const skillMd = [
      '---',
      'name: Test Writer',
      'description: Creates focused regression tests.',
      '---',
      '',
      '# Test Writer',
      '',
      'Write a failing test first.',
    ].join('\n')
    const bundle = makeSkillZip(skillMd)
    const api = makeApi(bundle)

    try {
      const result = await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_test_writer',
          marketplaceSlug: 'test-writer',
          skillSlug: 'test-writer',
          ownerId: 'owner_1',
          ownerDisplayName: 'Craft Labs',
          version: '1.4.2',
        },
        api,
        downloadBundle: async () => bundle,
      })

      expect(result).toEqual({ status: 'installed', slug: 'test-writer' })
      expect(readFileSync(join(workspaceRoot, 'skills', 'test-writer', 'SKILL.md'), 'utf-8')).toBe(skillMd)
      expect(existsSync(join(workspaceRoot, 'skills', 'test-writer', 'references', 'guide.md'))).toBe(true)
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'test-writer')).toMatchObject({
        marketplaceId: 'mkt_skill_test_writer',
        marketplaceSlug: 'test-writer',
        ownerId: 'owner_1',
        ownerDisplayName: 'Craft Labs',
        installedVersion: '1.4.2',
        modified: false,
        safetyStatus: 'ok',
        sourceBundleHash: sha256(bundle),
      })
      expect(api.completed).toEqual(['intent_123'])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('requires authenticated user context before requesting an install intent', async () => {
    const workspaceRoot = makeWorkspace()
    const bundle = makeSkillZip('---\nname: Test Writer\ndescription: Creates tests.\n---\n\nBody\n')
    const api = makeApi(bundle)

    try {
      await expect(installMarketplaceSkill({
        workspaceRoot,
        user: null,
        skill: {
          marketplaceId: 'mkt_skill_test_writer',
          marketplaceSlug: 'test-writer',
          skillSlug: 'test-writer',
          ownerId: 'owner_1',
          ownerDisplayName: 'Craft Labs',
          version: '1.4.2',
        },
        api,
        downloadBundle: async () => bundle,
      })).rejects.toThrow('Sign in is required')
      expect(api.intents).toEqual([])
      expect(api.completed).toEqual([])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('returns conflict or skipped without recording install completion for existing Local Skill slugs', async () => {
    const workspaceRoot = makeWorkspace()
    const bundle = makeSkillZip('---\nname: Test Writer\ndescription: Creates tests.\n---\n\nMarketplace body\n')
    const api = makeApi(bundle)

    try {
      const existing = join(workspaceRoot, 'skills', 'test-writer')
      mkdirSync(existing, { recursive: true })
      writeFileSync(join(existing, 'SKILL.md'), '---\nname: Existing\ndescription: Existing skill.\n---\n\nKeep me.\n')

      const common = {
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_test_writer',
          marketplaceSlug: 'test-writer',
          skillSlug: 'test-writer',
          ownerId: 'owner_1',
          ownerDisplayName: 'Craft Labs',
          version: '1.4.2',
        },
        api,
        downloadBundle: async () => bundle,
      }

      await expect(installMarketplaceSkill(common)).resolves.toEqual({ status: 'conflict', slug: 'test-writer' })
      await expect(installMarketplaceSkill({ ...common, conflictResolution: 'skip' })).resolves.toEqual({ status: 'skipped', slug: 'test-writer' })
      expect(readFileSync(join(existing, 'SKILL.md'), 'utf-8')).toContain('Keep me.')
      expect(api.intents).toEqual([])
      expect(api.completed).toEqual([])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('overwrites an existing Local Skill when conflict resolution allows replacement', async () => {
    const workspaceRoot = makeWorkspace()
    const bundle = makeSkillZip('---\nname: Test Writer\ndescription: Creates tests.\n---\n\nMarketplace body\n')
    const api = makeApi(bundle)

    try {
      const existing = join(workspaceRoot, 'skills', 'test-writer')
      mkdirSync(existing, { recursive: true })
      writeFileSync(join(existing, 'SKILL.md'), '---\nname: Existing\ndescription: Existing skill.\n---\n\nOld body.\n')

      const result = await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_test_writer',
          marketplaceSlug: 'test-writer',
          skillSlug: 'test-writer',
          ownerId: 'owner_1',
          ownerDisplayName: 'Craft Labs',
          version: '1.4.2',
        },
        api,
        conflictResolution: 'overwrite',
        downloadBundle: async () => bundle,
      })

      expect(result).toEqual({ status: 'installed', slug: 'test-writer' })
      expect(readFileSync(join(workspaceRoot, 'skills', 'test-writer', 'SKILL.md'), 'utf-8')).toContain('Marketplace body')
      expect(api.completed).toEqual(['intent_123'])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('does not record completion when download, hash verification, or local write fails', async () => {
    const workspaceRoot = makeWorkspace()
    const bundle = makeSkillZip('---\nname: Test Writer\ndescription: Creates tests.\n---\n\nBody\n')
    const api = makeApi(bundle)
    const common = {
      workspaceRoot,
      user: { id: 'user_1' },
      skill: {
        marketplaceId: 'mkt_skill_test_writer',
        marketplaceSlug: 'test-writer',
        skillSlug: 'test-writer',
        ownerId: 'owner_1',
        ownerDisplayName: 'Craft Labs',
        version: '1.4.2',
      },
      api,
    }

    try {
      await expect(installMarketplaceSkill({
        ...common,
        downloadBundle: async () => { throw new Error('Network down.') },
      })).rejects.toThrow('Network down.')
      expect(api.completed).toEqual([])

      await expect(installMarketplaceSkill({
        ...common,
        downloadBundle: async () => makeSkillZip('---\nname: Other\ndescription: Other skill.\n---\n\nChanged\n'),
      })).rejects.toThrow('Marketplace bundle hash mismatch.')
      expect(api.integrityFailures).toHaveLength(1)
      expect(api.completed).toEqual([])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }

    const fileInsteadOfWorkspace = join(makeWorkspace(), 'workspace-file')
    writeFileSync(fileInsteadOfWorkspace, 'not a directory')
    const localWriteApi = makeApi(bundle)
    try {
      await expect(installMarketplaceSkill({
        ...common,
        workspaceRoot: fileInsteadOfWorkspace,
        api: localWriteApi,
        downloadBundle: async () => bundle,
      })).rejects.toThrow()
      expect(localWriteApi.completed).toEqual([])
    } finally {
      rmSync(join(fileInsteadOfWorkspace, '..'), { recursive: true, force: true })
    }
  })

  test('keeps the Local Skill installed when install completion recording fails', async () => {
    const workspaceRoot = makeWorkspace()
    const bundle = makeSkillZip('---\nname: Test Writer\ndescription: Creates tests.\n---\n\nBody\n')
    const api = makeApi(bundle)
    api.failComplete = true

    try {
      const result = await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_test_writer',
          marketplaceSlug: 'test-writer',
          skillSlug: 'test-writer',
          ownerId: 'owner_1',
          ownerDisplayName: 'Craft Labs',
          version: '1.4.2',
        },
        api,
        downloadBundle: async () => bundle,
      })

      expect(result).toEqual({
        status: 'install-complete-failed',
        slug: 'test-writer',
        message: 'Completion endpoint unavailable.',
      })
      expect(existsSync(join(workspaceRoot, 'skills', 'test-writer', 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe('checkMarketplaceSkillUpdates', () => {
  test('checks marketplace-installed Local Skills in a batch and preserves files for unavailable and safety-blocked states', async () => {
    const workspaceRoot = makeWorkspace()
    const installedBundle = makeSkillZip('---\nname: Release Notes\ndescription: Writes notes.\n---\n\nInstalled body\n')
    const api = makeApi(installedBundle)

    try {
      await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_release_notes',
          marketplaceSlug: 'release-notes',
          skillSlug: 'release-notes',
          ownerId: 'owner_1',
          ownerDisplayName: 'Launch Team',
          version: '1.7.1',
        },
        api,
        downloadBundle: async () => installedBundle,
      })
      await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_security_review',
          marketplaceSlug: 'security-review',
          skillSlug: 'security-review',
          ownerId: 'owner_2',
          ownerDisplayName: 'Secure Build',
          version: '3.0.0',
        },
        api,
        downloadBundle: async () => installedBundle,
      })

      const requested: unknown[] = []
      const result = await checkMarketplaceSkillUpdates({
        workspaceRoot,
        now: () => new Date('2026-05-12T12:00:00.000Z'),
        api: {
          async checkUpdates(input) {
            requested.push(input.installed)
            return [
              {
                marketplaceId: 'mkt_skill_release_notes',
                status: 'unavailable',
                message: 'Owner unpublished this Marketplace Skill.',
              },
              {
                marketplaceId: 'mkt_skill_security_review',
                status: 'safety-blocked',
                message: 'Admin blocked this Marketplace Skill.',
              },
            ]
          },
        },
      })

      expect(requested).toEqual([[
        { marketplaceId: 'mkt_skill_release_notes', marketplaceSlug: 'release-notes', installedVersion: '1.7.1' },
        { marketplaceId: 'mkt_skill_security_review', marketplaceSlug: 'security-review', installedVersion: '3.0.0' },
      ]])
      expect(result).toEqual([
        {
          slug: 'release-notes',
          marketplaceId: 'mkt_skill_release_notes',
          marketplaceSlug: 'release-notes',
          installedVersion: '1.7.1',
          status: 'unavailable',
          message: 'Owner unpublished this Marketplace Skill.',
        },
        {
          slug: 'security-review',
          marketplaceId: 'mkt_skill_security_review',
          marketplaceSlug: 'security-review',
          installedVersion: '3.0.0',
          status: 'safety-blocked',
          message: 'Admin blocked this Marketplace Skill.',
        },
      ])
      expect(readFileSync(join(workspaceRoot, 'skills', 'release-notes', 'SKILL.md'), 'utf-8')).toContain('Installed body')
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'release-notes')).toMatchObject({
        safetyStatus: 'unavailable',
        lastCheckedAt: '2026-05-12T12:00:00.000Z',
      })
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'security-review')).toMatchObject({
        safetyStatus: 'safety-blocked',
        lastCheckedAt: '2026-05-12T12:00:00.000Z',
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('leaves local Marketplace metadata unchanged when the update check endpoint is unavailable', async () => {
    const workspaceRoot = makeWorkspace()
    const installedBundle = makeSkillZip('---\nname: API Docs\ndescription: Writes docs.\n---\n\nInstalled body\n')
    const api = makeApi(installedBundle)

    try {
      await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_api_docs',
          marketplaceSlug: 'api-docs',
          skillSlug: 'api-docs',
          ownerId: 'owner_1',
          ownerDisplayName: 'Docs Guild',
          version: '2.1.0',
        },
        api,
        now: () => new Date('2026-05-12T10:00:00.000Z'),
        downloadBundle: async () => installedBundle,
      })

      await expect(checkMarketplaceSkillUpdates({
        workspaceRoot,
        api: {
          async checkUpdates() {
            throw new Error('Marketplace service unavailable.')
          },
        },
      })).rejects.toThrow('Marketplace service unavailable.')

      expect(readMarketplaceOriginMetadata(workspaceRoot, 'api-docs')).toMatchObject({
        installedVersion: '2.1.0',
        safetyStatus: 'ok',
        lastCheckedAt: '2026-05-12T10:00:00.000Z',
      })
      expect(readFileSync(join(workspaceRoot, 'skills', 'api-docs', 'SKILL.md'), 'utf-8')).toContain('Installed body')
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})

describe('applyMarketplaceSkillUpdate', () => {
  test('manually applies an available Marketplace update through intent, hash verification, local overwrite, sidecar update, and completion reporting', async () => {
    const workspaceRoot = makeWorkspace()
    const installedBundle = makeSkillZip('---\nname: Release Notes\ndescription: Writes notes.\n---\n\nOld body\n')
    const updateBundle = makeSkillZip('---\nname: Release Notes\ndescription: Writes notes.\n---\n\nUpdated body\n')
    const installApi = makeApi(installedBundle)
    const completedUpdates: string[] = []
    const requestedUpdates: unknown[] = []

    try {
      await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_release_notes',
          marketplaceSlug: 'release-notes',
          skillSlug: 'release-notes',
          ownerId: 'owner_1',
          ownerDisplayName: 'Launch Team',
          version: '1.7.1',
        },
        api: installApi,
        downloadBundle: async () => installedBundle,
      })

      const result = await applyMarketplaceSkillUpdate({
        workspaceRoot,
        user: { id: 'user_1' },
        slug: 'release-notes',
        targetVersion: '1.8.0',
        now: () => new Date('2026-05-12T12:30:00.000Z'),
        api: {
          async createUpdateIntent(input) {
            requestedUpdates.push(input)
            return {
              intentId: 'update_intent_1',
              downloadUrl: 'https://marketplace.example/bundles/release-notes-1.8.0.zip',
              expectedSha256: sha256(updateBundle),
            }
          },
          async recordUpdateComplete(intentId) {
            completedUpdates.push(intentId)
          },
        },
        downloadBundle: async () => updateBundle,
      })

      expect(result).toEqual({ status: 'installed', slug: 'release-notes' })
      expect(requestedUpdates).toEqual([{
        marketplaceId: 'mkt_skill_release_notes',
        marketplaceSlug: 'release-notes',
        fromVersion: '1.7.1',
        toVersion: '1.8.0',
        userId: 'user_1',
      }])
      expect(completedUpdates).toEqual(['update_intent_1'])
      expect(readFileSync(join(workspaceRoot, 'skills', 'release-notes', 'SKILL.md'), 'utf-8')).toContain('Updated body')
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'release-notes')).toMatchObject({
        marketplaceId: 'mkt_skill_release_notes',
        installedVersion: '1.8.0',
        modified: false,
        sourceBundleHash: sha256(updateBundle),
        safetyStatus: 'ok',
        lastCheckedAt: '2026-05-12T12:30:00.000Z',
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  test('does not overwrite or record update completion when update bundle hash verification fails', async () => {
    const workspaceRoot = makeWorkspace()
    const installedBundle = makeSkillZip('---\nname: Release Notes\ndescription: Writes notes.\n---\n\nOld body\n')
    const tamperedBundle = makeSkillZip('---\nname: Release Notes\ndescription: Writes notes.\n---\n\nTampered body\n')
    const installApi = makeApi(installedBundle)
    const completedUpdates: string[] = []
    const integrityFailures: string[] = []

    try {
      await installMarketplaceSkill({
        workspaceRoot,
        user: { id: 'user_1' },
        skill: {
          marketplaceId: 'mkt_skill_release_notes',
          marketplaceSlug: 'release-notes',
          skillSlug: 'release-notes',
          ownerId: 'owner_1',
          ownerDisplayName: 'Launch Team',
          version: '1.7.1',
        },
        api: installApi,
        downloadBundle: async () => installedBundle,
      })

      await expect(applyMarketplaceSkillUpdate({
        workspaceRoot,
        user: { id: 'user_1' },
        slug: 'release-notes',
        targetVersion: '1.8.0',
        api: {
          async createUpdateIntent() {
            return {
              intentId: 'update_intent_1',
              downloadUrl: 'https://marketplace.example/bundles/release-notes-1.8.0.zip',
              expectedSha256: sha256(installedBundle),
            }
          },
          async recordUpdateComplete(intentId) {
            completedUpdates.push(intentId)
          },
          async reportIntegrityFailure(input) {
            integrityFailures.push(input.actualSha256)
          },
        },
        downloadBundle: async () => tamperedBundle,
      })).rejects.toThrow('Marketplace bundle hash mismatch.')

      expect(completedUpdates).toEqual([])
      expect(integrityFailures).toEqual([sha256(tamperedBundle)])
      expect(readFileSync(join(workspaceRoot, 'skills', 'release-notes', 'SKILL.md'), 'utf-8')).toContain('Old body')
      expect(readMarketplaceOriginMetadata(workspaceRoot, 'release-notes')).toMatchObject({
        installedVersion: '1.7.1',
        sourceBundleHash: sha256(installedBundle),
      })
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })
})
