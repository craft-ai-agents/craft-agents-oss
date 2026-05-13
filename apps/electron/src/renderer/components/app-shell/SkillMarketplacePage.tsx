import * as React from 'react'
import { AlertTriangle, CheckCircle2, Download, FileArchive, Flag, Globe2, PencilLine, Search, ShieldAlert, Store, UserCog } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { resolveMarketplaceServiceConfig } from '@craft-agent/shared/skills'
import { deriveSkillSlug } from '@craft-agent/shared/skills/slug'
import type {
  DiscoveredSkill,
  MarketplaceDirectSkillPublishInput,
  MarketplacePublishDirectResult,
  MarketplaceInstallConflictResolution,
  MarketplaceInstallIntent,
  MarketplaceInstallResult,
  MarketplaceOriginMetadata,
  MarketplaceSkillInstallInput,
  MarketplaceSkillUpdateInput,
} from '@craft-agent/shared/skills'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SkillPicker } from './SkillPicker'
import { getRemoteResolvePhase } from './remote-skill-import-state'

/** Install/update state shown for a Marketplace Skill in the catalog and detail views. */
export type MarketplaceInstallState =
  | 'install'
  | 'installed'
  | 'update-available'
  | 'modified-locally'
  | 'unavailable'
  | 'safety-blocked'

/** Product-owned category vocabulary for Marketplace browsing filters. */
export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const

/** Direct Marketplace publish paths supported by the publish-only dialog. */
export const MARKETPLACE_DIRECT_PUBLISH_TABS = ['create', 'remote', 'upload'] as const

type DirectPublishTab = typeof MARKETPLACE_DIRECT_PUBLISH_TABS[number]

/** Summary data shown on Marketplace listing cards. */
export interface MarketplaceSkillListing {
  id: string
  slug: string
  ownerId: string
  icon: string
  name: string
  description: string
  owner: string
  category: string
  tags: string[]
  latestVersion: string
  installCount: number
  installState: MarketplaceInstallState
}

/** Published version metadata shown in Marketplace Skill detail. */
export interface MarketplaceSkillVersion {
  version: string
  publishedAt: string
  releaseNotes: string
}

/** Full read-only Marketplace Skill detail payload. */
export interface MarketplaceSkillDetail extends MarketplaceSkillListing {
  skillMarkdown: string
  requiredSources: string[]
  versions: MarketplaceSkillVersion[]
  metadata: {
    marketplaceId: string
    marketplaceSlug: string
    publishedAt: string
    updatedAt: string
  }
}

/** Catalog filters supported by the Marketplace browsing surface. */
export interface MarketplaceCatalogFilters {
  search?: string
  category?: string
  tag?: string
}

/** Minimal Marketplace API boundary used by the read-only browsing slice. */
export interface MarketplaceApi {
  listSkills: () => Promise<MarketplaceSkillListing[]>
  getSkillDetail: (slug: string) => Promise<MarketplaceSkillDetail>
  reportSkill: (input: MarketplaceSkillReportInput) => Promise<MarketplaceReportResult>
  createInstallIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordInstallComplete: (intentId: string) => Promise<void>
  createUpdateIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordUpdateComplete: (intentId: string) => Promise<void>
}

/** Service boundary used to publish a Local Skill into Marketplace. */
export interface MarketplacePublishApi {
  publishSkill: (input: { userId: string; skillSlug: string }) => Promise<MarketplacePublishResult>
}

