/**
 * Skill Marketplace — shared types and interfaces.
 * Kept here so components can import types without pulling in heavy UI deps.
 */

import type {
  MarketplaceOriginMetadata,
  MarketplaceInstallIntent,
  MarketplaceSkillInstallInput,
  MarketplaceSkillUpdateInput,
  MarketplaceDirectSkillPublishInput,
  MarketplacePublishDirectResult,
} from '@craft-agent/shared/skills'

export type MarketplaceInstallState =
  | 'install'
  | 'installed'
  | 'update-available'
  | 'modified-locally'
  | 'unavailable'
  | 'safety-blocked'

export const PRODUCT_MARKETPLACE_CATEGORIES = ['Documentation', 'Product', 'Quality', 'Security'] as const
export const MARKETPLACE_DIRECT_PUBLISH_TABS = ['create', 'remote', 'upload'] as const

export interface MarketplaceSkillListing {
  id: string
  slug: string
  ownerId: string
  basedOn?: MarketplaceOriginMetadata['basedOn']
  icon: string
  iconBg?: string
  name: string
  description: string
  owner: string
  category: string
  tags: string[]
  latestVersion: string
  installCount: number
  installState: MarketplaceInstallState
  publishedAt?: string
}

export interface MarketplaceSkillVersion {
  version: string
  publishedAt: string
  releaseNotes: string
}

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

export interface MarketplaceCatalogFilters {
  search?: string
  category?: string
}

export interface MarketplaceApi {
  listSkills: () => Promise<MarketplaceSkillListing[]>
  getSkillDetail: (slug: string) => Promise<MarketplaceSkillDetail>
  reportSkill: (input: MarketplaceSkillReportInput) => Promise<MarketplaceReportResult>
  unpublishSkill: (input: MarketplaceOwnerUnpublishInput) => Promise<MarketplaceOwnerUnpublishResult>
  createInstallIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordInstallComplete: (intentId: string) => Promise<void>
  createUpdateIntent: (detail: MarketplaceSkillDetail, userId: string) => Promise<MarketplaceInstallIntent>
  recordUpdateComplete: (intentId: string) => Promise<void>
}

export interface MarketplacePublishApi {
  publishSkill: (input: { userId: string; skillSlug: string }) => Promise<MarketplacePublishResult>
}

export type MarketplacePublishResult =
  | { status: 'published'; marketplaceSlug: string }
  | { status: 'slug-conflict'; marketplaceSlug: string; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

export interface MarketplaceSkillReportInput {
  userId: string
  marketplaceId: string
  marketplaceSlug: string
  context: string
}

export interface MarketplaceOwnerUnpublishInput {
  userId: string
  marketplaceId: string
  marketplaceSlug: string
}

export type MarketplaceReportResult =
  | { status: 'submitted'; reportId: string }
  | { status: 'validation-error'; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'error'; message: string }

export type MarketplaceOwnerUnpublishResult =
  | { status: 'unpublished'; marketplaceSlug: string; message: string }
  | { status: 'auth-required'; message: string }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string }

export interface MarketplaceInstallElectronApi {
  installMarketplaceSkill(workspaceId: string, input: MarketplaceSkillInstallInput): Promise<import('@craft-agent/shared/skills').MarketplaceInstallResult>
}

export interface MarketplaceUpdateElectronApi {
  updateMarketplaceSkill(workspaceId: string, input: MarketplaceSkillUpdateInput): Promise<import('@craft-agent/shared/skills').MarketplaceInstallResult>
}

export interface MarketplaceDirectPublishElectronApi {
  publishDirectMarketplaceSkill(workspaceId: string, input: MarketplaceDirectSkillPublishInput): Promise<MarketplacePublishDirectResult>
}

export interface StaticMarketplaceApiOptions {
  listings?: MarketplaceSkillListing[]
  details?: Record<string, MarketplaceSkillDetail>
  listError?: string
  detailError?: string
}

// Re-export for use inside this package
export type { MarketplaceInstallIntent } from '@craft-agent/shared/skills'
