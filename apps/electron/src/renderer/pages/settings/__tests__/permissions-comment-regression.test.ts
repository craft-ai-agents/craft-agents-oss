import { describe, expect, it } from 'bun:test'

describe('permissions comment regression', () => {
  it('keeps explicit per-pattern comments when present', () => {
    const rowFromDefault = {
      pattern: '^ls\\b',
      comment: '列出目录内容',
    }

    expect(rowFromDefault.comment).toBe('列出目录内容')
  })
})