/** UI-safe result returned after attempting a Marketplace publish handoff. */
export type MarketplacePublishResult =
  | { status: 'published'; marketplaceSlug: string }
  | { status: 'slug-conflict'; marketplaceSlug: string; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

/** User-authenticated report payload sent to the Marketplace service for abuse review. */
export interface MarketplaceSkillReportInput {
  userId: string
  marketplaceId: string
  marketplaceSlug: string
  context: string
}

/** UI-safe result returned after attempting a Marketplace Skill report. */
export type MarketplaceReportResult =
  | { status: 'submitted'; reportId: string }
  | { status: 'validation-error'; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

/** Electron bridge used to install Marketplace Skills into Local Skills. */
export interface MarketplaceInstallElectronApi {
  installMarketplaceSkill(workspaceId: string, input: MarketplaceSkillInstallInput): Promise<MarketplaceInstallResult>
}

/** Electron bridge used to apply Marketplace updates to Local Skills. */
export interface MarketplaceUpdateElectronApi {
  updateMarketplaceSkill(workspaceId: string, input: MarketplaceSkillUpdateInput): Promise<MarketplaceInstallResult>
}

/** Electron bridge used to publish Marketplace Skills without installing them locally. */
export interface MarketplaceDirectPublishElectronApi {
  publishDirectMarketplaceSkill(workspaceId: string, input: MarketplaceDirectSkillPublishInput): Promise<MarketplacePublishDirectResult>
}

/** Result of loading and filtering the Marketplace catalog. */
export type MarketplaceCatalogState =
  | {
      status: 'ready'
      listings: MarketplaceSkillListing[]
      availableCategories: string[]
      availableTags: string[]
    }
  | { status: 'error'; message: string }

/** Result of loading a Marketplace Skill detail page. */
export type MarketplaceDetailState =
  | { status: 'ready'; detail: MarketplaceSkillDetail }
  | { status: 'error'; message: string }

/** Static API configuration used for the mocked Marketplace boundary. */
export interface StaticMarketplaceApiOptions {
  listings?: MarketplaceSkillListing[]
  details?: Record<string, MarketplaceSkillDetail>
  listError?: string
  detailError?: string
}

const DEFAULT_MARKETPLACE_LISTINGS: MarketplaceSkillListing[] = [
  {
    id: 'mkt_skill_test_writer',
    slug: 'test-writer',
    ownerId: 'owner_craft_labs',
    icon: 'TW',
    name: 'Test Writer',
    description: 'Creates focused regression tests for bug fixes and feature slices.',
    owner: 'Craft Labs',
    category: 'Quality',
    tags: ['ci', 'testing', 'automation'],
    latestVersion: '1.4.2',
    installCount: 1284,
    installState: 'install',
  },
  {
    id: 'mkt_skill_api-docs',
    slug: 'api-docs',
    ownerId: 'owner_docs_guild',
    icon: 'AD',
    name: 'API Docs Companion',
    description: 'Keeps endpoint references and examples aligned with source changes.',
    owner: 'Docs Guild',
    category: 'Documentation',
    tags: ['api', 'docs'],
    latestVersion: '2.1.0',
    installCount: 847,
    installState: 'installed',
  },
  {
    id: 'mkt_skill_release-notes',
    slug: 'release-notes',
    ownerId: 'owner_1',
    icon: 'RN',
    name: 'Release Notes',
    description: 'Turns merged changes into concise release notes for product teams.',
    owner: 'Launch Team',
    category: 'Product',
    tags: ['release', 'writing'],
    latestVersion: '1.8.0',
    installCount: 2319,
    installState: 'update-available',
  },
  {
    id: 'mkt_skill_security-review',
    slug: 'security-review',
    ownerId: 'owner_secure_build',
    icon: 'SR',
    name: 'Security Review',
    description: 'Checks code and configuration changes for common security risks.',
    owner: 'Secure Build',
    category: 'Security',
    tags: ['audit', 'security'],
    latestVersion: '3.0.1',
    installCount: 642,
    installState: 'safety-blocked',
  },
]

const DEFAULT_MARKETPLACE_DETAILS: Record<string, MarketplaceSkillDetail> = {
  'test-writer': {
    ...DEFAULT_MARKETPLACE_LISTINGS[0],
    skillMarkdown: [
      '---',
      'name: Test Writer',
      'description: Creates focused regression tests for bug fixes and feature slices.',
      '---',
      '',
      '# Test Writer',
      '',
      'Use this skill to add behavior-first regression tests before changing implementation code.',
    ].join('\n'),
    requiredSources: ['GitHub repository', 'Local workspace files'],
    versions: [
      { version: '1.4.2', publishedAt: '2026-05-01', releaseNotes: 'Adds CI-focused assertion guidance.' },
      { version: '1.3.0', publishedAt: '2026-04-12', releaseNotes: 'Improves integration test examples.' },
      { version: '1.0.0', publishedAt: '2026-03-18', releaseNotes: 'Initial public release.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_test_writer',
      marketplaceSlug: 'test-writer',
      publishedAt: '2026-03-18',
      updatedAt: '2026-05-01',
    },
  },
  'api-docs': {
    ...DEFAULT_MARKETPLACE_LISTINGS[1],
    skillMarkdown: [
      '---',
      'name: API Docs Companion',
      'description: Keeps endpoint references and examples aligned with source changes.',
      '---',
      '',
      '# API Docs Companion',
      '',
      'Review changed handlers, schemas, and public examples before updating documentation.',
    ].join('\n'),
    requiredSources: ['API source files', 'Documentation directory'],
    versions: [
      { version: '2.1.0', publishedAt: '2026-04-28', releaseNotes: 'Adds schema drift checks.' },
      { version: '2.0.0', publishedAt: '2026-04-03', releaseNotes: 'Refreshes endpoint grouping.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_api-docs',
      marketplaceSlug: 'api-docs',
      publishedAt: '2026-04-03',
      updatedAt: '2026-04-28',
    },
  },
  'release-notes': {
    ...DEFAULT_MARKETPLACE_LISTINGS[2],
    skillMarkdown: [
      '---',
      'name: Release Notes',
      'description: Turns merged changes into concise release notes for product teams.',
      '---',
      '',
      '# Release Notes',
      '',
      'Summarize completed work by user-visible outcome and include migration notes when needed.',
    ].join('\n'),
    requiredSources: ['Git history', 'Issue tracker'],
    versions: [
      { version: '1.8.0', publishedAt: '2026-05-03', releaseNotes: 'Adds owner-facing changelog sections.' },
      { version: '1.7.1', publishedAt: '2026-04-20', releaseNotes: 'Fixes duplicate bullet grouping.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_release-notes',
      marketplaceSlug: 'release-notes',
      publishedAt: '2026-02-22',
      updatedAt: '2026-05-03',
    },
  },
  'security-review': {
    ...DEFAULT_MARKETPLACE_LISTINGS[3],
    skillMarkdown: [
      '---',
      'name: Security Review',
      'description: Checks code and configuration changes for common security risks.',
      '---',
      '',
      '# Security Review',
      '',
      'Inspect changed authentication, credential, network, and filesystem paths before release.',
    ].join('\n'),
    requiredSources: ['Changed code', 'Security policy docs'],
    versions: [
      { version: '3.0.1', publishedAt: '2026-04-30', releaseNotes: 'Safety blocked pending marketplace review.' },
      { version: '3.0.0', publishedAt: '2026-04-21', releaseNotes: 'Adds credential exposure checks.' },
    ],
    metadata: {
      marketplaceId: 'mkt_skill_security-review',
      marketplaceSlug: 'security-review',
      publishedAt: '2026-01-15',
      updatedAt: '2026-04-30',
    },
  },
}

/** Creates the mocked Marketplace API used until the service-backed API exists. */
export function createStaticMarketplaceApi(options?: StaticMarketplaceApiOptions): MarketplaceApi {
  const listings = options?.listings ?? DEFAULT_MARKETPLACE_LISTINGS
  const details = options?.details ?? DEFAULT_MARKETPLACE_DETAILS

  return {
    async listSkills() {
      if (options?.listError) throw new Error(options.listError)
      return listings
    },
    async getSkillDetail(slug) {
      if (options?.detailError) throw new Error(options.detailError)
      const detail = details[slug]
      if (!detail) throw new Error('Marketplace Skill not found.')
      return detail
    },
    async reportSkill(input) {
      return { status: 'submitted', reportId: `report_${input.marketplaceId}` }
    },
    async createInstallIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return {
        intentId: `intent_${detail.id}`,
        downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`,
        expectedSha256: await sha256Hex(bytes),
      }
    },
    async recordInstallComplete() {
      // Static Marketplace API records no hosted metrics.
    },
    async createUpdateIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return {
        intentId: `update_intent_${detail.id}`,
        downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`,
        expectedSha256: await sha256Hex(bytes),
      }
    },
    async recordUpdateComplete() {
      // Static Marketplace API records no hosted metrics.
    },
  }
}

/** Applies Marketplace search, category, and tag filters to listing summaries. */
export function filterMarketplaceListings(
  listings: MarketplaceSkillListing[],
  filters: MarketplaceCatalogFilters,
): MarketplaceSkillListing[] {
  const search = filters.search?.trim().toLowerCase() ?? ''
  const category = filters.category?.trim()
  const tag = filters.tag?.trim().toLowerCase()

  return listings.filter((listing) => {
    const matchesSearch = !search
      || listing.name.toLowerCase().includes(search)
      || listing.description.toLowerCase().includes(search)
      || listing.owner.toLowerCase().includes(search)
      || listing.tags.some((candidate) => candidate.toLowerCase().includes(search))
    const matchesCategory = !category || listing.category === category
    const matchesTag = !tag || listing.tags.some((candidate) => candidate.toLowerCase() === tag)

    return matchesSearch && matchesCategory && matchesTag
  })
}

/** Loads Marketplace listings and returns a UI-safe catalog state. */
export async function loadMarketplaceCatalog(
  api: MarketplaceApi,
  filters: MarketplaceCatalogFilters,
): Promise<MarketplaceCatalogState> {
  try {
    const listings = await api.listSkills()
    return {
      status: 'ready',
      listings: filterMarketplaceListings(listings, filters),
      availableCategories: [...PRODUCT_MARKETPLACE_CATEGORIES],
      availableTags: uniqueSorted(listings.flatMap((listing) => listing.tags)),
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The Marketplace is unavailable.',
    }
  }
}

/** Loads one Marketplace Skill detail and returns a UI-safe detail state. */
export async function loadMarketplaceDetail(
  api: MarketplaceApi,
  slug: string,
): Promise<MarketplaceDetailState> {
  try {
    return { status: 'ready', detail: await api.getSkillDetail(slug) }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The Marketplace detail is unavailable.',
    }
  }
}

export async function installMarketplaceSkillFromDetail({
  workspaceId,
  userId,
  detail,
  api,
  electronAPI,
  conflictResolution,
}: {
  workspaceId: string
  userId: string | null
  detail: MarketplaceSkillDetail
  api: MarketplaceApi
  electronAPI: MarketplaceInstallElectronApi
  conflictResolution?: MarketplaceInstallConflictResolution
}): Promise<MarketplaceInstallResult | { status: 'auth-required'; message: string } | { status: 'error'; message: string }> {
  if (!userId) {
    return { status: 'auth-required', message: 'Sign in is required to install Marketplace Skills.' }
  }

  try {
    const intent = await api.createInstallIntent(detail, userId)
    const result = await electronAPI.installMarketplaceSkill(workspaceId, {
      userId,
      conflictResolution,
      intent,
      skill: {
        marketplaceId: detail.metadata.marketplaceId,
        marketplaceSlug: detail.metadata.marketplaceSlug,
        skillSlug: detail.slug,
        ownerId: detail.ownerId,
        ownerDisplayName: detail.owner,
        version: detail.latestVersion,
      },
    })
    if (result.status !== 'installed') return result

    try {
      await api.recordInstallComplete(intent.intentId)
      return result
    } catch (error) {
      return {
        status: 'install-complete-failed',
        slug: detail.slug,
        message: error instanceof Error ? error.message : 'Marketplace install completion failed.',
      }
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Marketplace install failed.',
    }
  }
}

/** Requests an update intent, applies the local update, and reports hosted completion. */
export async function updateMarketplaceSkillFromDetail({
  workspaceId,
  userId,
  detail,
  api,
  electronAPI,
}: {
  workspaceId: string
  userId: string | null
  detail: MarketplaceSkillDetail
  api: MarketplaceApi
  electronAPI: MarketplaceUpdateElectronApi
}): Promise<MarketplaceInstallResult | { status: 'auth-required'; message: string } | { status: 'error'; message: string }> {
  if (!userId) {
    return { status: 'auth-required', message: 'Sign in is required to update Marketplace Skills.' }
  }

  try {
    const intent = await api.createUpdateIntent(detail, userId)
    const result = await electronAPI.updateMarketplaceSkill(workspaceId, {
      userId,
      slug: detail.slug,
      targetVersion: detail.latestVersion,
      intent,
    })
    if (result.status !== 'installed') return result

    try {
      await api.recordUpdateComplete(intent.intentId)
      return result
    } catch (error) {
      return {
        status: 'install-complete-failed',
        slug: detail.slug,
        message: error instanceof Error ? error.message : 'Marketplace update completion failed.',
      }
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Marketplace update failed.',
    }
  }
}

/** Starts the Marketplace publish handoff only when an authenticated user is available. */
export async function publishMarketplaceSkill({
  userId,
  skillSlug,
  api,
}: {
  userId: string | null
  skillSlug: string
  api: MarketplacePublishApi
}): Promise<MarketplacePublishResult> {
  if (!userId) {
    return { status: 'auth-required', message: 'Sign in is required to publish Marketplace Skills.' }
  }

  try {
    return await api.publishSkill({ userId, skillSlug })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Marketplace publish failed.',
    }
  }
}

/** Submits a user report for one published Marketplace Skill after auth and context validation. */
export async function reportMarketplaceSkillFromDetail({
  userId,
  detail,
  context,
  api,
}: {
  userId: string | null
  detail: MarketplaceSkillDetail
  context: string
  api: MarketplaceApi
}): Promise<MarketplaceReportResult> {
  if (!userId) {
    return { status: 'auth-required', message: 'Sign in is required to report Marketplace Skills.' }
  }

  const trimmedContext = context.trim()
  if (!trimmedContext) {
    return { status: 'validation-error', message: 'Add report details before submitting.' }
  }

  try {
    return await api.reportSkill({
      userId,
      marketplaceId: detail.metadata.marketplaceId,
      marketplaceSlug: detail.metadata.marketplaceSlug,
      context: trimmedContext,
    })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Marketplace report failed.',
    }
  }
}

/** Publishes a Skill directly from Marketplace without creating or updating a Local Skill. */
export async function publishDirectMarketplaceSkill({
  workspaceId,
  userId,
  skill,
  marketplaceSlug,
  version,
  category,
  tags,
  releaseNotes,
  electronAPI,
}: {
  workspaceId: string
  userId: string | null
  skill: DiscoveredSkill
  marketplaceSlug: string
  version: string
  category: string
  tags?: string[]
  releaseNotes?: string
  electronAPI: MarketplaceDirectPublishElectronApi
}): Promise<DirectPublishState> {
  if (!userId) {
    return { status: 'auth-required', message: 'Sign in is required to publish Marketplace Skills.' }
  }
  if (!workspaceId) {
    return { status: 'error', message: 'Open a workspace before publishing Marketplace Skills.' }
  }

  const errors = validateDirectPublishFields({ skill, marketplaceSlug, version, category, tags, releaseNotes })
  if (errors.length > 0) {
    return { status: 'validation-error', message: errors.join(' ') }
  }

  try {
    return await electronAPI.publishDirectMarketplaceSkill(workspaceId, {
      userId,
      skill: {
        slug: skill.slug,
        metadata: skill.metadata,
        content: skill.content,
      },
      marketplaceSlug: marketplaceSlug.trim(),
      version: version.trim(),
      category,
      tags: cleanTags(tags),
      releaseNotes: releaseNotes?.trim() || undefined,
    })
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Marketplace publish failed.',
    }
  }
}

