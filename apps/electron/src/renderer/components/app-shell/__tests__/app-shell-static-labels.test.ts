import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getAppShellLabels } from '../app-shell-labels'
import { getChatDisplayLabels } from '../chat-display-labels'

describe('app shell static i18n label helpers', () => {
  it('returns localized app-shell labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:navigation.newChat': 'New Chat Localized',
      'common:navigation.allChats': 'All Chats Localized',
      'common:navigation.allSkills': 'All Skills Localized',
      'common:navigation.helpDocs': 'Help Localized',
      'common:navigation.labels': 'Labels Localized',
      'common:navigation.settings': 'Settings Localized',
      'common:navigation.sources': 'Sources Localized',
      'common:navigation.skills': 'Skills Localized',
      'common:navigation.status': 'Status Localized',
      'common:navigation.apis': 'APIs Localized',
      'common:navigation.mcps': 'MCPs Localized',
      'common:navigation.localFolders': 'Local Folders Localized',
      'common:filters.filterChats': 'Filter Chats Localized',
      'common:filters.searchPlaceholder': 'Search labels localized',
      'common:menu.addSource': 'Add Source Localized',
      'common:menu.addSkill': 'Add Skill Localized',
      'common:navigation.views': 'Views Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getAppShellLabels(t)

    expect(labels.newChat).toBe('New Chat Localized')
    expect(labels.allChats).toBe('All Chats Localized')
    expect(labels.allSkills).toBe('All Skills Localized')
    expect(labels.helpDocs).toBe('Help Localized')
    expect(labels.labels).toBe('Labels Localized')
    expect(labels.settings).toBe('Settings Localized')
    expect(labels.sources).toBe('Sources Localized')
    expect(labels.skills).toBe('Skills Localized')
    expect(labels.statuses).toBe('Status Localized')
    expect(labels.apis).toBe('APIs Localized')
    expect(labels.mcps).toBe('MCPs Localized')
    expect(labels.localFolders).toBe('Local Folders Localized')
    expect(labels.filterChats).toBe('Filter Chats Localized')
    expect(labels.searchPlaceholder).toBe('Search labels localized')
    expect(labels.addSource).toBe('Add Source Localized')
    expect(labels.addSkill).toBe('Add Skill Localized')
    expect(labels.views).toBe('Views Localized')
  })

  it('returns localized compact chat empty-state labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:chatDisplay.compactEmpty.title': 'Compact title localized',
      'common:chatDisplay.compactEmpty.description': 'Compact description localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getChatDisplayLabels(t)

    expect(labels.compactTitle).toBe('Compact title localized')
    expect(labels.compactDescription).toBe('Compact description localized')
  })
})
