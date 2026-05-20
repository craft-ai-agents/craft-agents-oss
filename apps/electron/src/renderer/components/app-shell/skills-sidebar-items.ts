import { Zap } from 'lucide-react'
import type { SidebarItem } from './LeftSidebar'

/** Sidebar item ID for the local skills entry. */
export const LOCAL_SKILLS_NAV_ID = 'nav:local-skills'

/** Sidebar item ID for the skill marketplace entry. */
export const SKILL_MARKETPLACE_NAV_ID = 'nav:marketplace'

interface CreateSkillsSidebarItemsInput {
  skillsCount: number
  isLocalSkillsNav: boolean
  isSkillMarketplaceNav: boolean
  onLocalSkillsClick: () => void
  onSkillMarketplaceClick: () => void
  onAddSkill: () => void
  t: (key: 'sidebar.skills' | 'sidebar.marketplace') => string
}

/**
 * 合并后的单一"技能"入口，内部通过 tab 切换本地/市场。
 */
export function createSkillsSidebarItems({
  skillsCount,
  isLocalSkillsNav,
  isSkillMarketplaceNav,
  onSkillMarketplaceClick,
  onAddSkill,
  t,
}: CreateSkillsSidebarItemsInput): SidebarItem[] {
  const isActive = isLocalSkillsNav || isSkillMarketplaceNav
  return [
    {
      id: SKILL_MARKETPLACE_NAV_ID,
      title: t('sidebar.skills'),
      label: String(skillsCount),
      icon: Zap,
      variant: isActive ? 'default' : 'ghost',
      onClick: onSkillMarketplaceClick,
      contextMenu: {
        type: 'skills',
        onAddSkill,
      },
    },
  ]
}
