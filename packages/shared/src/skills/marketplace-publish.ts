import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, normalize } from 'path'
import { zipSync } from 'fflate'
import { valid as validSemver } from 'semver'
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { deriveSkillSlug, loadSkill } from './storage.ts'
import type { SkillMetadata } from './types.ts'
import {
  MARKETPLACE_ORIGIN_METADATA_FILE,
  readMarketplaceOriginMetadata,
  type MarketplaceOriginMetadata,
} from './marketplace-install.ts'

export { MARKETPLACE_ORIGIN_METADATA_FILE, readMarketplaceOriginMetadata } from './marketplace-install.ts'

export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const

export type ProductMarketplaceCategory = typeof PRODUCT_MARKETPLACE_CATEGORIES[number]

export interface MarketplacePublishApiInput {
  userId: string
  bundle: Uint8Array
  marketplaceSlug: string
  version: string
  category: ProductMarketplaceCategory
  tags?: string[]
  releaseNotes?: string
  basedOn?: {
    marketplaceId: string
    marketplaceSlug: string
    version: string
  }
}

export type MarketplacePublishApiResult =
  | {
      status: 'published'
      marketplaceId: string
      marketplaceSlug: string
      version: string
      ownerId: string
      ownerDisplayName: string
    }
  | {
      status: 'slug-conflict'
      marketplaceSlug: string
      message: string
    }

export interface MarketplacePublishApi {
  publishSkill(input: MarketplacePublishApiInput): Promise<MarketplacePublishApiResult>
}

export interface MarketplacePublishRequest {
  workspaceRoot: string
  user: { id: string } | null
  skillSlug: string
  marketplaceSlug: string
  version: string
  category: string
  tags?: string[]
  releaseNotes?: string
  api: MarketplacePublishApi
  now?: () => Date
}

export interface MarketplaceLocalSkillPublishInput {
  userId: string
  skillSlug: string
  marketplaceSlug: string
  version: string
  category: string
  tags?: string[]
  releaseNotes?: string
}

export type MarketplacePublishLocalResult =
  | {
      status: 'published'
      marketplaceId: string
      marketplaceSlug: string
      version: string
    }
  | {
      status: 'slug-conflict'
      marketplaceSlug: string
      message: string
    }

export function suggestMarketplaceSlug(metadata: Pick<SkillMetadata, 'name'>): string {
  return deriveSkillSlug(metadata.name)
}

export function validateMarketplacePublishRequest(input: {
  marketplaceSlug: string
  version: string
  category: string
  tags?: string[]
  releaseNotes?: string
}): string[] {
  const errors: string[] = []
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.marketplaceSlug)) {
    errors.push('Marketplace slug must use lowercase letters, numbers, and single hyphens.')
  }
  if (!validSemver(input.version)) {
    errors.push('Version must be a valid SemVer version.')
  }
  if (!isProductMarketplaceCategory(input.category)) {
    errors.push(`Category must be one of ${PRODUCT_MARKETPLACE_CATEGORIES.join(', ')}.`)
  }
  if (input.tags?.some((tag) => !/^[a-z0-9][a-z0-9-]{0,39}$/.test(tag))) {
    errors.push('Tags must use lowercase letters, numbers, and hyphens.')
  }
  if (input.releaseNotes && input.releaseNotes.length > 5000) {
    errors.push('Release notes must be 5000 characters or fewer.')
  }
  return errors
}

export async function publishLocalSkillToMarketplace(
  request: MarketplacePublishRequest,
): Promise<MarketplacePublishLocalResult> {
  if (!request.user) {
    throw new Error('Sign in is required to publish Marketplace Skills.')
  }

  const skill = loadSkill(request.workspaceRoot, request.skillSlug)
  if (!skill) {
    throw new Error('Local Skill must have valid SKILL.md frontmatter before it can be published.')
  }

  const validationErrors = validateMarketplacePublishRequest(request)
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join(' '))
  }
  if (!isProductMarketplaceCategory(request.category)) {
    throw new Error('Category must be product-defined.')
  }

  const bundle = bundleLocalSkill(request.workspaceRoot, request.skillSlug)
  const origin = readMarketplaceOriginMetadata(request.workspaceRoot, request.skillSlug)
  const published = await request.api.publishSkill({
    userId: request.user.id,
    bundle,
    marketplaceSlug: request.marketplaceSlug,
    version: request.version,
    category: request.category,
    tags: cleanOptionalStringArray(request.tags),
    releaseNotes: cleanOptionalString(request.releaseNotes),
    basedOn: origin
      ? {
          marketplaceId: origin.marketplaceId,
          marketplaceSlug: origin.marketplaceSlug,
          version: origin.installedVersion,
        }
      : undefined,
  })

  if (published.status === 'slug-conflict') return published

  const publishedAt = (request.now?.() ?? new Date()).toISOString()
  writeMarketplacePublishMetadata(request.workspaceRoot, request.skillSlug, {
    marketplaceId: published.marketplaceId,
    marketplaceSlug: published.marketplaceSlug,
    ownerId: published.ownerId,
    ownerDisplayName: published.ownerDisplayName,
    installedVersion: published.version,
    installedAt: origin?.installedAt ?? publishedAt,
    lastCheckedAt: publishedAt,
    modified: false,
    sourceBundleHash: sha256(bundle),
    sourceBundleContentHash: sha256(bundle),
    safetyStatus: 'ok',
    basedOn: origin && origin.ownerId !== published.ownerId
      ? {
          marketplaceId: origin.marketplaceId,
          marketplaceSlug: origin.marketplaceSlug,
          version: origin.installedVersion,
        }
      : origin?.basedOn,
  })

  return {
    status: 'published',
    marketplaceId: published.marketplaceId,
    marketplaceSlug: published.marketplaceSlug,
    version: published.version,
  }
}

