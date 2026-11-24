import { describe, expect, it } from 'bun:test'
import { DEAD_ZONE, layoutRing, layoutSubRing, outerRadius, slotForArrow, wrapAngle, type Point } from '../geometry'
import { DWELL_MS, hubPress, pieClick, pieKey, pieMove, pieRelease, pieTick, REST_SLOP, startGesture, toSticky, type PieGesture } from '../gesture'

const STAGE = { width: 1000, height: 800 }
const CENTER = { x: 500, y: 400 }
/** Slots clockwise from the top: 0 ↑, 1 ↗, 2 →, 3 ↘, 4 ↓, 5 ↙, 6 ←, 7 ↖. */
const ring = layoutRing(CENTER, STAGE, 8)
const RIGHT = 2
const DOWN = 4
const hasSub = (index: number) => index === 1 || index === 3 || index === 7

const at = (dx: number, dy: number, from: Point = CENTER): Point => ({ x: from.x + dx, y: from.y + dy })

function moves(g: PieGesture, points: Point[], start = 0, stepMs = 16): PieGesture {
  return points.reduce((next, p, i) => pieMove(next, p, start + i * stepMs), g)
}

describe('geometry', () => {
  it('moves the ring in from an edge, keeping every slot where it was', () => {
    const corner = layoutRing({ x: 990, y: 790 }, STAGE, 8)
    expect(corner.shifted).toBe(true)
    expect(corner.center.x).toBeLessThan(990 - outerRadius(corner))
    expect(corner.slots.map(s => s.angle)).toEqual(ring.slots.map(s => s.angle))
    expect(ring.shifted).toBe(false)
  })

  it('keeps the band on the display, close to the edge (nothing hangs outside it)', () => {
    for (const press of [{ x: 990, y: 790 }, { x: 4, y: 4 }]) {
      const corner = layoutRing(press, STAGE, 8)
      const reach = outerRadius(corner)
      expect(corner.center.x - reach).toBeGreaterThanOrEqual(0)
      expect(corner.center.y - reach).toBeGreaterThanOrEqual(0)
      expect(corner.center.x + reach).toBeLessThanOrEqual(STAGE.width)
      expect(corner.center.y + reach).toBeLessThanOrEqual(STAGE.height)
      // Only a little room past the band: the pie stays near where it was asked for
      expect(Math.min(corner.center.x - reach, STAGE.width - corner.center.x - reach)).toBeLessThanOrEqual(16)
    }
    // A pie a band's width from an edge doesn't move at all
    expect(layoutRing({ x: 1000 - outerRadius(ring) - 16, y: 400 }, STAGE, 8).shifted).toBe(false)
  })

  it('points a sub-pie\'s last slot back at its parent', () => {
    const sub = layoutSubRing({ x: 600, y: 300 }, STAGE, 6, CENTER)
    const back = sub.slots[5].angle
    expect(Math.abs(wrapAngle(back - Math.atan2(CENTER.y - 300, CENTER.x - 600)))).toBeLessThan(1e-9)
  })

  it('maps arrows to the nearest slot', () => {
    expect(slotForArrow(ring, 'ArrowUp')).toBe(0)
    expect(slotForArrow(ring, 'ArrowRight')).toBe(RIGHT)
    expect(slotForArrow(ring, 'ArrowLeft')).toBe(6)
    expect(slotForArrow(ring, 'a')).toBeNull()
  })
})

