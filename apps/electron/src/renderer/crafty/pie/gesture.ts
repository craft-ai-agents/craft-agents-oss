/**
 * The pie's gesture, kept pure so it can be tested. Pointer moves, the trigger's release, clicks,
 * keys and the clock go in; the active slot and what to do come out. Which slots exist, which are
 * dimmed and what a pick runs are up to `CraftyPie`.
 *
 * The pie opens `held`, with the trigger still down:
 * - The direction from where it was pressed picks. There's a dead zone, then any distance counts.
 * - Releasing the trigger runs the slot aimed at.
 * - Releasing it without aiming leaves the pie open, which is the `sticky` mode.
 *
 * In `sticky` mode the slot under the pointer is the active one, and a click, 1–8, or the arrows
 * then ↵ pick a slot. Keys also work while the trigger is held.
 */

import { hitTest, slotForArrow, slotToward, type Point, type Ring } from './geometry'
import type { HubClick } from './slots'

/** A hold draws the pie this long after it opens; a pick before then is mark-ahead (never drawn). */
export const DRAW_DELAY_MS = 250
/** Resting this long on a slot with a sub-pie, with the trigger held, opens the sub-pie. */
export const DWELL_MS = 100
/** Movement under this still counts as resting. */
export const REST_SLOP = 4

export type PieMode = 'held' | 'sticky'
export type PieHow = 'flick' | 'click' | 'key'

export interface PieGesture {
  mode: PieMode
  ring: Ring
  /** Where the direction is read from: where the trigger was pressed in a hold, the hub when sticky. */
  origin: Point
  /** The last known pointer position; null until the first move. */
  pointer: Point | null
  active: number | null
  /** What chose the active slot: arrows and Tab keep their choice until the pointer picks another. */
  activeBy: 'pointer' | 'key' | null
  /** The direction past the dead zone (radians), for the hub's notch. */
  aim: number | null
  /** Where and since when the pointer has rested, for the sub-pie dwell. */
  rest: { at: Point; since: number } | null
  /** The pie handled a key during the hold, so an interrupted release was its own, not a ⌘ shortcut's. */
  keysUsed: boolean
}

export type PieCancel = 'escape' | 'outside' | 'interrupted'

export type PieOutput =
  | { type: 'pick'; index: number; how: PieHow }
  /** The hub: Ask. */
  | { type: 'hub'; how: 'click' | 'key' }
  /** Rested on a slot while held: open its sub-pie, if it has one. */
  | { type: 'dwell'; index: number }
  | { type: 'back' }
  | { type: 'cancel'; reason: PieCancel }

export interface PieStep {
  gesture: PieGesture
  output: PieOutput | null
}

export function startGesture(ring: Ring, origin: Point, mode: PieMode = 'held'): PieGesture {
  return { mode, ring, origin, pointer: null, active: null, activeBy: null, aim: null, rest: null, keysUsed: false }
}

const still = (gesture: PieGesture): PieStep => ({ gesture, output: null })

export function pieMove(g: PieGesture, p: Point, time: number): PieGesture {
  const rested = g.rest && Math.hypot(p.x - g.rest.at.x, p.y - g.rest.at.y) <= REST_SLOP
  const rest = rested ? g.rest : { at: p, since: time }
  let pointed: number | null
  let aim: number | null = null
  if (g.mode === 'held') {
    const dx = p.x - g.origin.x
    const dy = p.y - g.origin.y
    pointed = slotToward(g.ring, dx, dy)
    if (pointed !== null) aim = Math.atan2(dy, dx)
  } else {
    const hit = hitTest(g.ring, p)
    pointed = hit.kind === 'slot' ? hit.index : null
  }
  // A slot picked with the keys stays until the pointer points at one
  if (pointed === null && g.activeBy === 'key') return { ...g, pointer: p, rest }
  return { ...g, pointer: p, rest, active: pointed, activeBy: pointed === null ? null : 'pointer', aim }
}