const defaultMarketplaceApi = createStaticMarketplaceApi()
const defaultMarketplaceServiceConfig = resolveMarketplaceServiceConfig()

type MarketplaceDetailInstallState =
  | { status: 'idle' }
  | { status: 'installing' }
  | { status: 'installed'; message: string }
  | { status: 'conflict'; message: string }
  | { status: 'skipped'; message: string }
  | { status: 'error'; message: string }

type MarketplaceDetailReportState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | MarketplaceReportResult

type DirectPublishState =
  | { status: 'idle' }
  | { status: 'publishing' }
  | MarketplacePublishDirectResult
  | { status: 'auth-required'; message: string }
  | { status: 'validation-error'; message: string }
  | { status: 'error'; message: string }

type DirectPublishPathPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'picker'; skills: DiscoveredSkill[] }

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

function validateDirectPublishFields(input: {
  skill: DiscoveredSkill | null
  marketplaceSlug: string
  version: string
  category: string
  tags?: string[]
  releaseNotes?: string
}): string[] {
  const errors: string[] = []
  if (!input.skill) errors.push('Choose or create a Skill before publishing.')
  if (input.skill && !input.skill.metadata.name.trim()) errors.push('Skill name is required.')
  if (input.skill && !input.skill.metadata.description.trim()) errors.push('Skill description is required.')
  if (input.skill && !input.skill.content.trim()) errors.push('Skill instructions are required.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.marketplaceSlug.trim())) {
    errors.push('Marketplace slug must use lowercase letters, numbers, and single hyphens.')
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.version.trim())) {
    errors.push('Version must be a valid SemVer version.')
  }
  if (!PRODUCT_MARKETPLACE_CATEGORIES.includes(input.category as typeof PRODUCT_MARKETPLACE_CATEGORIES[number])) {
    errors.push(`Category must be one of ${PRODUCT_MARKETPLACE_CATEGORIES.join(', ')}.`)
  }
  if (input.tags?.some((tag) => tag.trim() && !/^[a-z0-9][a-z0-9-]{0,39}$/.test(tag.trim()))) {
    errors.push('Tags must use lowercase letters, numbers, and hyphens.')
  }
  if (input.releaseNotes && input.releaseNotes.length > 5000) {
    errors.push('Release notes must be 5000 characters or fewer.')
  }
  return errors
}

