import { describe, expect, it } from 'bun:test'
import { HoverIntent, type HoverIntentState } from '../useHoverPopover'

/** Manual clock: timers fire only when the test advances time. */
function fakeTimers() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = nextId++
        pending.set(id, { at: now + ms, fn })
        return id
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number)
      },
    },
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue
        pending.delete(id)
        timer.fn()
      }
    },
  }
}

function setup() {
  const clock = fakeTimers()
  const changes: HoverIntentState[] = []
  const intent = new HoverIntent({ openDelay: 300, closeDelay: 150, onChange: s => changes.push(s), timers: clock.timers })
  return { clock, changes, intent }
}

describe('HoverIntent', () => {
  it('opens after the hover delay, not before', () => {
    const { clock, intent } = setup()
    intent.enter()
    clock.advance(299)
    expect(intent.current.open).toBe(false)
    clock.advance(1)
    expect(intent.current).toEqual({ open: true, pinned: false })
  })

  it('never opens when the pointer passes through quickly', () => {
    const { clock, intent, changes } = setup()
    intent.enter()
    clock.advance(100)
    intent.leave()
    clock.advance(1000)
    expect(changes).toEqual([])
  })

  it('closes after the grace period once the pointer leaves', () => {
    const { clock, intent } = setup()
    intent.enter()
    clock.advance(300)
    intent.leave()
    clock.advance(149)
    expect(intent.current.open).toBe(true)
    clock.advance(1)
    expect(intent.current.open).toBe(false)
  })

  it('stays open while the pointer crosses from the trigger into the card', () => {
    const { clock, intent } = setup()
    intent.enter()
    clock.advance(300)
    intent.leave() // leaves the trigger
    clock.advance(80)
    intent.enter() // enters the card
    clock.advance(1000)
    expect(intent.current.open).toBe(true)
  })

  it('pins on click: hover-out no longer closes it', () => {
    const { clock, intent } = setup()
    intent.enter()
    clock.advance(300)
    intent.click()
    expect(intent.current).toEqual({ open: true, pinned: true })
    intent.leave()
    clock.advance(1000)
    expect(intent.current.open).toBe(true)
  })

  it('pin keeps an open card open while a menu opened from it is in use', () => {
    const { clock, intent } = setup()
    intent.enter()
    clock.advance(300)
    intent.pin() // the card's "+N" menu opened
    intent.leave() // the pointer moves into the menu, which renders in a portal
    clock.advance(1000)
    expect(intent.current).toEqual({ open: true, pinned: true })
  })

  it('pin cancels a pending close and never opens a closed card', () => {
    const { clock, intent } = setup()
    intent.pin()
    expect(intent.current.open).toBe(false)
    intent.enter()
    clock.advance(300)
    intent.leave()
    intent.pin()
    clock.advance(1000)
    expect(intent.current.open).toBe(true)
  })

  it('opens pinned on a click without hover (keyboard, touch) and closes on a second click', () => {
    const { intent } = setup()
    intent.click()
    expect(intent.current).toEqual({ open: true, pinned: true })
    intent.click()
    expect(intent.current).toEqual({ open: false, pinned: false })
  })

  it('a click during the open delay opens at once and cancels the pending open', () => {
    const { clock, intent, changes } = setup()
    intent.enter()
    clock.advance(100)
    intent.click()
    clock.advance(1000)
    expect(changes).toEqual([{ open: true, pinned: true }])
  })

  it('dismiss closes a pinned card and clears pending timers', () => {
    const { clock, intent } = setup()
    intent.click()
    intent.dismiss()
    expect(intent.current).toEqual({ open: false, pinned: false })
    intent.enter()
    intent.dismiss()
    clock.advance(1000)
    expect(intent.current.open).toBe(false)
  })
})
