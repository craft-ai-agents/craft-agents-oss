import type { CopawMarketSkill } from '@craft-agent/shared/skills'
import type { MarketplaceSkillListing, MarketplaceInstallState } from './types'

export const SKILL_ICON_COLORS = [
  'bg-blue-500', 'bg-indigo-600', 'bg-violet-600',
  'bg-emerald-500', 'bg-teal-600',
  'bg-sky-500', 'bg-amber-500', 'bg-rose-500',
]

export function skillIconBg(name: string): string {
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return SKILL_ICON_COLORS[hash % SKILL_ICON_COLORS.length]
}

export function mapCopawSkillToListing(
  skill: CopawMarketSkill,
  localSlugs: Set<string>,
): MarketplaceSkillListing {
  const category = skill.tag === 'B' ? 'DevOps' : '公共'
  const iconBg = skillIconBg(skill.name)
  const displayName = skill.chineseName?.trim() || skill.name
  const installState: MarketplaceInstallState = localSlugs.has(skill.name) ? 'installed' : 'install'

  return {
    id: skill.name,
    slug: skill.name,
    ownerId: skill.employeeId,
    icon: skill.name.charAt(0).toUpperCase(),
    iconBg,
    name: displayName,
    description: skill.description,
    owner: skill.userName,
    category,
    tags: [],
    latestVersion: skill.version ?? '1.0.0',
    installCount: skill.hot,
    installState,
    publishedAt: skill.createdAt,
  }
}

export const CATEGORIES = ['全部', 'DevOps', '公共'] as const
export type Category = typeof CATEGORIES[number]
