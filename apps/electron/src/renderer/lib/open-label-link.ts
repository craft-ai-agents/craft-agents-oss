/**
 * Open a label's `link`-typed value in the external browser.
 *
 * Link values are stored verbatim — we never rewrite user input at storage
 * time — so a bare host like "example.com" has no scheme. The `shell:openUrl`
 * IPC only accepts http/https/mailto, so scheme-less values get `https://`
 * prepended here, at open time.
 *
 * This is the single owner of that normalization: every label surface
 * (SessionList, ChatDisplay, chat input, value popover) calls it so the
 * prepend logic can't drift between them.
 */
export function openLabelLink(rawValue: string): void {
  const trimmed = rawValue.trim()
  if (!trimmed) return

  // Already carries a protocol (https://, http://, mailto:) → open as-is;
  // otherwise treat it as a bare URL and default to https.
  const hasProtocol = /^[a-z][\w+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('mailto:')
  const url = hasProtocol ? trimmed : `https://${trimmed}`

  void window.electronAPI.openUrl(url).catch((err) => {
    console.error('[openLabelLink] Failed to open URL:', url, err)
  })
}
