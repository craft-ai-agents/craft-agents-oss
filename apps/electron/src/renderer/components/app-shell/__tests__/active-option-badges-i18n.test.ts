import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getActiveOptionBadgesLabels } from '../active-option-badges-labels'

describe('active option badges labels', () => {
  it('returns localized ultrathink label', () => {
    const t: TFunction = ((key: string) => ({
      'common:slashMenu.ultrathink.label': '深度思考',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getActiveOptionBadgesLabels(t)
    expect(labels.ultrathink).toBe('深度思考')
  })

  it('returns localized permission mode labels', () => {
    const t: TFunction = ((key: string) => ({
      'settings:workspace.permissions.modeOptions.safe.label': '探索',
      'settings:workspace.permissions.modeOptions.ask.label': '询问后编辑',
      'settings:workspace.permissions.modeOptions.allowAll.label': '执行',
      'settings:workspace.permissions.modeOptions.safe.description': '只读，不允许修改',
      'settings:workspace.permissions.modeOptions.ask.description': '修改前询问',
      'settings:workspace.permissions.modeOptions.allowAll.description': '完全自主执行',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getActiveOptionBadgesLabels(t)
    expect(labels.permissionModes.safe).toBe('探索')
    expect(labels.permissionModes.ask).toBe('询问后编辑')
    expect(labels.permissionModes['allow-all']).toBe('执行')
  })
})
