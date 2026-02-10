import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getSkillsListLabels } from '../skills-list-labels'
import { getTaskActionLabels } from '../task-action-labels'

describe('skills list and task action labels', () => {
  it('returns localized skills list labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:skillsList.empty.title': 'No skills localized',
      'common:skillsList.empty.description': 'Skills description localized',
      'common:skillsList.empty.learnMore': 'Learn more localized',
      'common:skillsList.empty.addSkill': 'Add skill localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getSkillsListLabels(t)

    expect(labels.emptyTitle).toBe('No skills localized')
    expect(labels.emptyDescription).toBe('Skills description localized')
    expect(labels.learnMore).toBe('Learn more localized')
    expect(labels.addSkill).toBe('Add skill localized')
  })

  it('returns localized task action labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:taskActions.title': 'Task menu localized',
      'common:taskActions.type.task': 'Task type localized',
      'common:taskActions.type.shell': 'Shell type localized',
      'common:taskActions.viewOutput': 'View output localized',
      'common:taskActions.stopTask': 'Stop task localized',
      'common:taskActions.overlayUnavailable': 'Overlay unavailable localized',
      'common:taskActions.outputFallback': 'Output fallback localized',
      'common:taskActions.loadFailed': 'Load failed localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getTaskActionLabels(t)

    expect(labels.title).toBe('Task menu localized')
    expect(labels.typeTask).toBe('Task type localized')
    expect(labels.typeShell).toBe('Shell type localized')
    expect(labels.viewOutput).toBe('View output localized')
    expect(labels.stopTask).toBe('Stop task localized')
    expect(labels.overlayUnavailable).toBe('Overlay unavailable localized')
    expect(labels.outputFallback).toBe('Output fallback localized')
    expect(labels.loadFailed).toBe('Load failed localized')
  })
})
