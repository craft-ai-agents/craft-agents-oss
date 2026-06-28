/**
 * Classification of external URLs for `shell.openExternal`-style handlers.
 *
 * Only explicitly allowed schemes may be opened externally. Unknown custom
 * schemes can trigger arbitrary app handlers on the host OS, so keep this
 * surface narrow and route product deep links separately.
 */

export type UrlClassification =
  | { kind: 'dangerous'; reason: string }
  | { kind: 'internal-deeplink' }
  | { kind: 'safe-external' }

const SAFE_EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
])

const INTERNAL_DEEPLINK_SCHEME = 'craftagents:'

export function classifyExternalUrl(rawUrl: string): UrlClassification {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { kind: 'dangerous', reason: 'empty URL' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { kind: 'dangerous', reason: 'malformed URL' }
  }

  const protocol = parsed.protocol.toLowerCase()

  if (protocol === INTERNAL_DEEPLINK_SCHEME) {
    return { kind: 'internal-deeplink' }
  }

  if (SAFE_EXTERNAL_SCHEMES.has(protocol)) {
    return { kind: 'safe-external' }
  }

  return { kind: 'dangerous', reason: `unsupported scheme "${protocol}"` }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  return classifyExternalUrl(rawUrl).kind === 'safe-external'
}