/** The clock, while held: a rest on a slot opens its sub-pie (the caller knows which slots have one). */
export function pieTick(g: PieGesture, time: number, hasSub: (index: number) => boolean): PieOutput | null {
  if (g.mode !== 'held' || g.activeBy !== 'pointer' || g.active === null || !g.rest) return null
  return hasSub(g.active) && time - g.rest.since >= DWELL_MS ? { type: 'dwell', index: g.active } : null
}

/** Open, with nothing aimed: the slot under the pointer is the active one, picked by a click. */
export function toSticky(g: PieGesture): PieGesture {
  const hit = g.pointer ? hitTest(g.ring, g.pointer) : null
  const pointed = hit?.kind === 'slot' ? hit.index : null
  const keepKey = g.activeBy === 'key' && g.active !== null
  return {
    ...g,
    mode: 'sticky',
    origin: g.ring.center,
    active: keepKey ? g.active : pointed,
    activeBy: keepKey ? 'key' : pointed === null ? null : 'pointer',
    aim: null,
    rest: null,
  }
}

/**
 * The trigger let go. `interrupted`: a key press or click came during the hold. Unless the pie
 * took those keys itself, the press was a ⌘ shortcut (tap ⌘, then ⌘C) and the pie goes away.
 */
export function pieRelease(g: PieGesture, interrupted: boolean): PieStep {
  if (g.mode !== 'held') return still(g)
  if (interrupted && !g.keysUsed) return { gesture: g, output: { type: 'cancel', reason: 'interrupted' } }
  if (g.active !== null) return { gesture: g, output: { type: 'pick', index: g.active, how: g.activeBy === 'key' ? 'key' : 'flick' } }
  return still(toSticky(g))
}

/**
 * What a press on the hub does: a sub-pie's goes back; the main pie's asks, except a click on a hub
 * that does something else (`hubClick`: the Craft mark opens Craft Agents, "Click to allow
 * Accessibility" its settings). ↵ keeps asking.
 */
export function hubPress(press: { inSub: boolean; how: PieHow; click: HubClick | null }): 'back' | 'ask' | HubClick {
  if (press.inSub) return 'back'
  return press.how === 'click' && press.click ? press.click : 'ask'
}

export function pieClick(g: PieGesture, p: Point): PieStep {
  const hit = hitTest(g.ring, p)
  if (hit.kind === 'hub') return { gesture: g, output: { type: 'hub', how: 'click' } }
  if (hit.kind === 'outside') return { gesture: g, output: { type: 'cancel', reason: 'outside' } }
  return { gesture: { ...g, active: hit.index, activeBy: 'pointer' }, output: { type: 'pick', index: hit.index, how: 'click' } }
}

const DIGIT = /^(?:Digit|Numpad)([1-8])$/

/**
 * A key, or null when the pie doesn't use it (it goes on to the pie's input, where typing asks).
 * `code` is the physical key, so 1–8 work with any layout and with modifiers held.
 */
export function pieKey(g: PieGesture, key: string, code: string, shift: boolean): PieStep | null {
  const used = (next: PieGesture, output: PieOutput | null = null): PieStep => ({
    gesture: { ...next, keysUsed: next.keysUsed || next.mode === 'held' },
    output,
  })
  if (key === 'Escape') return used(g, { type: 'cancel', reason: 'escape' })
  const digit = DIGIT.exec(code)
  if (digit) {
    const index = Number(digit[1]) - 1
    // A digit past the last slot does nothing; it doesn't start a question either
    if (index >= g.ring.slots.length) return used(g)
    return used({ ...g, active: index, activeBy: 'key' }, { type: 'pick', index, how: 'key' })
  }
  const toward = slotForArrow(g.ring, key)
  if (toward !== null) return used({ ...g, active: toward, activeBy: 'key', aim: g.ring.slots[toward].angle })
  if (key === 'Tab') {
    const count = g.ring.slots.length
    const active = g.active === null ? (shift ? count - 1 : 0) : (g.active + (shift ? -1 : 1) + count) % count
    return used({ ...g, active, activeBy: 'key', aim: g.ring.slots[active].angle })
  }
  if (key === 'Enter') {
    return used(g, g.active === null ? { type: 'hub', how: 'key' } : { type: 'pick', index: g.active, how: 'key' })
  }
  if (key === 'Backspace') return used(g, { type: 'back' })
  return null
}