describe('held: flick and release', () => {
  it('picks the slot the flick points at, at any distance past the dead zone', () => {
    const g = moves(startGesture(ring, CENTER), [at(8, 0), at(30, 2), at(300, 10)])
    expect(g.active).toBe(RIGHT)
    expect(pieRelease(g, false).output).toEqual({ type: 'pick', index: RIGHT, how: 'flick' })
  })

  it('reads the direction from where the trigger was pressed, not the hub', () => {
    // A ring moved in from the right edge: its hub is left of the press
    const press = { x: 990, y: 400 }
    const shifted = layoutRing(press, STAGE, 8)
    const g = pieMove(startGesture(shifted, press), at(0, DEAD_ZONE + 4, press), 0)
    expect(g.active).toBe(DOWN)
  })

  it('stays open (sticky) when released without aiming', () => {
    const g = moves(startGesture(ring, CENTER), [at(3, 3), at(6, 4)])
    const step = pieRelease(g, false)
    expect(step.output).toBeNull()
    expect(step.gesture.mode).toBe('sticky')
    expect(step.gesture.origin).toEqual(ring.center)
  })

  it('cancels a flick that came back into the dead zone', () => {
    const g = moves(startGesture(ring, CENTER), [at(40, 0), at(5, 0)])
    expect(g.active).toBeNull()
    expect(pieRelease(g, false).gesture.mode).toBe('sticky')
  })

  it('goes away on an interrupted release (tap ⌘, then ⌘C)', () => {
    const g = moves(startGesture(ring, CENTER), [at(40, 0)])
    expect(pieRelease(g, true).output).toEqual({ type: 'cancel', reason: 'interrupted' })
  })

  it('keeps an interrupted release when the pie took the keys itself', () => {
    const arrowed = pieKey(startGesture(ring, CENTER), 'ArrowDown', 'ArrowDown', false)!
    expect(pieRelease(arrowed.gesture, true).output).toEqual({ type: 'pick', index: DOWN, how: 'key' })
  })

  it('ignores a release once sticky', () => {
    const sticky = toSticky(startGesture(ring, CENTER))
    expect(pieRelease(sticky, false)).toEqual({ gesture: sticky, output: null })
  })
})

describe('held: dwell on a slot with a sub-pie', () => {
  const toward = (index: number, distance: number) => {
    const { angle } = ring.slots[index]
    return at(Math.cos(angle) * distance, Math.sin(angle) * distance)
  }

  it('opens the sub-pie after resting on it', () => {
    const g = pieMove(startGesture(ring, CENTER), toward(1, 60), 0)
    expect(pieTick(g, DWELL_MS - 1, hasSub)).toBeNull()
    expect(pieTick(g, DWELL_MS, hasSub)).toEqual({ type: 'dwell', index: 1 })
  })

  it('restarts the rest clock when the pointer keeps moving', () => {
    let g = pieMove(startGesture(ring, CENTER), toward(1, 60), 0)
    g = pieMove(g, toward(1, 60 + REST_SLOP + 2), 80)
    expect(pieTick(g, DWELL_MS + 10, hasSub)).toBeNull()
    expect(pieTick(g, 80 + DWELL_MS, hasSub)).toEqual({ type: 'dwell', index: 1 })
  })

  it('never dwells on a slot without one, or when sticky', () => {
    const g = pieMove(startGesture(ring, CENTER), toward(RIGHT, 60), 0)
    expect(pieTick(g, 1000, hasSub)).toBeNull()
    const sticky = pieMove(toSticky(startGesture(ring, CENTER)), toward(1, 74), 0)
    expect(pieTick(sticky, 1000, hasSub)).toBeNull()
  })
})

