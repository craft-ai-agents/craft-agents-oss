import { describe, expect, it } from 'bun:test'
import { resolveEditButtonLabel } from '../edit-button-label'

describe('edit button i18n', () => {
  it('uses localized edit action label', () => {
    const t = (key: string) => ({
      'common:edit': '编辑',
    } as Record<string, string>)[key] || key

    expect(resolveEditButtonLabel(t)).toBe('编辑')
  })
})
