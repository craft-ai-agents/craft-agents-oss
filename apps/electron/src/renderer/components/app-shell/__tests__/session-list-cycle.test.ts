import { describe, expect, it } from 'bun:test'
import { getCycledSessionIndex } from '../session-list-cycle'

describe('getCycledSessionIndex', () => {
  it('moves one row up or down in visible list order', () => {
    expect(getCycledSessionIndex(4, 1, -1)).toBe(0)
    expect(getCycledSessionIndex(4, 1, 1)).toBe(2)
  })

  it('wraps at both ends of the list', () => {
    expect(getCycledSessionIndex(4, 0, -1)).toBe(3)
    expect(getCycledSessionIndex(4, 3, 1)).toBe(0)
  })

  it('starts at the appropriate edge when the current chat is not visible', () => {
    expect(getCycledSessionIndex(4, -1, -1)).toBe(3)
    expect(getCycledSessionIndex(4, -1, 1)).toBe(0)
    expect(getCycledSessionIndex(1, -1, 1)).toBe(0)
  })

  it('does not reopen the only active chat or handle an empty list', () => {
    expect(getCycledSessionIndex(1, 0, -1)).toBeNull()
    expect(getCycledSessionIndex(1, 0, 1)).toBeNull()
    expect(getCycledSessionIndex(0, -1, 1)).toBeNull()
  })
})
