import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getSessionMenuLabels } from '../SessionMenu'
import { getSkillMenuLabels } from '../SkillMenu'
import { getSourceMenuLabels } from '../source-menu-labels'
import { getSessionSearchHeaderLabels } from '../session-search-header-labels'
import { getMainContentLabels } from '../main-content-labels'
import { getPermissionRequestLabels } from '../input/structured/PermissionRequest'

describe('menu and panel i18n labels', () => {
  it('returns localized session menu labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:menu.openInNewWindow': '在新窗口打开',
      'common:menu.status': '状态',
      'common:sessionMenu.shareFailed': '分享失败',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionMenuLabels(t)

    expect(labels.menu.openInNewWindow).toBe('在新窗口打开')
    expect(labels.menu.status).toBe('状态')
    expect(labels.toast.shareFailed).toBe('分享失败')
  })

  it('returns localized skill menu labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:menu.openInNewWindow': 'Open in New Window Localized',
      'common:menu.showInFinder': 'Show in Finder Localized',
      'common:menu.deleteSkill': 'Delete Skill Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSkillMenuLabels(t)

    expect(labels.openInNewWindow).toBe('Open in New Window Localized')
    expect(labels.showInFinder).toBe('Show in Finder Localized')
    expect(labels.deleteSkill).toBe('Delete Skill Localized')
  })

  it('returns localized source menu labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:menu.openInNewWindow': 'Source Open New Window Localized',
      'common:menu.showInFinder': 'Source Show in Finder Localized',
      'common:menu.deleteSource': 'Source Delete Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSourceMenuLabels(t)

    expect(labels.openInNewWindow).toBe('Source Open New Window Localized')
    expect(labels.showInFinder).toBe('Source Show in Finder Localized')
    expect(labels.deleteSource).toBe('Source Delete Localized')
  })

  it('returns localized session search header labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:sessionSearch.placeholder': 'Search Localized',
      'common:sessionSearch.close': 'Close Localized',
      'common:sessionSearch.loading': 'Loading Localized',
      'common:sessionSearch.results': '{{count}} localized results',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionSearchHeaderLabels(t)

    expect(labels.placeholder).toBe('Search Localized')
    expect(labels.close).toBe('Close Localized')
    expect(labels.loading).toBe('Loading Localized')
    expect(labels.results(3)).toBe('3 localized results')
    expect(labels.results(100, true)).toBe('100+ localized results')
  })

  it('returns localized main content empty-state labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:mainContent.empty.noSourcesConfigured': 'No sources configured Localized',
      'common:mainContent.empty.noSkillsConfigured': 'No skills configured Localized',
      'common:mainContent.empty.noFlaggedConversations': 'No flagged conversations Localized',
      'common:mainContent.empty.selectConversation': 'Select a conversation to get started Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getMainContentLabels(t)

    expect(labels.noSourcesConfigured).toBe('No sources configured Localized')
    expect(labels.noSkillsConfigured).toBe('No skills configured Localized')
    expect(labels.noFlaggedConversations).toBe('No flagged conversations Localized')
    expect(labels.selectConversation).toBe('Select a conversation to get started Localized')
  })

  it('returns localized permission request labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:permissionRequest.title': 'Permission Required Localized',
      'common:permissionRequest.actions.allow': 'Allow Localized',
      'common:permissionRequest.tip': 'Always Allow tip Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getPermissionRequestLabels(t)

    expect(labels.title).toBe('Permission Required Localized')
    expect(labels.actions.allow).toBe('Allow Localized')
    expect(labels.tip).toBe('Always Allow tip Localized')
  })
})
