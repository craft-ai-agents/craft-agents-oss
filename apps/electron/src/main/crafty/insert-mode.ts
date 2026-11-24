import type { CraftyInsertMode } from '../../shared/crafty'

/** Inserts up to this long, on one line, are typed; anything else is pasted. */
export const TYPE_MAX_CHARS = 100

/** Slack sends on a typed newline, and `@`/`:` open pickers while typing: always paste there. */
const ALWAYS_PASTE_BUNDLES = new Set(['com.tinyspeck.slackmacgap'])

/**
 * Type short single-line text (the clipboard stays untouched); paste everything else. A typed
 * newline is Enter, which sends the message in Slack, so multi-line text is always pasted, even
 * when typing was asked for.
 */
export function chooseInsertMode(requested: CraftyInsertMode, text: string, bundleId: string | null): 'type' | 'paste' {
  if (/[\r\n]/.test(text)) return 'paste'
  if (requested !== 'auto') return requested
  return text.length <= TYPE_MAX_CHARS && !ALWAYS_PASTE_BUNDLES.has(bundleId ?? '') ? 'type' : 'paste'
}
