import { describe, expect, it } from 'bun:test'
import { buildEditPopoverPlaceholder, resolveEditPopoverBasePlaceholder } from '../edit-popover-placeholder'

describe('edit popover placeholder i18n', () => {
  it('prefers overridePlaceholderKey translation over literal override placeholder', () => {
    const t = (key: string) => ({
      'common:skills.addSkillPlaceholder': '你希望我学会做什么？',
      'common:editPopover.basePlaceholder': '描述一下你想修改什么...',
    } as Record<string, string>)[key] || key

    const result = resolveEditPopoverBasePlaceholder(t, {
      overridePlaceholder: 'What should I learn to do?',
      overridePlaceholderKey: 'common:skills.addSkillPlaceholder',
    })

    expect(result).toBe('你希望我学会做什么？')
  })

  it('formats placeholder with localized example template', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      const dict = {
        'common:sources.addApi.placeholder': '你想连接哪个 API？',
      } as Record<string, string>

      if (key === 'common:editPopover.placeholderWithExample') {
        return `${String(options?.placeholder)}，例如：\"${String(options?.example)}\"`
      }

      return dict[key] || key
    }

    const result = buildEditPopoverPlaceholder(t, {
      overridePlaceholderKey: 'common:sources.addApi.placeholder',
      example: '连接 OpenAI API',
    })

    expect(result).toBe('你想连接哪个 API？，例如："连接 OpenAI API"')
  })

  it('uses exampleKey translation when provided', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      const dict = {
        'common:skills.addSkillPlaceholder': '你希望我学会做什么？',
        'common:editPopover.examples.addSkill': '按我们的代码标准审查 PR',
      } as Record<string, string>

      if (key === 'common:editPopover.placeholderWithExample') {
        return `${String(options?.placeholder)}，例如：\"${String(options?.example)}\"`
      }

      return dict[key] || key
    }

    const result = buildEditPopoverPlaceholder(t, {
      overridePlaceholderKey: 'common:skills.addSkillPlaceholder',
      example: t('common:editPopover.examples.addSkill'),
    })

    expect(result).toBe('你希望我学会做什么？，例如："按我们的代码标准审查 PR"')
  })
})
