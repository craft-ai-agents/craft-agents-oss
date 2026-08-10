/**
 * Craft Pages — Electron egress policy.
 *
 * Agent-authored pages get their own session partition with outbound requests
 * default-denied to everything except the pages origin itself.
 *
 * This is the SECOND layer. The primary control is the wrapper's
 * `frame-src 'self'`, which is browser-native and blocks a framed page from
 * navigating itself off-origin (ADR 0001 D6, measured in Chromium and WebKit).
 * But `frame-src` does not apply when a page is loaded as a TOP-LEVEL document,
 * and WS0 measured that a top-level sandboxed page CAN navigate itself to an
 * arbitrary URL — no sandbox flag restricts it and CSP's `navigate-to` was
 * removed from the spec. In Electron this deny-list is what stops that; in a
 * third-party browser nothing does, which is why live-data pages are in-app
 * only.
 *
 * The predicate is exported as a pure function so the policy is testable
 * without launching Electron.
 */

/** Dedicated partition — never the browser-pane one, whose jar holds every site the agent has browsed. */
export const CRAFT_PAGES_SESSION_PARTITION = 'persist:craft-pages'

/**
 * May a request from the pages partition proceed?
 *
 * @param url          request URL
 * @param pagesOrigin  the bound pages origin (e.g. http://127.0.0.1:51234),
 *                     or null before the listener has bound
 */
export function isPagesEgressAllowed(url: string, pagesOrigin: string | null): boolean {
  // Fail closed: with no known destination nothing is legitimate yet.
  if (!pagesOrigin) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // Keep the pane debuggable without punching a hole in the policy.
  if (parsed.protocol === 'devtools:') return true

  // Only plain HTTP to the pages origin. file:, data:, blob:, javascript: and
  // extension schemes are all either exfiltration or execution vectors.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

  // Compare parsed ORIGINS, never string prefixes: a startsWith() check would
  // accept `http://127.0.0.1:51234.evil.com` and `http://127.0.0.1:512345`.
  let allowed: URL
  try {
    allowed = new URL(pagesOrigin)
  } catch {
    return false
  }

  return parsed.origin === allowed.origin
}

/**
 * Attach the deny-list to a session.
 *
 * `getPagesOrigin` is a callback rather than a value because the port is
 * resolved at runtime and can change if the preferred one is taken — capturing
 * it once would pin a stale origin and block the real one.
 */
export function applyPagesEgressPolicy(
  ses: { webRequest: { onBeforeRequest: (fn: (d: { url: string }, cb: (r: { cancel: boolean }) => void) => void) => void } },
  getPagesOrigin: () => string | null,
  onBlocked?: (url: string) => void,
): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (isPagesEgressAllowed(details.url, getPagesOrigin())) {
      callback({ cancel: false })
      return
    }
    onBlocked?.(details.url)
    callback({ cancel: true })
  })
}
