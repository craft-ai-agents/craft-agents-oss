import { describe, expect, test } from 'bun:test'
import {
  createSkillsSidebarItems,
  LOCAL_SKILLS_NAV_ID,
  SKILL_MARKETPLACE_NAV_ID,
} from '../skills-sidebar-items'

describe('createSkillsSidebarItems', () => {
  test('builds local skills and marketplace as flat top-level sidebar items', () => {
    const addSkill = () => {}
    const openLocalSkills = () => {}
    const openMarketplace = () => {}

    const items = createSkillsSidebarItems({
      skillsCount: 3,
      isLocalSkillsNav: true,
      isSkillMarketplaceNav: false,
      onLocalSkillsClick: openLocalSkills,
      onSkillMarketplaceClick: openMarketplace,
      onAddSkill: addSkill,
      t: key => key,
    })

    expect(items).toHaveLength(2)
    expect(items.map(item => item.id)).toEqual([LOCAL_SKILLS_NAV_ID, SKILL_MARKETPLACE_NAV_ID])

    const [localSkills, marketplace] = items
    if ('type' in localSkills) throw new Error('Expected local skills to be a link item')
    if ('type' in marketplace) throw new Error('Expected marketplace to be a link item')

    expect(localSkills).toMatchObject({
      title: 'sidebar.skills',
      label: '3',
      variant: 'default',
      onClick: openLocalSkills,
      contextMenu: {
        type: 'skills',
        onAddSkill: addSkill,
      },
    })
    expect(localSkills).not.toHaveProperty('expandable')
    expect(localSkills).not.toHaveProperty('items')

    expect(marketplace).toMatchObject({
      title: 'sidebar.marketplace',
      variant: 'ghost',
      onClick: openMarketplace,
    })
    expect(marketplace).not.toHaveProperty('label')
    expect(marketplace).not.toHaveProperty('expandable')
    expect(marketplace).not.toHaveProperty('items')
  })

  test('highlights marketplace independently from local skills', () => {
    const items = createSkillsSidebarItems({
      skillsCount: 0,
      isLocalSkillsNav: false,
      isSkillMarketplaceNav: true,
      onLocalSkillsClick: () => {},
      onSkillMarketplaceClick: () => {},
      onAddSkill: () => {},
      t: key => key,
    })

    const [localSkills, marketplace] = items
    if ('type' in localSkills) throw new Error('Expected local skills to be a link item')
    if ('type' in marketplace) throw new Error('Expected marketplace to be a link item')

    expect(localSkills.variant).toBe('ghost')
    expect(marketplace.variant).toBe('default')
  })
})
