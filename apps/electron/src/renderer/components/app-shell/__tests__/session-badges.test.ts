import { describe, expect, it } from 'bun:test'

import { compactSessionLabels, MAX_VISIBLE_SESSION_LABELS } from '../session-badge-density'

describe('session label density', () => {
  it('shows one label and summarizes the rest', () => {
    expect(MAX_VISIBLE_SESSION_LABELS).toBe(1)
    expect(compactSessionLabels(['research', 'design', 'priority'])).toEqual({
      visible: ['research'],
      hidden: ['design', 'priority'],
    })
  })

  it('does not add a summary when the label count fits', () => {
    expect(compactSessionLabels(['research'])).toEqual({
      visible: ['research'],
      hidden: [],
    })
  })
})
