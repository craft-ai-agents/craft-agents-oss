import { describe, expect, it } from 'bun:test'
import { getPresetTriggerLabel } from '../ApiKeyInput'

describe('ApiKeyInput preset trigger labels', () => {
  it('uses localized custom preset label when active preset is custom', () => {
    expect(getPresetTriggerLabel('custom', '自定义')).toBe('自定义')
  })
})
