import { describe, it, expect } from 'bun:test'
import {
  LONG_PRESS_MS,
  MOVE_TOLERANCE_PX,
  shouldFireLongPress,
} from '../long-press-state'

describe('shouldFireLongPress', () => {
  const start = { x: 100, y: 100 }

  it('does nothing while the timer is still running and the finger is still', () => {
    const result = shouldFireLongPress(start, { x: 100, y: 100 }, 200)
    expect(result).toEqual({ fire: false, cancel: false })
  })

  it('fires when elapsed reaches the threshold and the finger is still', () => {
    const result = shouldFireLongPress(start, { x: 100, y: 100 }, LONG_PRESS_MS)
    expect(result).toEqual({ fire: true, cancel: false })
  })

  it('keeps waiting when the finger moves within tolerance before threshold', () => {
    const result = shouldFireLongPress(
      start,
      { x: 105, y: 102 }, // sqrt(25+4) ≈ 5.4 < 10
      200,
    )
    expect(result).toEqual({ fire: false, cancel: false })
  })

  it('cancels when the finger moves past tolerance before threshold', () => {
    const result = shouldFireLongPress(
      start,
      { x: 120, y: 100 }, // 20px right → past 10px tolerance
      200,
    )
    expect(result).toEqual({ fire: false, cancel: true })
  })

  it('movement past tolerance wins even if elapsed has reached threshold', () => {
    // The user was reasonably still until ~500ms but then dragged. The
    // consumer should still treat this as a drag, not a long-press.
    const result = shouldFireLongPress(
      start,
      { x: 130, y: 100 },
      LONG_PRESS_MS + 50,
    )
    expect(result).toEqual({ fire: false, cancel: true })
  })

  it('keeps waiting at exactly the tolerance boundary (inclusive)', () => {
    // 6-8-10 Pythagorean triple — total distance is exactly 10px, the
    // tolerance limit. Pinned as inclusive so a finger landing right on
    // the boundary still counts as stationary.
    const result = shouldFireLongPress(
      start,
      { x: start.x + 6, y: start.y + 8 },
      200,
    )
    expect(result).toEqual({ fire: false, cancel: false })
  })
})

describe('long-press constants', () => {
  it('uses the iOS-standard 500ms threshold', () => {
    // Pinned because tuning these affects how long the user has to hold;
    // changing it should be a deliberate UX decision, not an accident.
    expect(LONG_PRESS_MS).toBe(500)
  })

  it('uses a 10px move tolerance', () => {
    expect(MOVE_TOLERANCE_PX).toBe(10)
  })
})
