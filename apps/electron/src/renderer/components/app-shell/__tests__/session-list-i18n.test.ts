import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getSessionListLabels } from '../session-list-labels'

describe('session list labels', () => {
  it('returns localized empty/search labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:sessionList.empty.title': 'No conversations yet localized',
      'common:sessionList.empty.description': 'Empty description localized',
      'common:sessionList.empty.action': 'New Conversation localized',
      'common:sessionList.search.noConversations': 'No conversations found localized',
      'common:sessionList.search.description': 'Searched titles localized',
      'common:sessionList.search.clear': 'Clear search localized',
      'common:sessionList.search.sessionsAria': 'Sessions localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionListLabels(t)

    expect(labels.emptyTitle).toBe('No conversations yet localized')
    expect(labels.emptyDescription).toBe('Empty description localized')
    expect(labels.emptyAction).toBe('New Conversation localized')
    expect(labels.searchNoConversations).toBe('No conversations found localized')
    expect(labels.searchDescription).toBe('Searched titles localized')
    expect(labels.searchClear).toBe('Clear search localized')
    expect(labels.sessionsAria).toBe('Sessions localized')
  })
})
