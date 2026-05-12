import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, normalize, sep } from 'path'
import { unzipSync } from 'fflate'
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts'
import { invalidateSkillsCache, skillExists } from './storage.ts'

export type MarketplaceOriginSafetyStatus = 'ok' | 'unavailable' | 'safety-blocked'

export interface MarketplaceOriginMetadata {
  marketplaceId: string
  marketplaceSlug: string
  ownerId: string
  ownerDisplayName: string
  installedVersion: string
  installedAt: string
  lastCheckedAt: string
  modified: boolean
  sourceBundleHash: string
  safetyStatus: MarketplaceOriginSafetyStatus
  basedOn?: {
    marketplaceId: string
    marketplaceSlug: string
    version: string
  }
}

export interface MarketplaceInstallSkill {
  marketplaceId: string
  marketplaceSlug: string
  skillSlug: string
  ownerId: string
  ownerDisplayName: string
  version: string
  basedOn?: MarketplaceOriginMetadata['basedOn']
}

export interface MarketplaceInstallIntent {
  intentId: string
  downloadUrl: string
  expectedSha256: string
}

export interface MarketplaceInstallApi {
  createInstallIntent(input: {
    marketplaceId: string
    marketplaceSlug: string
    version: string
    userId: string
  }): Promise<MarketplaceInstallIntent>
  recordInstallComplete(intentId: string): Promise<void>
  reportIntegrityFailure?(input: {
    intentId: string
    marketplaceId: string
    expectedSha256: string
    actualSha256: string
  }): Promise<void>
}

export type MarketplaceInstallConflictResolution = 'skip' | 'overwrite'

export interface MarketplaceInstallRequest {
  workspaceRoot: string
  user: { id: string } | null
  skill: MarketplaceInstallSkill
  api: MarketplaceInstallApi
  conflictResolution?: MarketplaceInstallConflictResolution
  downloadBundle: (downloadUrl: string) => Promise<Uint8Array>
  now?: () => Date
}

export interface MarketplaceSkillInstallInput {
  userId: string
  skill: MarketplaceInstallSkill
  intent: MarketplaceInstallIntent
  conflictResolution?: MarketplaceInstallConflictResolution
}

export type MarketplaceInstallResult =
  | { status: 'installed'; slug: string }
  | { status: 'conflict'; slug: string }
  | { status: 'skipped'; slug: string }
  | { status: 'install-complete-failed'; slug: string; message: string }

export const MARKETPLACE_ORIGIN_METADATA_FILE = '.marketplace-origin.json'

export function readMarketplaceOriginMetadata(workspaceRoot: string, slug: string): MarketplaceOriginMetadata | null {
  const path = join(getWorkspaceSkillsPath(workspaceRoot), slug, MARKETPLACE_ORIGIN_METADATA_FILE)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8')) as MarketplaceOriginMetadata
}

