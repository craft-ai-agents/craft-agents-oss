/**
 * long-press-state — pure helpers for the long-press gesture state machine.
 *
 * Extracted out of `EntityRow` so the boundary conditions (threshold, move
 * tolerance, cancel-after-move precedence) can be unit-tested without
 * mounting React. The consumer drives the actual `setTimeout` / `pointermove`
 * loop; this module just decides _what should happen_ at any given tick.
 *
 * Defaults (`LONG_PRESS_MS`, `MOVE_TOLERANCE_PX`) are tuned for touch: 500ms
 * matches the iOS / Material long-press feel, and 10px leaves enough headroom
 * for a thumb to wobble during pressdown without registering as a drag.
 */

export const LONG_PRESS_MS = 500
export const MOVE_TOLERANCE_PX = 10

export interface PointerCoords {
  x: number
  y: number
}

export interface LongPressDecision {
  /** True if the long-press timer should fire at this tick (gesture succeeded). */
  fire: boolean
  /** True if the gesture should be cancelled (e.g. user dragged past tolerance). */
  cancel: boolean
}

/**
 * Decide what should happen given the pointer's start position, current
 * position, and elapsed time since pointerdown.
 *
 * Rules (in priority order):
 *  1. **Movement past tolerance wins.** If the finger has travelled more than
 *     `tolerancePx` from the start point, the gesture is cancelled regardless
 *     of timer state — the user is scrolling / dragging, not pressing.
 *  2. **Then check the timer.** If elapsed >= `thresholdMs` and movement was
 *     within tolerance, fire the long-press.
 *  3. **Otherwise, keep waiting.** Neither fire nor cancel.
 *
 * Tolerance comparison is **inclusive** (`<= tolerancePx`) so a finger that
 * lands exactly on the boundary still counts as stationary. The squared-
 * distance form avoids a `Math.sqrt` per pointermove tick.
 */
export function shouldFireLongPress(
  start: PointerCoords,
  current: PointerCoords,
  elapsedMs: number,
  thresholdMs: number = LONG_PRESS_MS,
  tolerancePx: number = MOVE_TOLERANCE_PX,
): LongPressDecision {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const distanceSq = dx * dx + dy * dy
  const toleranceSq = tolerancePx * tolerancePx

  if (distanceSq > toleranceSq) {
    return { fire: false, cancel: true }
  }
  if (elapsedMs >= thresholdMs) {
    return { fire: true, cancel: false }
  }
  return { fire: false, cancel: false }
}
