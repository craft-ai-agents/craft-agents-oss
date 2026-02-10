import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getWorkspaceChoiceLabels } from '../workspace-choice-labels'

describe('workspace i18n labels', () => {
  it('returns localized labels', () => {
    const t: TFunction = ((key: string) => ({
      'settings:workspace.add.title': 'Add Workspace Localized',
      'settings:workspace.add.createNew': 'Create New Localized',
      'settings:workspace.add.description': 'Description Localized',
      'settings:workspace.add.createDescription': 'Create Desc Localized',
      'settings:workspace.add.openFolder': 'Open Folder Localized',
      'settings:workspace.add.openDescription': 'Open Desc Localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getWorkspaceChoiceLabels(t)
    expect(labels.title).toBe('Add Workspace Localized')
    expect(labels.description).toBe('Description Localized')
    expect(labels.createNew).toBe('Create New Localized')
    expect(labels.createDescription).toBe('Create Desc Localized')
    expect(labels.openFolder).toBe('Open Folder Localized')
    expect(labels.openDescription).toBe('Open Desc Localized')
  })
})