export async function publishLocalSkillToMarketplaceService(
  workspaceRoot: string,
  input: MarketplaceLocalSkillPublishInput,
  options: {
    baseUrl: string
    fetchImpl?: typeof fetch
    now?: () => Date
  },
): Promise<MarketplacePublishLocalResult> {
  return publishLocalSkillToMarketplace({
    workspaceRoot,
    user: { id: input.userId },
    skillSlug: input.skillSlug,
    marketplaceSlug: input.marketplaceSlug,
    version: input.version,
    category: input.category,
    tags: input.tags,
    releaseNotes: input.releaseNotes,
    now: options.now,
    api: createHttpMarketplacePublishApi(options.baseUrl, options.fetchImpl ?? fetch),
  })
}

export function createHttpMarketplacePublishApi(baseUrl: string, fetchImpl: typeof fetch = fetch): MarketplacePublishApi {
  return {
    async publishSkill(input) {
      const form = new FormData()
      form.set('bundle', new Blob([toArrayBuffer(input.bundle)], { type: 'application/zip' }), 'skill.zip')
      form.set('marketplaceSlug', input.marketplaceSlug)
      form.set('version', input.version)
      form.set('category', input.category)
      if (input.tags && input.tags.length > 0) form.set('tags', JSON.stringify(input.tags))
      if (input.releaseNotes) form.set('releaseNotes', input.releaseNotes)
      if (input.basedOn) form.set('basedOn', JSON.stringify(input.basedOn))

      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/skills/publish`, {
        method: 'POST',
        headers: {
          'X-Craft-User-Id': input.userId,
        },
        body: form,
      })
      const data = await response.json().catch(() => ({})) as Partial<MarketplacePublishApiResult> & { message?: string }

      if (response.status === 409) {
        return {
          status: 'slug-conflict',
          marketplaceSlug: input.marketplaceSlug,
          message: data.message ?? 'Marketplace slug is owned by another publisher.',
        }
      }
      if (!response.ok) {
        throw new Error(data.message ?? `Marketplace publish failed with HTTP ${response.status}.`)
      }
      if (data.status !== 'published' || !data.marketplaceId || !data.marketplaceSlug || !data.version || !data.ownerId || !data.ownerDisplayName) {
        throw new Error('Marketplace publish response is missing published Skill metadata.')
      }
      return {
        status: 'published',
        marketplaceId: data.marketplaceId,
        marketplaceSlug: data.marketplaceSlug,
        version: data.version,
        ownerId: data.ownerId,
        ownerDisplayName: data.ownerDisplayName,
      }
    },
  }
}

function bundleLocalSkill(workspaceRoot: string, skillSlug: string): Uint8Array {
  const skillDir = join(getWorkspaceSkillsPath(workspaceRoot), skillSlug)
  const files: Record<string, Uint8Array> = {}
  for (const relativePath of listPublishableSkillFiles(skillDir)) {
    files[relativePath] = readFileSync(join(skillDir, relativePath))
  }
  if (!files['SKILL.md']) {
    throw new Error('Local Skill bundle must include SKILL.md.')
  }
  return zipSync(files)
}

function listPublishableSkillFiles(root: string, dir = root): string[] {
  if (!existsSync(root)) return []

  const paths: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = join(dir, entry.name)
    const relativePath = normalize(absolutePath.slice(root.length + 1)).replace(/\\/g, '/')
    if (relativePath === MARKETPLACE_ORIGIN_METADATA_FILE) continue
    if (entry.isDirectory()) {
      paths.push(...listPublishableSkillFiles(root, absolutePath))
      continue
    }
    if (!entry.isFile()) continue
    if (!statSync(absolutePath).isFile()) continue
    paths.push(relativePath)
  }
  return paths.sort((a, b) => a.localeCompare(b))
}

function writeMarketplacePublishMetadata(
  workspaceRoot: string,
  skillSlug: string,
  metadata: MarketplaceOriginMetadata,
): void {
  const skillDir = join(getWorkspaceSkillsPath(workspaceRoot), skillSlug)
  writeFileSync(join(skillDir, MARKETPLACE_ORIGIN_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`)
}

function isProductMarketplaceCategory(category: string): category is ProductMarketplaceCategory {
  return PRODUCT_MARKETPLACE_CATEGORIES.includes(category as ProductMarketplaceCategory)
}

function cleanOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function cleanOptionalStringArray(value: string[] | undefined): string[] | undefined {
  const cleaned = value?.map((entry) => entry.trim()).filter(Boolean)
  return cleaned && cleaned.length > 0 ? cleaned : undefined
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
