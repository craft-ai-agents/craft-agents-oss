import { describe, expect, it } from 'bun:test'
import { DEFAULT_ZOOM_LEVELS, normalizeZoomLevel } from '../zoom'

describe('normalizeZoomLevel', () => {
  it('keeps the offered choices', () => {
    for (const level of DEFAULT_ZOOM_LEVELS) expect(normalizeZoomLevel(level)).toBe(level)
  })

  it('snaps other numbers to the nearest choice, clamped to the range', () => {
    expect(normalizeZoomLevel(118)).toBe(125)
    expect(normalizeZoomLevel(104)).toBe(100)
    expect(normalizeZoomLevel(30)).toBe(80)
    expect(normalizeZoomLevel(300)).toBe(150)
  })

  it('falls back to 100% for anything that is not a finite number', () => {
    expect(normalizeZoomLevel(undefined)).toBe(100)
    expect(normalizeZoomLevel('125')).toBe(100)
    expect(normalizeZoomLevel(Number.NaN)).toBe(100)
    expect(normalizeZoomLevel(Number.POSITIVE_INFINITY)).toBe(100)
  })
})
