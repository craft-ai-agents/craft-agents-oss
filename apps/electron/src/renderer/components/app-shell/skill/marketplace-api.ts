import { strToU8, zipSync } from 'fflate'
import type { StaticMarketplaceApiOptions, MarketplaceApi } from './types'
import { MOCK_SKILLS } from './mock-data'

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

export function createStaticMarketplaceApi(options?: StaticMarketplaceApiOptions): MarketplaceApi {
  const listings = options?.listings ?? MOCK_SKILLS
  const unpublished = new Set<string>()

  return {
    async listSkills() {
      if (options?.listError) throw new Error(options.listError)
      return listings.filter((l) => !unpublished.has(l.slug))
    },
    async getSkillDetail(slug) {
      if (options?.detailError) throw new Error(options.detailError)
      const l = listings.find((x) => x.slug === slug)
      if (!l) throw new Error('Skill not found.')
      return {
        ...l,
        skillMarkdown: `# ${l.name}\n\n${l.description}`,
        requiredSources: [],
        versions: [{ version: l.latestVersion, publishedAt: new Date().toISOString(), releaseNotes: '' }],
        metadata: {
          marketplaceId: l.id,
          marketplaceSlug: l.slug,
          publishedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }
    },
    async reportSkill(input) {
      return { status: 'submitted', reportId: `report_${input.marketplaceId}` }
    },
    async unpublishSkill(input) {
      unpublished.add(input.marketplaceSlug)
      return { status: 'unpublished', marketplaceSlug: input.marketplaceSlug, message: '已从市场下架。' }
    },
    async createInstallIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return { intentId: `intent_${detail.id}`, downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`, expectedSha256: await sha256Hex(bytes) }
    },
    async recordInstallComplete() {},
    async createUpdateIntent(detail) {
      const bytes = zipSync({ 'SKILL.md': strToU8(detail.skillMarkdown) })
      return { intentId: `update_intent_${detail.id}`, downloadUrl: `data:application/zip;base64,${toBase64(bytes)}`, expectedSha256: await sha256Hex(bytes) }
    },
    async recordUpdateComplete() {},
  }
}

export const defaultMarketplaceApi = createStaticMarketplaceApi()
