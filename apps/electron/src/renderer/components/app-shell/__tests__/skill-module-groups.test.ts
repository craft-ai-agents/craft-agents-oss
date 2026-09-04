import { describe, expect, it } from 'bun:test'
import type { LoadedSkill } from '../../../../shared/types'
import { getSkillModuleId, groupSkillsByModule } from '../skill-module-groups'

function skill(slug: string, module?: string): LoadedSkill {
  return {
    slug,
    metadata: { name: slug, description: `${slug} description`, module },
    content: '',
    path: `/skills/${slug}`,
    source: 'workspace',
  }
}

describe('skill module grouping', () => {
  it('returns no groups for an empty workspace', () => {
    expect(groupSkillsByModule([])).toEqual([])
  })

  it('orders populated modules according to the product interface', () => {
    const groups = groupSkillsByModule([
      skill('diagnosis', 'design-diagnostics'),
      skill('render', 'form-workbench'),
      skill('insight', 'insight-proposal'),
      skill('lab', 'design-lab'),
    ])

    expect(groups.map(group => group.key)).toEqual([
      'insight-proposal',
      'form-workbench',
      'design-lab',
      'design-diagnostics',
    ])
  })

  it('preserves the incoming order inside a module', () => {
    const groups = groupSkillsByModule([
      skill('first', 'form-workbench'),
      skill('second', 'form-workbench'),
    ])

    expect(groups[0]?.items.map(item => item.slug)).toEqual(['first', 'second'])
  })

  it('places missing and unknown module metadata in general', () => {
    const missing = skill('missing')
    const unknown = skill('third-party', 'external-module')

    expect(getSkillModuleId(missing)).toBe('general')
    expect(getSkillModuleId(unknown)).toBe('general')
    expect(groupSkillsByModule([missing, unknown])[0]?.items).toHaveLength(2)
  })
})
