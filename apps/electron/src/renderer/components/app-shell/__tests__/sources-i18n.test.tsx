import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getSourcesLabels } from '../SourcesListPanel'

describe('sources i18n labels', () => {
  it('returns localized labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:sources.add': 'Add Source Localized',
      'common:sources.emptyTitle': 'Empty Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSourcesLabels(t)
    expect(labels.add).toBe('Add Source Localized')
    expect(labels.emptyTitle).toBe('Empty Localized')
  })
})
