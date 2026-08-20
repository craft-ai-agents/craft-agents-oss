/**
 * Global input helpers for omnibox chords when BrowserView holds focus.
 *
 * browser-pane-manager composes isOmniboxChord into pageWc before-input-event
 * and sends IPC 'omnibox:open' to the owning BrowserWindow webContents.
 * Main-window ⌘K continues via renderer ActionRegistry (app.omnibox / mod+k).
 */

export type OmniboxChordInput = {
  type?: string
  key?: string
  meta?: boolean
  control?: boolean
  metaKey?: boolean
  controlKey?: boolean
}

/** True for keyDown + (k/K) + (meta or control) — ⌘K / Ctrl+K. */
export function isOmniboxChord(input: OmniboxChordInput): boolean {
  if (input.type !== 'keyDown') return false
  const key = input.key
  if (key !== 'k' && key !== 'K') return false
  const meta = Boolean(input.meta ?? input.metaKey)
  const control = Boolean(input.control ?? input.controlKey)
  return meta || control
}

type BeforeInputWebContents = {
  on(event: 'before-input-event', cb: (event: { preventDefault(): void }, input: OmniboxChordInput) => void): void
  removeListener?(event: 'before-input-event', cb: (event: { preventDefault(): void }, input: OmniboxChordInput) => void): void
}

/**
 * Attach a before-input-event listener that fires `onMatch` for the omnibox chord.
 * Returns a dispose function.
 */
export function attachOmniboxChordListener(
  wc: BeforeInputWebContents,
  onMatch: () => void,
): () => void {
  const handler = (event: { preventDefault(): void }, input: OmniboxChordInput) => {
    if (!isOmniboxChord(input)) return
    try {
      event.preventDefault()
    } catch {
      /* ignore */
    }
    onMatch()
  }
  wc.on('before-input-event', handler)
  return () => {
    try {
      wc.removeListener?.('before-input-event', handler)
    } catch {
      /* ignore */
    }
  }
}
