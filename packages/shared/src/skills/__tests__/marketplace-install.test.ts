import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { zipSync, strToU8 } from 'fflate'
import { createHash } from 'crypto'
import {
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