function cleanTags(tags: string[] | undefined): string[] | undefined {
  const cleaned = tags?.map((tag) => tag.trim()).filter(Boolean)
  return cleaned && cleaned.length > 0 ? cleaned : undefined
}

function formatInstallCount(count: number): string {
  return new Intl.NumberFormat(undefined, { notation: count >= 10000 ? 'compact' : 'standard' }).format(count)
}

function installStateLabel(state: MarketplaceInstallState): string {
  switch (state) {
    case 'installed':
      return 'Installed'
    case 'update-available':
      return 'Update available'
    case 'modified-locally':
      return 'Modified locally'
    case 'unavailable':
      return 'Unavailable'
    case 'safety-blocked':
      return 'Safety blocked'
    case 'install':
      return 'Install'
  }
}

function installStateClassName(state: MarketplaceInstallState): string {
  switch (state) {
    case 'installed':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'update-available':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'modified-locally':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'unavailable':
    case 'safety-blocked':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'install':
      return 'border-border bg-background text-muted-foreground'
  }
}

function disabledActionLabel(state: MarketplaceInstallState): string {
  switch (state) {
    case 'installed':
      return 'Installed'
    case 'update-available':
    case 'modified-locally':
      return 'Update'
    case 'unavailable':
      return 'Unavailable'
    case 'safety-blocked':
      return 'Safety blocked'
    case 'install':
      return 'Install placeholder'
  }
}

function marketplaceInstallStateFromResult(
  result: MarketplaceInstallResult | { status: 'auth-required'; message: string } | { status: 'error'; message: string },
): MarketplaceDetailInstallState {
  switch (result.status) {
    case 'installed':
      return { status: 'installed', message: 'Installed into Local Skills.' }
    case 'conflict':
      return { status: 'conflict', message: 'A Local Skill with this slug already exists.' }
    case 'skipped':
      return { status: 'skipped', message: 'Marketplace install skipped. Existing Local Skill was kept.' }
    case 'install-complete-failed':
    case 'auth-required':
    case 'error':
      return { status: 'error', message: result.message }
  }
}

function getMarketplaceInstallActionLabel(
  detail: MarketplaceSkillDetail,
  installState: MarketplaceDetailInstallState,
  canInstall: boolean,
  currentUserId?: string | null,
): string {
  if (installState.status === 'installing') return 'Installing...'
  if (isOwnerLinked(detail, currentUserId) && detail.installState === 'modified-locally') return 'Publish or discard changes'
  if (!canInstall) {
    if (isMarketplaceUpdateAction(detail.installState)) return 'Sign in to update'
    return 'Sign in to install'
  }
  if (isOwnerLinked(detail, currentUserId) && detail.installState === 'update-available') return 'Sync latest'
  return disabledActionLabel(detail.installState)
}

function isMarketplaceUpdateAction(state: MarketplaceInstallState): boolean {
  return state === 'update-available' || state === 'modified-locally'
}

function isOwnerLinked(detail: MarketplaceSkillDetail, currentUserId?: string | null): boolean {
  return Boolean(currentUserId && currentUserId === detail.ownerId)
}

function marketplaceInstallAlertClassName(status: Exclude<MarketplaceDetailInstallState['status'], 'idle' | 'installing'>): string {
  switch (status) {
    case 'installed':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'conflict':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200'
    case 'skipped':
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
  }
}

function marketplaceReportAlertClassName(status: Exclude<MarketplaceDetailReportState['status'], 'idle' | 'submitting'>): string {
  switch (status) {
    case 'submitted':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'validation-error':
    case 'auth-required':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200'
    case 'error':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300'
  }
}

function marketplaceReportMessage(state: Exclude<MarketplaceDetailReportState, { status: 'idle' } | { status: 'submitting' }>): string {
  if (state.status === 'submitted') return 'Report submitted. Marketplace moderators will review this Skill.'
  return state.message
}

function directPublishMessage(state: DirectPublishState): string | null {
  switch (state.status) {
    case 'published':
      return `Published to Marketplace /${state.marketplaceSlug}`
    case 'slug-conflict':
    case 'auth-required':
    case 'validation-error':
    case 'error':
      return state.message
    case 'idle':
    case 'publishing':
      return null
  }
}

