/**
 * Crafty native host protocol (spike): what main (`main/crafty/native-host.ts`) and the utility
 * process (`crafty-native/host.ts`) send each other over the parent port. Types only.
 *
 * - Requests: `{ id, method, params }` in, `{ id, result }` or `{ id, error }` out.
 * - Unrequested, from the host: `{ ready, pid }` once it has started, and `{ input }` for each
 *   event of the input addon's tap.
 */

export type HostMethod =
  | 'getSelection'
  | 'isTrusted'
  | 'requestTrust'
  | 'setClipboardFallback'
  | 'inputStatus'
  | 'startInput'
  | 'stopInput'
  | 'warp'
  | 'focusedEditable'

export interface HostRequest {
  id: number
  method: HostMethod
  params?: Record<string, unknown>
}

export type HostMessage =
  | { ready: true; pid: number }
  | { input: InputEvent }
  | { id: number; result?: unknown; error?: string }

export interface RawPoint {
  x: number
  y: number
}

/** A selection as `getSelection` returns it: the shape selection-hook's JS wrapper produces. */
export interface RawSelection {
  text: string
  programName: string
  /** selection-hook's `SelectionMethod` and `PositionLevel`. */
  method: number
  posLevel: number
  startTop: RawPoint
  startBottom: RawPoint
  endTop: RawPoint
  endBottom: RawPoint
  mousePosStart: RawPoint
  mousePosEnd: RawPoint
  isFullscreen?: boolean
}

/** What `getSelection` answers. `latencyMs`: the whole read, Accessibility and any ⌘C. */
export interface HostSelection {
  selection: RawSelection | null
  latencyMs: number
  /** The ⌘C fallback, when it ran (`ClipboardCopy` without the text). */
  copy: { posted: boolean; copied: boolean; restored: boolean; ms: number } | null
}

/**
 * The input addon's ⌘C (`copySelection`, crafty-pasteboard.m). `text` is what the frontmost app
 * copied (null: nothing, no plain text, or whitespace); `posted`: the ⌘C went out; `copied`: the
 * pasteboard changed in time; `restored`: the previous clipboard is back.
 */
export interface ClipboardCopy {
  text: string | null
  pid: number
  bundleId: string | null
  posted: boolean
  copied: boolean
  restored: boolean
  ms: number
}

/**
 * An event of the input addon's tap (`crafty-input.c`). `at` is a monotonic clock in ms. A `flags`
 * event is one modifier change, with the time since the last key press and click when it happened.
 */
export type InputEvent =
  | { type: 'flags'; keyCode: number; flags: number; at: number; sinceKeyMs: number; sinceClickMs: number }
  /** The tap turned itself back on after macOS disabled it, or stopped because Accessibility was revoked. */
  | { type: 'tap'; state: 're-enabled' | 'stopped-untrusted'; at: number }

export interface InputStatus {
  /** Whether the addon loaded: macOS, and compiled (scripts/build/crafty-input.ts). */
  available: boolean
  /** Why it didn't load. */
  error: string | null
  trusted: boolean
  running: boolean
}

/** The source app's focused element (`focusedEditable`). `error` is the AXError, or null. */
export interface FocusedElement {
  editable: boolean
  role: string | null
  subrole: string | null
  error: number | null
}
