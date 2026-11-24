/**
 * Crafty (spike): the double-tap trigger's rules, fed with the input addon's modifier changes
 * (`crafty-native/protocol.ts`, `InputEvent` of type `flags`). Pure, so it's unit-tested, and the
 * playground could feed it DOM key events.
 *
 * A double-tap is the trigger key (left ⌘, ⌥ or ⌃) pressed twice:
 * - the first press is a tap, shorter than `TAP_MAX_MS`;
 * - the second press starts within `GAP_MAX_MS` of the first release;
 * - no other modifier is held;
 * - no key press or click came since the first press, so a quick ⌘C ⌘V never counts. The addon
 *   doesn't watch keys for this: each event says when the last key press and click happened.
 *
 * The second press fires `press` at once, so Crafty opens while the key is still down, and its
 * release fires `release`. Whether that was a tap (the pie stays open) or a hold-flick-release (a
 * pick) is for the pie to say, from where the pointer is.
 */

export type TriggerKey = 'command' | 'option' | 'control'

interface KeySpec {
  keyCode: number
  /** IOKit's device-dependent bit for this side's key (NX_DEVICEL*KEYMASK). */
  deviceMask: number
  /** The same modifier on the right. */
  twinDeviceMask: number
  /** The device-independent CGEventFlags bit. */
  flagMask: number
}

/** Left keys only: right ⌥ types characters on many layouts, and the left key is under the thumb. */
const KEYS: Record<TriggerKey, KeySpec> = {
  command: { keyCode: 55, deviceMask: 0x08, twinDeviceMask: 0x10, flagMask: 0x100000 },
  option: { keyCode: 58, deviceMask: 0x20, twinDeviceMask: 0x40, flagMask: 0x080000 },
  control: { keyCode: 59, deviceMask: 0x01, twinDeviceMask: 0x2000, flagMask: 0x040000 },
}

/** Shift, Control, Option, Command and Fn (device independent). Caps Lock doesn't count. */
const MODIFIER_FLAGS = 0x020000 | 0x040000 | 0x080000 | 0x100000 | 0x800000
/** Every NX_DEVICE*KEYMASK bit. Some virtual keyboards set none of them. */
const DEVICE_MASKS = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x40 | 0x2000

export const TAP_MAX_MS = 200
export const GAP_MAX_MS = 300

export interface ModifierChange {
  keyCode: number
  flags: number
  /** Monotonic ms. */
  at: number
  /** Since the last key press and the last click, when this change happened. */
  sinceKeyMs: number
  sinceClickMs: number
}

export type TriggerState =
  | { phase: 'idle' }
  | { phase: 'first-down'; downAt: number }
  | { phase: 'first-up'; downAt: number; upAt: number }
  | { phase: 'held'; downAt: number }

export type TriggerOutput =
  | { type: 'press' }
  /** `interrupted`: a key press or click came while the key was held (a ⌘ shortcut, not the pie). */
  | { type: 'release'; heldMs: number; interrupted: boolean }

export const TRIGGER_IDLE: TriggerState = { phase: 'idle' }

function isDown(flags: number, key: KeySpec): boolean {
  if ((flags & key.flagMask) === 0) return false
  // The device bits tell left from right; without any, trust the key code
  return (flags & DEVICE_MASKS) === 0 || (flags & key.deviceMask) !== 0
}

function othersHeld(flags: number, key: KeySpec): boolean {
  return (flags & MODIFIER_FLAGS & ~key.flagMask) !== 0 || (flags & key.twinDeviceMask) !== 0
}

/** No key press or click since `since` (same clock as `change.at`). */
function quietSince(change: ModifierChange, since: number): boolean {
  const elapsed = change.at - since
  return change.sinceKeyMs > elapsed && change.sinceClickMs > elapsed
}

export function reduceTrigger(
  state: TriggerState,
  change: ModifierChange,
  triggerKey: TriggerKey,
): { state: TriggerState; output: TriggerOutput | null } {
  const key = KEYS[triggerKey]
  const isKey = change.keyCode === key.keyCode
  const down = isKey && isDown(change.flags, key)
  const alone = !othersHeld(change.flags, key)

  switch (state.phase) {
    case 'idle':
      return { state: down && alone ? { phase: 'first-down', downAt: change.at } : state, output: null }

    case 'first-down':
      if (isKey && !down && change.at - state.downAt <= TAP_MAX_MS && quietSince(change, state.downAt)) {
        return { state: { phase: 'first-up', downAt: state.downAt, upAt: change.at }, output: null }
      }
      // Held too long, a shortcut, or another modifier joined in
      return { state: TRIGGER_IDLE, output: null }

    case 'first-up':
      if (down && alone) {
        if (change.at - state.upAt <= GAP_MAX_MS && quietSince(change, state.downAt)) {
          return { state: { phase: 'held', downAt: change.at }, output: { type: 'press' } }
        }
        // Too late for this pair, but it may be the first tap of the next one
        return { state: { phase: 'first-down', downAt: change.at }, output: null }
      }
      return { state: TRIGGER_IDLE, output: null }

    case 'held':
      if (isKey && !down) {
        return {
          state: TRIGGER_IDLE,
          output: { type: 'release', heldMs: change.at - state.downAt, interrupted: !quietSince(change, state.downAt) },
        }
      }
      // Another modifier pressed while held doesn't end the hold
      return { state, output: null }
  }
}

/** For Settings: the trigger key as macOS draws it. */
export const TRIGGER_KEY_SYMBOLS: Record<TriggerKey, string> = { command: '⌘', option: '⌥', control: '⌃' }
