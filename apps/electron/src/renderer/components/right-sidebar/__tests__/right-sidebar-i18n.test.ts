import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getRightSidebarLabels } from '../right-sidebar-labels'
import { getSessionMetadataLabels } from '../session-metadata-labels'
import { getSessionFilesLabels } from '../session-files-labels'

describe('right sidebar label helpers', () => {
  it('returns localized right sidebar tab labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:rightSidebar.files.comingSoon': 'Files soon localized',
      'common:rightSidebar.history.comingSoon': 'History soon localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getRightSidebarLabels(t)

    expect(labels.filesComingSoon).toBe('Files soon localized')
    expect(labels.historyComingSoon).toBe('History soon localized')
  })

  it('returns localized metadata labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:rightSidebar.metadata.title': 'Chat info localized',
      'common:rightSidebar.metadata.noSession': 'No session localized',
      'common:rightSidebar.metadata.loading': 'Loading localized',
      'common:rightSidebar.metadata.name': 'Name localized',
      'common:rightSidebar.metadata.namePlaceholder': 'Untitled localized',
      'common:rightSidebar.metadata.notes': 'Notes localized',
      'common:rightSidebar.metadata.notesPlaceholder': 'Add notes localized',
      'common:rightSidebar.metadata.notesLoading': 'Loading notes localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionMetadataLabels(t)

    expect(labels.title).toBe('Chat info localized')
    expect(labels.noSession).toBe('No session localized')
    expect(labels.loading).toBe('Loading localized')
    expect(labels.name).toBe('Name localized')
    expect(labels.namePlaceholder).toBe('Untitled localized')
    expect(labels.notes).toBe('Notes localized')
    expect(labels.notesPlaceholder).toBe('Add notes localized')
    expect(labels.notesLoading).toBe('Loading notes localized')
  })

  it('returns localized file section labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:rightSidebar.files.title': 'Files localized',
      'common:rightSidebar.files.loading': 'Loading files localized',
      'common:rightSidebar.files.empty': 'Files empty localized',
      'common:rightSidebar.files.directory': 'Directory localized',
      'common:rightSidebar.files.clickExpand': 'Click expand localized',
      'common:rightSidebar.files.clickReveal': 'Click reveal localized',
      'common:rightSidebar.files.doubleClickOpen': 'Double click localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSessionFilesLabels(t)

    expect(labels.title).toBe('Files localized')
    expect(labels.loading).toBe('Loading files localized')
    expect(labels.empty).toBe('Files empty localized')
    expect(labels.directory).toBe('Directory localized')
    expect(labels.clickExpand).toBe('Click expand localized')
    expect(labels.clickReveal).toBe('Click reveal localized')
    expect(labels.doubleClickOpen).toBe('Double click localized')
  })
})
