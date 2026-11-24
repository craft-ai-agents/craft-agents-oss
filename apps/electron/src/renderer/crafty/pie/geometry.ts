/**
 * The pie's geometry, ported from the playground (`playground/registry/crafty-radial.tsx`, the Pie
 * look). Angles are radians, clockwise from +x (screen coordinates): -π/2 is up.
 */

export interface Point {
  x: number
  y: number
}

export interface Slot {
  angle: number
  /** Relative to the ring's center. */
  x: number
  y: number
}

export interface Ring {
  slots: Slot[]
  /** The middle of the band. */
  radius: number
  /** Radians between neighbouring slots. */
  step: number
  /** Window coordinates. */
  center: Point
  /** Moved in from a screen edge: the pointer goes to the center (a warp) so every direction works. */
  shifted: boolean
}

/** The band, each side of the radius. */
export const PIE_BAND = 28
export const PIE_RADIUS = 74
/** Least distance between neighbouring slots' centers. */
const SLOT_GAP = 58
/** Movement under this picks nothing: it's a tap, or a hand at rest. */
export const DEAD_ZONE = 16
/**
 * The band keeps this far from the display's edges. Nothing hangs outside it (the hub names the
 * slot aimed at), so this only leaves a little of its shadow on screen.
 */
const EDGE = 12
/** The hub (the inner disc) stops this far inside the band. */
const HUB_INSET = 5
/** Clicks this far past the band still hit a slot. */
const OUTER_SLACK = 10

export const innerRadius = (ring: Ring) => ring.radius - PIE_BAND
export const outerRadius = (ring: Ring) => ring.radius + PIE_BAND
export const hubRadius = (ring: Ring) => innerRadius(ring) - HUB_INSET

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

/**
 * A full ring of `count` slots around `at`, the first at `start` (up by default). Near a screen
 * edge it moves inward, so every slot keeps its direction.
 */
export function layoutRing(at: Point, stage: { width: number; height: number }, count: number, start = -Math.PI / 2): Ring {
  const step = (2 * Math.PI) / count
  const radius = Math.max(PIE_RADIUS, SLOT_GAP / step)
  const slots = Array.from({ length: count }, (_, i) => {
    const angle = start + i * step
    return { angle, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })
  const reach = radius + PIE_BAND + EDGE
  const center = {
    x: clamp(at.x, reach, stage.width - reach),
    y: clamp(at.y, reach, stage.height - reach),
  }
  const shifted = Math.abs(center.x - at.x) > 0.5 || Math.abs(center.y - at.y) > 0.5
  return { slots, radius, step, center, shifted }
}

/**
 * A sub-pie around `at`. Its last slot (back) points at the parent pie's center, so going back
 * reverses the move that opened it.
 */
export function layoutSubRing(at: Point, stage: { width: number; height: number }, count: number, parent: Point): Ring {
  // The center doesn't depend on where the slots start
  const { center, step } = layoutRing(at, stage, count)
  const back = center.x === parent.x && center.y === parent.y
    ? Math.PI / 2
    : Math.atan2(parent.y - center.y, parent.x - center.x)
  return layoutRing(at, stage, count, back - (count - 1) * step)
}

/** The slot in the direction of (dx, dy), or nothing inside the dead zone. */
export function slotToward(ring: Ring, dx: number, dy: number): number | null {
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null
  const angle = Math.atan2(dy, dx)
  let best = 0
  let bestDiff = Infinity
  ring.slots.forEach((slot, i) => {
    const diff = Math.abs(wrapAngle(angle - slot.angle))
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  })
  return best
}

export type PieHit = { kind: 'hub' } | { kind: 'slot'; index: number } | { kind: 'outside' }

/** What a click at `p` (window coordinates) lands on. */
export function hitTest(ring: Ring, p: Point): PieHit {
  const dx = p.x - ring.center.x
  const dy = p.y - ring.center.y
  const distance = Math.hypot(dx, dy)
  if (distance <= hubRadius(ring)) return { kind: 'hub' }
  if (distance > outerRadius(ring) + OUTER_SLACK) return { kind: 'outside' }
  const index = slotToward(ring, dx, dy)
  return index === null ? { kind: 'hub' } : { kind: 'slot', index }
}

const ARROWS: Record<string, number> = { ArrowUp: -Math.PI / 2, ArrowRight: 0, ArrowDown: Math.PI / 2, ArrowLeft: Math.PI }

/** The slot nearest an arrow key's direction, or null for another key. */
export function slotForArrow(ring: Ring, key: string): number | null {
  const toward = ARROWS[key]
  if (toward === undefined) return null
  return ring.slots.reduce((best, slot, i) =>
    (Math.abs(wrapAngle(slot.angle - toward)) < Math.abs(wrapAngle(ring.slots[best].angle - toward)) ? i : best), 0)
}

const svgPoint = (angle: number, r: number) => `${(Math.cos(angle) * r).toFixed(2)} ${(Math.sin(angle) * r).toFixed(2)}`

/** A ring segment with a `gap` px gap on both sides, as wide at both radii. */
export function segmentPath(center: number, half: number, inner: number, outer: number, gap: number): string {
  const o = gap / 2 / outer
  const i = gap / 2 / inner
  return [
    `M ${svgPoint(center - half + o, outer)}`,
    `A ${outer} ${outer} 0 0 1 ${svgPoint(center + half - o, outer)}`,
    `L ${svgPoint(center + half - i, inner)}`,
    `A ${inner} ${inner} 0 0 0 ${svgPoint(center - half + i, inner)}`,
    'Z',
  ].join(' ')
}

/** An arc of radius `r` from `from` to `to` (clockwise), for the hub's aim notch. */
export function arcPath(r: number, from: number, to: number): string {
  return `M ${svgPoint(from, r)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${svgPoint(to, r)}`
}
