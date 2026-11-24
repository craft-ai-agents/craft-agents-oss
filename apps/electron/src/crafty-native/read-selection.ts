/**
 * The selection read (spike): Accessibility through selection-hook, then Crafty's own ⌘C
 * (`copySelection`, crafty-pasteboard.m) for apps whose selection Accessibility can't read. Pure
 * over its readers, so it's tested without the native modules (host.ts passes the real ones).
 *
 * selection-hook's own ⌘C fallback stays off (host.ts): it returns the clipboard as the selection,
 * without copying, whenever the clipboard changed since the last mouse-down it saw. Crafty never
 * starts selection-hook's input hooks, so it never sees one, and whatever was copied last came back
 * as the selection on every later open.
 */

import type { ClipboardCopy, HostSelection, RawSelection } from './protocol'

/** selection-hook's `SelectionMethod` for a clipboard read; main shows it as 'clipboard'. */
export const METHOD_CLIPBOARD = 99
/** How long the app gets to copy, as selection-hook allowed. */
export const COPY_TIMEOUT_MS = 100
/** selection-hook's marker for a coordinate it doesn't know. */
const UNKNOWN = { x: -99999, y: -99999 }

export interface SelectionReaders {
  /** selection-hook's read, with its clipboard fallback off. */
  accessibility(): RawSelection | null
  /** The input addon's ⌘C, or null when the addon didn't load. */
  copy: ((timeoutMs: number) => ClipboardCopy) | null
  now(): number
}

export function readSelection(readers: SelectionReaders, options: { clipboardFallback: boolean }): HostSelection {
  const started = readers.now()
  const elapsed = () => Math.round((readers.now() - started) * 10) / 10
  const found = readers.accessibility()
  if (found && found.text.trim()) return { selection: found, latencyMs: elapsed(), copy: null }
  if (!options.clipboardFallback || !readers.copy) return { selection: null, latencyMs: elapsed(), copy: null }

  const copy = readers.copy(COPY_TIMEOUT_MS)
  const info = { posted: copy.posted, copied: copy.copied, restored: copy.restored, ms: copy.ms }
  // Only text the app copied just now: nothing on the clipboard from before counts
  if (!copy.copied || !copy.text?.trim()) return { selection: null, latencyMs: elapsed(), copy: info }
  return {
    latencyMs: elapsed(),
    copy: info,
    selection: {
      text: copy.text,
      programName: copy.bundleId ?? '',
      method: METHOD_CLIPBOARD,
      // A copy says nothing about where the text is on screen
      posLevel: 0,
      startTop: UNKNOWN,
      startBottom: UNKNOWN,
      endTop: UNKNOWN,
      endBottom: UNKNOWN,
      mousePosStart: UNKNOWN,
      mousePosEnd: UNKNOWN,
    },
  }
}
