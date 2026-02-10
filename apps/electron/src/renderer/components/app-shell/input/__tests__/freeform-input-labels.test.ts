import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getFreeFormInputLabels } from '../freeform-input-labels'

describe('free form input labels', () => {
  it('returns localized action labels and placeholders', () => {
    const t: TFunction = ((key: string) => ({
      'common:chatInput.placeholders.workOn': 'Work on localized',
      'common:chatInput.placeholders.shiftTabMode': 'Shift tab localized',
      'common:chatInput.placeholders.mentionHint': 'Mention localized',
      'common:chatInput.placeholders.labelHint': 'Label localized',
      'common:chatInput.placeholders.newlineHint': 'Newline localized',
      'common:chatInput.placeholders.sidebarToggleHint': 'Sidebar localized',
      'common:chatInput.placeholders.focusModeHint': 'Focus localized',
      'common:chatInput.actions.attachFiles': 'Attach files localized',
      'common:chatInput.actions.attachFilesTooltip': 'Attach tooltip localized',
      'common:chatInput.actions.chooseSources': 'Choose sources localized',
      'common:chatInput.actions.sourcesTooltip': 'Sources tooltip localized',
      'common:chatInput.actions.addSourcesInSettings': 'Add sources localized',
      'common:chatInput.actions.searchSources': 'Search sources localized',
      'common:chatInput.actions.workInFolder': 'Work folder localized',
      'common:chatInput.actions.folderFallback': 'Folder localized',
      'common:chatInput.actions.filterFolders': 'Filter folders localized',
      'common:chatInput.actions.noFoldersFound': 'No folders localized',
      'common:chatInput.actions.chooseFolder': 'Choose folder localized',
      'common:chatInput.actions.resetFolder': 'Reset folder localized',
      'common:chatInput.actions.gitBranchPrefix': 'on localized ',
      'common:chatInput.actions.noDetailsProvided': 'No details localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getFreeFormInputLabels(t)

    expect(labels.placeholders.workOn).toBe('Work on localized')
    expect(labels.placeholders.shiftTabMode).toBe('Shift tab localized')
    expect(labels.placeholders.mentionHint).toBe('Mention localized')
    expect(labels.placeholders.labelHint).toBe('Label localized')
    expect(labels.placeholders.newlineHint).toBe('Newline localized')
    expect(labels.placeholders.sidebarToggleHint).toBe('Sidebar localized')
    expect(labels.placeholders.focusModeHint).toBe('Focus localized')
    expect(labels.actions.attachFiles).toBe('Attach files localized')
    expect(labels.actions.attachFilesTooltip).toBe('Attach tooltip localized')
    expect(labels.actions.chooseSources).toBe('Choose sources localized')
    expect(labels.actions.addSourcesInSettings).toBe('Add sources localized')
    expect(labels.actions.workInFolder).toBe('Work folder localized')
    expect(labels.actions.folderFallback).toBe('Folder localized')
    expect(labels.actions.filterFolders).toBe('Filter folders localized')
    expect(labels.actions.noFoldersFound).toBe('No folders localized')
    expect(labels.actions.chooseFolder).toBe('Choose folder localized')
    expect(labels.actions.resetFolder).toBe('Reset folder localized')
    expect(labels.actions.gitBranchPrefix).toBe('on localized ')
    expect(labels.actions.noDetailsProvided).toBe('No details localized')
  })
})
