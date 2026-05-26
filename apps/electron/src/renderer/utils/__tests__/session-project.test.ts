import { describe, expect, it } from 'bun:test'
import {
  formatProjectLabel,
  GENERAL_PROJECT_KEY,
  getSessionProjectInfo,
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
