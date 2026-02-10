import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getLabelValuePopoverLabels } from '../label-value-popover'

describe('label value popover labels', () => {
  it('returns localized remove label', () => {
    const t: TFunction = ((key: string) => ({
      'common:actions.remove': '移除',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getLabelValuePopoverLabels(t)
    expect(labels.remove).toBe('移除')
  })
})