describe('sticky', () => {
  const sticky = toSticky(startGesture(ring, CENTER))

  it('makes the slot under the pointer the active one', () => {
    expect(pieMove(sticky, at(74, 0), 0).active).toBe(RIGHT)
    expect(pieMove(sticky, at(5, 5), 0).active).toBeNull()
    expect(pieMove(sticky, at(400, 0), 0).active).toBeNull()
  })

  it('picks with a click; the hub asks; outside cancels', () => {
    expect(pieClick(sticky, at(0, 74)).output).toEqual({ type: 'pick', index: DOWN, how: 'click' })
    expect(pieClick(sticky, at(4, -4)).output).toEqual({ type: 'hub', how: 'click' })
    expect(pieClick(sticky, at(0, 300)).output).toEqual({ type: 'cancel', reason: 'outside' })
  })

  it('runs the hub\'s own click (the Craft mark, allowing Accessibility); otherwise it asks, a sub-pie\'s goes back', () => {
    expect(hubPress({ inSub: false, how: 'click', click: 'open-craft' })).toBe('open-craft')
    expect(hubPress({ inSub: false, how: 'click', click: 'allow-accessibility' })).toBe('allow-accessibility')
    // Words in the hub without a click of their own (a selection, a reason): it asks
    expect(hubPress({ inSub: false, how: 'click', click: null })).toBe('ask')
    // ↵ with nothing aimed keeps asking, whatever the hub shows: a question works without a selection
    expect(hubPress({ inSub: false, how: 'key', click: 'open-craft' })).toBe('ask')
    expect(hubPress({ inSub: false, how: 'key', click: 'allow-accessibility' })).toBe('ask')
    expect(hubPress({ inSub: true, how: 'click', click: 'open-craft' })).toBe('back')
  })

  it('keeps a slot picked with the keys until the pointer points at another', () => {
    const arrowed = pieKey(sticky, 'ArrowLeft', 'ArrowLeft', false)!.gesture
    expect(pieMove(arrowed, at(2, 2), 0).active).toBe(6)
    expect(pieMove(arrowed, at(74, 0), 0).active).toBe(RIGHT)
  })
})

describe('keys', () => {
  const g = startGesture(ring, CENTER)

  it('picks 1–8 by physical key, on the number row or the keypad', () => {
    expect(pieKey(g, '3', 'Digit3', false)?.output).toEqual({ type: 'pick', index: 2, how: 'key' })
    expect(pieKey(g, '£', 'Digit3', true)?.output).toEqual({ type: 'pick', index: 2, how: 'key' })
    expect(pieKey(g, '8', 'Numpad8', false)?.output).toEqual({ type: 'pick', index: 7, how: 'key' })
  })

  it('swallows a digit past the last slot', () => {
    const small = startGesture(layoutRing(CENTER, STAGE, 4), CENTER)
    expect(pieKey(small, '6', 'Digit6', false)).toEqual({ gesture: { ...small, keysUsed: true }, output: null })
  })

  it('moves with the arrows and Tab, then ↵ picks; ↵ with nothing active asks', () => {
    expect(pieKey(g, 'Enter', 'Enter', false)?.output).toEqual({ type: 'hub', how: 'key' })
    const right = pieKey(g, 'ArrowRight', 'ArrowRight', false)!.gesture
    expect(right.active).toBe(RIGHT)
    expect(pieKey(right, 'Enter', 'Enter', false)?.output).toEqual({ type: 'pick', index: RIGHT, how: 'key' })
    expect(pieKey(g, 'Tab', 'Tab', false)!.gesture.active).toBe(0)
    expect(pieKey(g, 'Tab', 'Tab', true)!.gesture.active).toBe(7)
    expect(pieKey(right, 'Tab', 'Tab', false)!.gesture.active).toBe(3)
  })

  it('cancels on Esc and goes back on Backspace', () => {
    expect(pieKey(g, 'Escape', 'Escape', false)?.output).toEqual({ type: 'cancel', reason: 'escape' })
    expect(pieKey(g, 'Backspace', 'Backspace', false)?.output).toEqual({ type: 'back' })
  })

  it('leaves other keys to the input, where typing asks', () => {
    expect(pieKey(g, 'w', 'KeyW', false)).toBeNull()
    expect(pieKey(g, '9', 'Digit9', false)).toBeNull()
  })

  it('marks keys taken during a hold, not when sticky', () => {
    expect(pieKey(g, 'ArrowUp', 'ArrowUp', false)!.gesture.keysUsed).toBe(true)
    expect(pieKey(toSticky(g), 'ArrowUp', 'ArrowUp', false)!.gesture.keysUsed).toBe(false)
  })
})