/** Read-only Marketplace browsing page with catalog filters and detail inspection. */
export function SkillMarketplacePage({
  api = defaultMarketplaceApi,
  workspaceId = '',
  currentUserId = null,
  serviceEnvironmentLabel = defaultMarketplaceServiceConfig.label,
}: {
  api?: MarketplaceApi
  workspaceId?: string
  currentUserId?: string | null
  serviceEnvironmentLabel?: string
}) {
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState('')
  const [tag, setTag] = React.useState('')
  const [catalogState, setCatalogState] = React.useState<MarketplaceCatalogState | { status: 'loading' }>({ status: 'loading' })
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null)
  const [detailState, setDetailState] = React.useState<MarketplaceDetailState | { status: 'idle' | 'loading' }>({ status: 'idle' })
  const [installStateBySlug, setInstallStateBySlug] = React.useState<Record<string, MarketplaceDetailInstallState>>({})
  const [reportStateBySlug, setReportStateBySlug] = React.useState<Record<string, MarketplaceDetailReportState>>({})
  const [publishDialogOpen, setPublishDialogOpen] = React.useState(false)

  const refreshCatalog = React.useCallback(() => {
    setCatalogState({ status: 'loading' })
    void loadMarketplaceCatalog(api, { search, category, tag }).then(setCatalogState)
  }, [api, category, search, tag])

  const refreshDetail = React.useCallback((slug: string) => {
    setDetailState({ status: 'loading' })
    void loadMarketplaceDetail(api, slug).then(setDetailState)
  }, [api])

  React.useEffect(() => {
    refreshCatalog()
  }, [refreshCatalog])

  React.useEffect(() => {
    if (!selectedSlug) {
      setDetailState({ status: 'idle' })
      return
    }
    refreshDetail(selectedSlug)
  }, [refreshDetail, selectedSlug])

  const installDetail = React.useCallback(async (detail: MarketplaceSkillDetail, conflictResolution?: MarketplaceInstallConflictResolution) => {
    if (!workspaceId) {
      setInstallStateBySlug((previous) => ({
        ...previous,
        [detail.slug]: { status: 'error', message: 'Open a workspace before installing or updating Marketplace Skills.' },
      }))
      return
    }

    setInstallStateBySlug((previous) => ({ ...previous, [detail.slug]: { status: 'installing' } }))
    const result = isMarketplaceUpdateAction(detail.installState)
      ? await updateMarketplaceSkillFromDetail({
        workspaceId,
        userId: currentUserId,
        detail,
        api,
        electronAPI: window.electronAPI,
      })
      : await installMarketplaceSkillFromDetail({
        workspaceId,
        userId: currentUserId,
        detail,
        api,
        electronAPI: window.electronAPI,
        conflictResolution,
      })

    setInstallStateBySlug((previous) => ({ ...previous, [detail.slug]: marketplaceInstallStateFromResult(result) }))
  }, [api, currentUserId, workspaceId])

  const reportDetail = React.useCallback(async (detail: MarketplaceSkillDetail, context: string) => {
    setReportStateBySlug((previous) => ({ ...previous, [detail.slug]: { status: 'submitting' } }))
    const result = await reportMarketplaceSkillFromDetail({
      userId: currentUserId,
      detail,
      context,
      api,
    })
    setReportStateBySlug((previous) => ({ ...previous, [detail.slug]: result }))
  }, [api, currentUserId])

  const finishDirectPublish = React.useCallback((marketplaceSlug: string) => {
    setPublishDialogOpen(false)
    setSelectedSlug(marketplaceSlug)
    refreshCatalog()
    refreshDetail(marketplaceSlug)
  }, [refreshCatalog, refreshDetail])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="border-b border-border px-5 py-4">
        <SkillMarketplacePageHeader
          currentUserId={currentUserId}
          serviceEnvironmentLabel={serviceEnvironmentLabel}
          onPublishClick={() => setPublishDialogOpen(true)}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-r border-border">
          <div className="space-y-3 border-b border-border p-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Marketplace Skills"
                className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm outline-none focus:border-foreground/30"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-foreground/30"
              >
                <option value="">All categories</option>
                {catalogState.status === 'ready' && catalogState.availableCategories.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
              <select
                value={tag}
                onChange={(event) => setTag(event.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-foreground/30"
              >
                <option value="">All tags</option>
                {catalogState.status === 'ready' && catalogState.availableTags.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {catalogState.status === 'loading' && (
              <p className="p-3 text-sm text-muted-foreground">Loading Marketplace Skills...</p>
            )}
            {catalogState.status === 'error' && (
              <MarketplaceError message={catalogState.message} onRetry={refreshCatalog} />
            )}
            {catalogState.status === 'ready' && catalogState.listings.length === 0 && (
              <MarketplaceEmptyState
                canPublish={Boolean(currentUserId)}
                onPublishClick={() => setPublishDialogOpen(true)}
              />
            )}
            {catalogState.status === 'ready' && catalogState.listings.map((listing) => (
              <MarketplaceListingCard
                key={listing.id}
                listing={listing}
                selected={listing.slug === selectedSlug}
                onSelect={() => setSelectedSlug(listing.slug)}
              />
            ))}
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto">
          {detailState.status === 'idle' && (
            <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
              <div className="max-w-sm">
                <Store className="mx-auto h-5 w-5" />
                <p className="mt-2 text-sm font-medium text-foreground">Select a Marketplace Skill</p>
                <p className="mt-1 text-xs">Open a listing to inspect its published SKILL.md, version history, release notes, required sources, and metadata.</p>
                <button
                  type="button"
                  disabled={!currentUserId}
                  onClick={() => setPublishDialogOpen(true)}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
                >
                  <UserCog className="h-3.5 w-3.5" />
                  {currentUserId ? 'Publish Skill' : 'Sign in to publish'}
                </button>
              </div>
            </div>
          )}
          {detailState.status === 'loading' && (
            <p className="p-5 text-sm text-muted-foreground">Loading Marketplace Skill detail...</p>
          )}
          {detailState.status === 'error' && (
            <div className="p-5">
              <MarketplaceError message={detailState.message} onRetry={() => selectedSlug && refreshDetail(selectedSlug)} />
            </div>
          )}
          {detailState.status === 'ready' && (
            <MarketplaceDetail
              detail={detailState.detail}
              installState={installStateBySlug[detailState.detail.slug] ?? { status: 'idle' }}
              onInstall={(conflictResolution) => installDetail(detailState.detail, conflictResolution)}
              reportState={reportStateBySlug[detailState.detail.slug] ?? { status: 'idle' }}
              onReport={(context) => reportDetail(detailState.detail, context)}
              canInstall={Boolean(currentUserId)}
              canReport={Boolean(currentUserId)}
              currentUserId={currentUserId}
            />
          )}
        </section>
      </div>

      <MarketplacePublishSkillDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        onPublished={finishDirectPublish}
      />
    </div>
  )
}

/** Header for Marketplace browsing, publish auth state, and selected service environment. */
export function SkillMarketplacePageHeader({
  currentUserId,
  serviceEnvironmentLabel,
  onPublishClick,
}: {
  currentUserId: string | null
  serviceEnvironmentLabel: string
  onPublishClick?: () => void
}) {
  const canPublish = Boolean(currentUserId)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="inline-flex items-center gap-2">
            <Store className="h-4 w-4" />
            <span>Marketplace</span>
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {serviceEnvironmentLabel}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Browse public Marketplace Skills anonymously. Sign in to install, update, publish, report, or manage owner actions.
        </p>
      </div>
      <button
        type="button"
        disabled={!canPublish}
        onClick={onPublishClick}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
      >
        <UserCog className="h-3.5 w-3.5" />
        {canPublish ? 'Publish Skill' : 'Sign in to publish'}
      </button>
    </div>
  )
}

/** Empty Marketplace catalog state with a publish-only entry point. */
export function MarketplaceEmptyState({
  canPublish,
  onPublishClick,
}: {
  canPublish: boolean
  onPublishClick: () => void
}) {
  return (
    <div className="p-3 text-sm text-muted-foreground">
      <p>No Marketplace Skills match these filters.</p>
      <button
        type="button"
        disabled={!canPublish}
        onClick={onPublishClick}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
      >
        <UserCog className="h-3.5 w-3.5" />
        {canPublish ? 'Publish Skill' : 'Sign in to publish'}
      </button>
    </div>
  )
}

/** Publish-only Marketplace dialog for creating, resolving, or uploading Skills without Local Skill installation. */
export function MarketplacePublishSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  currentUserId,
  onPublished,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  currentUserId: string | null
  onPublished: (marketplaceSlug: string) => void
}) {
  const [activeTab, setActiveTab] = React.useState<DirectPublishTab>('create')
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [selectedSkill, setSelectedSkill] = React.useState<DiscoveredSkill | null>(null)
  const [marketplaceSlug, setMarketplaceSlug] = React.useState('')
  const [version, setVersion] = React.useState('1.0.0')
  const [category, setCategory] = React.useState<string>(PRODUCT_MARKETPLACE_CATEGORIES[0])
  const [tags, setTags] = React.useState('')
  const [releaseNotes, setReleaseNotes] = React.useState('')
  const [publishState, setPublishState] = React.useState<DirectPublishState>({ status: 'idle' })
  const [uploadPhase, setUploadPhase] = React.useState<DirectPublishPathPhase>({ kind: 'idle' })
  const [remoteInput, setRemoteInput] = React.useState('')
  const [remotePhase, setRemotePhase] = React.useState<DirectPublishPathPhase>({ kind: 'idle' })
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const reset = React.useCallback(() => {
    setActiveTab('create')
    setName('')
    setDescription('')
    setContent('')
    setSelectedSkill(null)
    setMarketplaceSlug('')
    setVersion('1.0.0')
    setCategory(PRODUCT_MARKETPLACE_CATEGORIES[0])
    setTags('')
    setReleaseNotes('')
    setPublishState({ status: 'idle' })
    setUploadPhase({ kind: 'idle' })
    setRemoteInput('')
    setRemotePhase({ kind: 'idle' })
  }, [])

  const closeDialog = React.useCallback(() => {
    reset()
    onOpenChange(false)
  }, [onOpenChange, reset])

  const chooseSkill = React.useCallback((skill: DiscoveredSkill) => {
    setSelectedSkill(skill)
    setMarketplaceSlug((current) => current.trim() || skill.slug)
    setPublishState({ status: 'idle' })
  }, [])

  const switchPublishTab = React.useCallback((value: string) => {
    if (!MARKETPLACE_DIRECT_PUBLISH_TABS.includes(value as DirectPublishTab)) return
    setActiveTab(value as DirectPublishTab)
    setSelectedSkill(null)
    setPublishState({ status: 'idle' })
  }, [])

  const getSkillForPublish = React.useCallback((): DiscoveredSkill | null => {
    if (activeTab !== 'create') return selectedSkill
    const slug = deriveSkillSlug(name)
    return {
      slug,
      metadata: {
        name: name.trim(),
        description: description.trim(),
      },
      content: content.trim(),
      sourcePath: 'marketplace-create',
    }
  }, [activeTab, content, description, name, selectedSkill])

  React.useEffect(() => {
    if (activeTab !== 'create') return
    setMarketplaceSlug(deriveSkillSlug(name))
  }, [activeTab, name])

  const submitPublish = React.useCallback(async () => {
    const skill = getSkillForPublish()
    setPublishState({ status: 'publishing' })
    const result = await publishDirectMarketplaceSkill({
      workspaceId,
      userId: currentUserId,
      skill: skill ?? {
        slug: '',
        metadata: { name: '', description: '' },
        content: '',
        sourcePath: '',
      },
      marketplaceSlug,
      version,
      category,
      tags: tags.split(','),
      releaseNotes,
      electronAPI: window.electronAPI,
    })
    setPublishState(result)
    if (result.status === 'published') {
      onPublished(result.marketplaceSlug)
      reset()
    }
  }, [category, currentUserId, getSkillForPublish, marketplaceSlug, onPublished, releaseNotes, reset, tags, version, workspaceId])

  const processZipFile = React.useCallback(async (file: File) => {
    const filePath = window.electronAPI.getFilePath?.(file)
    if (!filePath) {
      setUploadPhase({ kind: 'error', message: 'Could not determine file path.' })
      return
    }
    setUploadPhase({ kind: 'loading' })
    try {
      const skills = await window.electronAPI.extractSkillsFromZip(filePath)
      if (skills.length === 0) {
        setUploadPhase({ kind: 'error', message: 'No skills found in this zip.' })
        return
      }
      if (skills.length === 1) {
        chooseSkill(skills[0])
        setUploadPhase({ kind: 'idle' })
        return
      }
      setUploadPhase({ kind: 'picker', skills })
    } catch (error) {
      setUploadPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [chooseSkill])

  const resolveRemote = React.useCallback(async () => {
    const input = remoteInput.trim()
    if (!input) return
    setRemotePhase({ kind: 'loading' })
    try {
      const resolved = await window.electronAPI.resolveRemoteSkills(input)
      const phase = getRemoteResolvePhase(resolved)
      if (phase.kind === 'single') {
        chooseSkill(phase.skill)
        setRemotePhase({ kind: 'idle' })
        return
      }
      if (phase.kind === 'picker') {
        setRemotePhase({ kind: 'picker', skills: phase.skills })
        return
      }
      setRemotePhase({ kind: 'error', message: phase.message })
    } catch (error) {
      setRemotePhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [chooseSkill, remoteInput])

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void processZipFile(file)
    event.target.value = ''
  }

  const publishDisabled = publishState.status === 'publishing' || !currentUserId
  const publishMessage = directPublishMessage(publishState)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) reset()
      onOpenChange(isOpen)
    }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish Skill</DialogTitle>
          <DialogDescription>
            Publish a new Marketplace Skill without installing it into Local Skills.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={switchPublishTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="create" className="gap-1.5">
              <PencilLine className="h-3.5 w-3.5" />
              Create
            </TabsTrigger>
            <TabsTrigger value="remote" className="gap-1.5">
              <Globe2 className="h-3.5 w-3.5" />
              Remote
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5">
              <FileArchive className="h-3.5 w-3.5" />
              Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-4 space-y-3">
            <label className="grid gap-1 text-xs font-medium">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Code Reviewer" />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Description
              <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Reviews code for correctness" />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Instructions
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-28 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-foreground/30"
                placeholder="Write the behavior, workflow, and constraints this skill should add."
              />
            </label>
          </TabsContent>

          <TabsContent value="remote" className="mt-4 space-y-3">
            {remotePhase.kind === 'picker' ? (
              <SkillPicker
                skills={remotePhase.skills}
                onConfirm={(skills) => {
                  if (skills[0]) chooseSkill(skills[0])
                  setRemotePhase({ kind: 'idle' })
                }}
                onCancel={() => setRemotePhase({ kind: 'idle' })}
              />
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    value={remoteInput}
                    onChange={(event) => setRemoteInput(event.target.value)}
                    placeholder="owner/repo  or  https://github.com/owner/repo"
                    onKeyDown={(event) => { if (event.key === 'Enter') void resolveRemote() }}
                  />
                  <Button type="button" onClick={() => void resolveRemote()} disabled={!remoteInput.trim() || remotePhase.kind === 'loading'}>
                    {remotePhase.kind === 'loading' ? 'Resolving...' : 'Resolve'}
                  </Button>
                </div>
                {remotePhase.kind === 'error' && <p className="text-xs text-destructive">{remotePhase.message}</p>}
              </>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-4 space-y-3">
            {uploadPhase.kind === 'picker' ? (
              <SkillPicker
                skills={uploadPhase.skills}
                onConfirm={(skills) => {
                  if (skills[0]) chooseSkill(skills[0])
                  setUploadPhase({ kind: 'idle' })
                }}
                onCancel={() => setUploadPhase({ kind: 'idle' })}
              />
            ) : (
              <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-foreground/15 bg-foreground/[0.02] p-4 text-center">
                <input ref={fileInputRef} type="file" accept=".zip,application/zip" className="hidden" onChange={handleFileInputChange} />
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadPhase.kind === 'loading'}>
                  <FileArchive className="h-4 w-4" />
                  {uploadPhase.kind === 'loading' ? 'Reading zip...' : 'Choose zip'}
                </Button>
                {uploadPhase.kind === 'error' && <p className="text-xs text-destructive">{uploadPhase.message}</p>}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {activeTab !== 'create' && selectedSkill && (
          <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <span className="font-medium">{selectedSkill.metadata.name}</span>
            <span className="ml-2 text-muted-foreground">{selectedSkill.slug}</span>
          </div>
        )}

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Marketplace slug
            <Input value={marketplaceSlug} onChange={(event) => setMarketplaceSlug(event.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium">
              Version
              <Input value={version} onChange={(event) => setVersion(event.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Category
              <select className="h-9 rounded-md border border-border bg-background px-2 text-sm font-normal" value={category} onChange={(event) => setCategory(event.target.value)}>
                {PRODUCT_MARKETPLACE_CATEGORIES.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium">
            Tags
            <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="review, ci" />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Release notes
            <textarea
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
              className="min-h-16 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal outline-none focus:border-foreground/30"
            />
          </label>
        </div>

        {publishMessage && (
          <p className={`rounded-md border p-3 text-sm ${
            publishState.status === 'published'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          }`}>
            {publishMessage}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
          <Button type="button" onClick={() => void submitPublish()} disabled={publishDisabled}>
            {publishState.status === 'publishing' ? 'Publishing...' : currentUserId ? 'Publish Skill' : 'Sign in to publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Marketplace status block shown on Local Skill detail after publish/link. */
export function LocalSkillMarketplaceStatus({
  metadata,
  publishState = { status: 'idle' },
}: {
  metadata?: MarketplaceOriginMetadata | null
  publishState?: MarketplacePublishResult | { status: 'idle' | 'publishing' }
}) {
  if (publishState.status === 'publishing') {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
        <span className="font-medium">Publishing to Marketplace...</span>
      </div>
    )
  }

  if (publishState.status === 'published') {
    return (
      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
        <span className="font-medium">Published to Marketplace</span>
        <span className="ml-2">/{publishState.marketplaceSlug}</span>
      </div>
    )
  }

  if (publishState.status === 'auth-required' || publishState.status === 'error' || publishState.status === 'slug-conflict') {
    return (
      <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
        {publishState.message}
      </div>
    )
  }

  if (!metadata) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        Not published to Marketplace.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Marketplace linked</span>
        <span className="text-muted-foreground">/{metadata.marketplaceSlug}</span>
        <span className="text-muted-foreground">v{metadata.installedVersion}</span>
        {metadata.modified && (
          <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
            Unpublished changes
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        Marketplace ID {metadata.marketplaceId}
      </div>
    </div>
  )
}

/** Read-only Marketplace listing card used in catalog results. */
export function MarketplaceListingCard({
  listing,
  selected,
  onSelect,
}: {
  listing: MarketplaceSkillListing
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`mb-2 flex w-full min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-foreground/40 bg-muted/60' : 'border-border hover:bg-muted/40'
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
          {listing.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{listing.name}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">{listing.description}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>{listing.owner}</span>
        <span>v{listing.latestVersion}</span>
        <span>{formatInstallCount(listing.installCount)} installs</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Pill>{listing.category}</Pill>
        {listing.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${installStateClassName(listing.installState)}`}>
          {installStateLabel(listing.installState)}
        </span>
      </div>
    </button>
  )
}

/** Read-only Marketplace detail view for published Skill metadata and SKILL.md content. */
export function MarketplaceDetail({
  detail,
  installState = { status: 'idle' },
  reportState = { status: 'idle' },
  onInstall,
  onReport,
  canInstall = true,
  canReport = true,
  currentUserId = null,
}: {
  detail: MarketplaceSkillDetail
  installState?: MarketplaceDetailInstallState
  reportState?: MarketplaceDetailReportState
  onInstall?: (conflictResolution?: MarketplaceInstallConflictResolution) => void
  onReport?: (context: string) => void
  canInstall?: boolean
  canReport?: boolean
  currentUserId?: string | null
}) {
  const [reportOpen, setReportOpen] = React.useState(false)
  const [reportContext, setReportContext] = React.useState('')
  const isBlocked = detail.installState === 'safety-blocked' || detail.installState === 'unavailable'
  const isInstalling = installState.status === 'installing'
  const isReportSubmitting = reportState.status === 'submitting'
  const ownerLinked = isOwnerLinked(detail, currentUserId)
  const hasUnpublishedChanges = ownerLinked && detail.installState === 'modified-locally'
  const canRunPrimaryAction = !isInstalling && !hasUnpublishedChanges
  const actionLabel = getMarketplaceInstallActionLabel(detail, installState, canInstall, currentUserId)
  const reportLabel = canReport ? 'Report' : 'Sign in to report'

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
            {detail.icon}
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{detail.name}</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill>{detail.owner}</Pill>
              <Pill>{detail.category}</Pill>
              {detail.tags.map((tag) => <Pill key={tag}>{tag}</Pill>)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isBlocked ? (
            <DisabledAction icon={<Download className="h-3.5 w-3.5" />} label={disabledActionLabel(detail.installState)} />
          ) : (
            <button
              type="button"
              disabled={!canRunPrimaryAction}
              onClick={() => onInstall?.()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              {actionLabel}
            </button>
          )}
          <button
            type="button"
            disabled={!canReport || isReportSubmitting}
            onClick={() => setReportOpen((open) => !open)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
          >
            <Flag className="h-3.5 w-3.5" />
            {isReportSubmitting ? 'Submitting...' : reportLabel}
          </button>
          <DisabledAction icon={<UserCog className="h-3.5 w-3.5" />} label="Owner actions" />
        </div>
      </div>

      {(reportOpen || reportState.status !== 'idle') && (
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <label className="text-xs font-medium" htmlFor={`marketplace-report-${detail.slug}`}>
            Report details
          </label>
          <textarea
            id={`marketplace-report-${detail.slug}`}
            value={reportContext}
            onChange={(event) => setReportContext(event.target.value)}
            disabled={!canReport || isReportSubmitting}
            placeholder="Describe the abusive, unsafe, or policy-violating behavior."
            className="mt-2 min-h-24 w-full resize-y rounded-md border border-border bg-background p-2 text-sm outline-none focus:border-foreground/30 disabled:bg-muted"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Reports include this Marketplace Skill identity and your account.</p>
            <button
              type="button"
              disabled={!canReport || isReportSubmitting}
              onClick={() => onReport?.(reportContext)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:bg-muted disabled:text-muted-foreground"
            >
              <Flag className="h-3.5 w-3.5" />
              Submit report
            </button>
          </div>
        </div>
      )}

      {reportState.status !== 'idle' && reportState.status !== 'submitting' && (
        <div className={`rounded-md border p-3 text-sm ${marketplaceReportAlertClassName(reportState.status)}`}>
          {marketplaceReportMessage(reportState)}
        </div>
      )}

      {installState.status !== 'idle' && installState.status !== 'installing' && (
        <div className={`rounded-md border p-3 text-sm ${marketplaceInstallAlertClassName(installState.status)}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span>{installState.message}</span>
            {installState.status === 'conflict' && (
              <>
                <button type="button" className="rounded-md border border-current px-2 py-1 text-xs font-medium" onClick={() => onInstall?.('overwrite')}>
                  Overwrite
                </button>
                <button type="button" className="rounded-md border border-current px-2 py-1 text-xs font-medium" onClick={() => onInstall?.('skip')}>
                  Skip
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {isBlocked && (
        <div className="flex gap-2 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{installStateLabel(detail.installState)} prevents Marketplace install and update distribution. Existing Local Skills remain separate.</span>
        </div>
      )}

      {detail.installState === 'modified-locally' && (
        <div className="flex gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {hasUnpublishedChanges ? (
            <span>Unpublished changes cannot sync latest until they are published or discarded.</span>
          ) : (
            <span>Updating will overwrite local changes.</span>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <section>
          <SectionTitle>Published SKILL.md</SectionTitle>
          <pre className="mt-2 max-h-[520px] overflow-auto rounded-md border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
            {detail.skillMarkdown}
          </pre>
        </section>

        <aside className="space-y-5">
          <section>
            <SectionTitle>Listing Metadata</SectionTitle>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Marketplace ID</dt>
              <dd className="truncate">{detail.metadata.marketplaceId}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd>{detail.metadata.marketplaceSlug}</dd>
              <dt className="text-muted-foreground">Latest version</dt>
              <dd>v{detail.latestVersion}</dd>
              <dt className="text-muted-foreground">Installs</dt>
              <dd>{formatInstallCount(detail.installCount)}</dd>
              <dt className="text-muted-foreground">State</dt>
              <dd>{installStateLabel(detail.installState)}</dd>
            </dl>
          </section>

          <section>
            <SectionTitle>Required Sources</SectionTitle>
            <ul className="mt-2 space-y-1 text-xs">
              {detail.requiredSources.map((source) => (
                <li key={source} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{source}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Version History</SectionTitle>
            <ol className="mt-2 space-y-3">
              {detail.versions.map((version) => (
                <li key={version.version} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium">v{version.version}</span>
                    <span className="text-muted-foreground">{version.publishedAt}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{version.releaseNotes}</p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function toBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: { from: (bytes: Uint8Array) => { toString: (encoding: string) => string } } }).Buffer
  if (maybeBuffer) return maybeBuffer.from(bytes).toString('base64')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Marketplace-scoped outage display with retry behavior. */
export function MarketplaceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Marketplace is unavailable</p>
          <p className="mt-1 text-xs">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-medium"
          >
            Retry Marketplace
          </button>
        </div>
      </div>
    </div>
  )
}

function DisabledAction({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-muted px-3 text-xs font-medium text-muted-foreground"
    >
      {icon}
      {label}
    </button>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>
}
