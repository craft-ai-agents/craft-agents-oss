import { describe, expect, it } from 'bun:test'
import {
  formatProjectLabel,
  GENERAL_PROJECT_KEY,
  getSessionProjectInfo,
  setSessionProjectLabel,
  slugifyProjectName,
} from '../session-project'

describe('getSessionProjectInfo', () => {
  it('uses General when no project label is present', () => {
    expect(getSessionProjectInfo({ labels: ['bug', 'priority::2'] })).toEqual({
      key: GENERAL_PROJECT_KEY,
      label: 'General',
    })
  })

  it('extracts project label values from session labels', () => {
    expect(getSessionProjectInfo({ labels: ['project::ltr-os', 'bug'] })).toEqual({
      key: 'project:ltr-os',
      label: 'LTR OS',
      value: 'ltr-os',
    })
  })
})

describe('formatProjectLabel', () => {
  it('formats compact project slugs for display', () => {
    expect(formatProjectLabel('runneros-launch')).toBe('RunnerOS Launch')
    expect(formatProjectLabel('ltr-os')).toBe('LTR OS')
    expect(formatProjectLabel('client_a')).toBe('Client A')
  })
})

describe('slugifyProjectName', () => {
  it('creates stable project slugs', () => {
    expect(slugifyProjectName('LTR OS')).toBe('ltr-os')
    expect(slugifyProjectName('  Client A / Spring Launch  ')).toBe('client-a-spring-launch')
  })
})

describe('setSessionProjectLabel', () => {
  it('replaces project labels while preserving other labels', () => {
    expect(setSessionProjectLabel(['bug', 'project::old', 'priority::2'], 'new-project')).toEqual([
      'bug',
      'priority::2',
      'project::new-project',
    ])
  })

  it('removes project label when project is cleared', () => {
    expect(setSessionProjectLabel(['bug', 'project::old'], undefined)).toEqual(['bug'])
  })
})