export async function downloadMarketplaceBundle(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Marketplace bundle download failed with HTTP ${response.status}.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function installMarketplaceSkill(request: MarketplaceInstallRequest): Promise<MarketplaceInstallResult> {
  if (!request.user) {
    throw new Error('Sign in is required to install Marketplace Skills.')
  }

  const slug = request.skill.skillSlug
  const hasConflict = skillExists(request.workspaceRoot, slug)
  if (hasConflict && !request.conflictResolution) {
    return { status: 'conflict', slug }
  }
  if (hasConflict && request.conflictResolution === 'skip') {
    return { status: 'skipped', slug }
  }

  const intent = await request.api.createInstallIntent({
    marketplaceId: request.skill.marketplaceId,
    marketplaceSlug: request.skill.marketplaceSlug,
    version: request.skill.version,
    userId: request.user.id,
  })

  const bundle = await request.downloadBundle(intent.downloadUrl)
  const actualSha256 = sha256(bundle)
  const tempDir = mkdtempSync(join(tmpdir(), 'marketplace-skill-'))
  try {
    writeFileSync(join(tempDir, 'bundle.zip'), bundle)
    if (actualSha256 !== intent.expectedSha256) {
      await request.api.reportIntegrityFailure?.({
        intentId: intent.intentId,
        marketplaceId: request.skill.marketplaceId,
        expectedSha256: intent.expectedSha256,
        actualSha256,
      })
      throw new Error('Marketplace bundle hash mismatch.')
    }

    writeSkillBundle(request.workspaceRoot, slug, bundle, request.conflictResolution === 'overwrite')
    writeMarketplaceOriginMetadata(request.workspaceRoot, slug, {
      marketplaceId: request.skill.marketplaceId,
      marketplaceSlug: request.skill.marketplaceSlug,
      ownerId: request.skill.ownerId,
      ownerDisplayName: request.skill.ownerDisplayName,
      installedVersion: request.skill.version,
      installedAt: (request.now?.() ?? new Date()).toISOString(),
      lastCheckedAt: (request.now?.() ?? new Date()).toISOString(),
      modified: false,
      sourceBundleHash: actualSha256,
      safetyStatus: 'ok',
      basedOn: request.skill.basedOn,
    })
    invalidateSkillsCache()

    try {
      await request.api.recordInstallComplete(intent.intentId)
      return { status: 'installed', slug }
    } catch (error) {
      return {
        status: 'install-complete-failed',
        slug,
        message: error instanceof Error ? error.message : 'Marketplace install completion failed.',
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export async function installMarketplaceSkillFromIntent(
  workspaceRoot: string,
  input: MarketplaceSkillInstallInput,
): Promise<MarketplaceInstallResult> {
  return installMarketplaceSkill({
    workspaceRoot,
    user: { id: input.userId },
    skill: input.skill,
    conflictResolution: input.conflictResolution,
    api: {
      async createInstallIntent() {
        return input.intent
      },
      async recordInstallComplete() {
        // The renderer calls the Marketplace service completion endpoint after
        // this local install succeeds, keeping hosted API credentials out here.
      },
    },
    downloadBundle: downloadMarketplaceBundle,
  })
}

function writeMarketplaceOriginMetadata(workspaceRoot: string, slug: string, metadata: MarketplaceOriginMetadata): void {
  const skillDir = join(getWorkspaceSkillsPath(workspaceRoot), slug)
  writeFileSync(
    join(skillDir, MARKETPLACE_ORIGIN_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
  )
}

function writeSkillBundle(workspaceRoot: string, slug: string, bundle: Uint8Array, overwrite: boolean): void {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot)
  const skillDir = join(skillsDir, slug)
  if (overwrite) {
    rmSync(skillDir, { recursive: true, force: true })
  }
  mkdirSync(skillDir, { recursive: true })

  const files = normalizeBundleFiles(unzipSync(bundle))
  for (const [relativePath, data] of files) {
    const target = safeJoin(skillDir, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
  }
}

function normalizeBundleFiles(files: Record<string, Uint8Array>): Array<[string, Uint8Array]> {
  const entries = Object.entries(files)
    .map(([path, data]) => [path.replace(/\\/g, '/'), data] as [string, Uint8Array])
    .filter(([path]) => !path.startsWith('__MACOSX/') && !path.includes('/__MACOSX/'))

  if (entries.some(([path]) => path === 'SKILL.md')) {
    return entries.filter(([path]) => !path.endsWith('/'))
  }

  const rootNames = new Set(entries.map(([path]) => path.split('/')[0]).filter(Boolean))
  if (rootNames.size === 1) {
    const [rootName] = rootNames
    const prefix = `${rootName}/`
    const stripped = entries
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => [path.slice(prefix.length), data] as [string, Uint8Array])
      .filter(([path]) => path.length > 0 && !path.endsWith('/'))
    if (stripped.some(([path]) => path === 'SKILL.md')) return stripped
  }

  throw new Error('Marketplace bundle does not contain a root SKILL.md.')
}

function safeJoin(root: string, relativePath: string): string {
  const target = normalize(join(root, relativePath))
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`
  if (target !== root && !target.startsWith(rootWithSeparator)) {
    throw new Error('Marketplace bundle contains an unsafe file path.')
  }
  return target
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
