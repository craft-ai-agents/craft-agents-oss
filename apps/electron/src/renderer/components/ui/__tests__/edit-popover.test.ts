import { describe, expect, it } from 'bun:test'
import {
  INLINE_EDIT_POPOVER_CONTEXT_KEYS,
  usesInlineExecutionForEditPopoverContext,
} from '../edit-popover-inline'

describe('usesInlineExecutionForEditPopoverContext', () => {
  it('runs source and skill creation flows inline', () => {
    expect(INLINE_EDIT_POPOVER_CONTEXT_KEYS).toEqual([
      'add-source',
      'add-source-api',
      'add-source-mcp',
      'add-source-local',
      'add-skill',
    ])

    for (const key of INLINE_EDIT_POPOVER_CONTEXT_KEYS) {
      expect(usesInlineExecutionForEditPopoverContext(key)).toBe(true)
    }
  })

  it('leaves unrelated edit contexts on the legacy path', () => {
    expect(usesInlineExecutionForEditPopoverContext('edit-statuses')).toBe(false)
  })
})
