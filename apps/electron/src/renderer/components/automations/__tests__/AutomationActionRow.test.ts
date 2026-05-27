import { describe, expect, it } from 'bun:test'
import { getPromptThinkingBadgeKey } from '../AutomationActionRow'

describe('getPromptThinkingBadgeKey', () => {
  it('uses explicit enabled/disabled indicator labels', () => {
    expect(getPromptThinkingBadgeKey(true)).toBe('automations.thinkingEnabled')
    expect(getPromptThinkingBadgeKey(false)).toBe('automations.thinkingDisabled')
  })
})
