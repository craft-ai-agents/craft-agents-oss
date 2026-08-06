import { describe, expect, it } from 'bun:test'
import { getStructuredInputMaxHeight } from '../structured-height'

describe('getStructuredInputMaxHeight', () => {
  it('uses the fixed maximum when viewport height is unavailable', () => {
    expect(getStructuredInputMaxHeight(0)).toBe(480)
    expect(getStructuredInputMaxHeight(Number.NaN)).toBe(480)
  })

  it('caps structured prompts at the configured maximum', () => {
    expect(getStructuredInputMaxHeight(2000)).toBe(480)
  })

  it('uses 70% of the viewport for normal window sizes', () => {
    expect(getStructuredInputMaxHeight(600)).toBe(420)
  })

  it('keeps a minimum usable height for very short windows', () => {
    expect(getStructuredInputMaxHeight(120)).toBe(160)
  })
})
