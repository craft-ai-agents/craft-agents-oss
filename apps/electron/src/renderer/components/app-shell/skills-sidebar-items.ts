import { Store, Zap } from 'lucide-react'
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
 * Builds the flat top-level sidebar entries for local skills and the skill marketplace.
 */
export function createSkillsSidebarItems({
  skillsCount,
  isLocalSkillsNav,
  isSkillMarketplaceNav,
  onLocalSkillsClick,
  onSkillMarketplaceClick,
  onAddSkill,
  t,
}: CreateSkillsSidebarItemsInput): SidebarItem[] {
  return [
    {
      id: LOCAL_SKILLS_NAV_ID,
      title: t('sidebar.skills'),
      label: String(skillsCount),
      icon: Zap,
      variant: isLocalSkillsNav ? 'default' : 'ghost',
      onClick: onLocalSkillsClick,
      contextMenu: {
        type: 'skills',
        onAddSkill,
      },
    },
    {
      id: SKILL_MARKETPLACE_NAV_ID,
      title: t('sidebar.marketplace'),
      icon: Store,
      variant: isSkillMarketplaceNav ? 'default' : 'ghost',
      onClick: onSkillMarketplaceClick,
    },
  ]
}
