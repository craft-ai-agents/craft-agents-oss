import { describe, expect, test } from 'bun:test'
import {
  createSkillsSidebarItems,
  SKILL_MARKETPLACE_NAV_ID,
} from '../skills-sidebar-items'

describe('createSkillsSidebarItems', () => {
  test('builds a single merged skills sidebar item', () => {
    const addSkill = () => {}
    const openSkills = () => {}

    const items = createSkillsSidebarItems({
      skillsCount: 3,
      isLocalSkillsNav: true,
      isSkillMarketplaceNav: false,
      onLocalSkillsClick: () => {},
      onSkillMarketplaceClick: openSkills,
      onAddSkill: addSkill,
      t: key => key,
    })

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe(SKILL_MARKETPLACE_NAV_ID)

    const item = items[0]
    if ('type' in item) throw new Error('Expected item to be a link item')

    expect(item).toMatchObject({
      title: 'sidebar.skills',
      label: '3',
      variant: 'default',
      onClick: openSkills,
      contextMenu: {
        type: 'skills',
        onAddSkill: addSkill,
      },
    })
    expect(item).not.toHaveProperty('expandable')
    expect(item).not.toHaveProperty('items')
  })

  test('highlights item when either local skills or marketplace nav is active', () => {
    const items = createSkillsSidebarItems({
      skillsCount: 0,
      isLocalSkillsNav: false,
      isSkillMarketplaceNav: true,
      onLocalSkillsClick: () => {},
      onSkillMarketplaceClick: () => {},
      onAddSkill: () => {},
      t: key => key,
    })

    expect(items).toHaveLength(1)
    expect(items[0].variant).toBe('default')
  })

  test('uses ghost variant when neither nav is active', () => {
    const items = createSkillsSidebarItems({
      skillsCount: 0,
      isLocalSkillsNav: false,
      isSkillMarketplaceNav: false,
      onLocalSkillsClick: () => {},
      onSkillMarketplaceClick: () => {},
      onAddSkill: () => {},
      t: key => key,
    })

    expect(items[0].variant).toBe('ghost')
  })
})
