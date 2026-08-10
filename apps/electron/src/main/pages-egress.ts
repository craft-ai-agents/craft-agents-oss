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

/** The slice of Electron's Session this module needs. Kept minimal so the
 *  policy is testable without importing electron. */
export interface EgressCapableSession {
  webRequest: {
    onBeforeRequest: (
      fn: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void,
    ) => void
  }
}

/**
 * Create the pages session AND attach the deny-list, in one step.
 *
 * Creation is deliberately part of this function rather than taking a session
 * as a parameter: attaching a default-deny egress filter to `defaultSession`
 * would cancel every request the ENTIRE APP makes — the RPC socket, model
 * calls, OAuth, updates. Owning the `fromPartition` call means a caller cannot
 * hand in the wrong session by mistake.
 *
 * `getPagesOrigin` is a callback rather than a value because the port is
 * resolved at runtime and can change if the preferred one is taken — capturing
 * it once would pin a stale origin and block the real one.
 *
 * IMPORTANT — where this does and does not apply. An `<iframe>` in the renderer
 * runs in the MAIN WINDOW's session (there is no per-iframe partition, and
 * `webviewTag` is false), so this policy does NOT cover the planned in-app
 * iframe surface. For that path the wrapper's `frame-src 'self'` is the
 * control, which WS0 measured as effective in both Chromium and WebKit. This
 * session is for surfaces we can actually place in a partition — a dedicated
 * `WebContentsView`/`BrowserWindow` — which is the open WS5 decision.
 */
export function createPagesSession<T extends EgressCapableSession>(
  sessionFactory: (partition: string) => T,
  getPagesOrigin: () => string | null,
  onBlocked?: (url: string) => void,
): T {
  const ses = sessionFactory(CRAFT_PAGES_SESSION_PARTITION)
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (isPagesEgressAllowed(details.url, getPagesOrigin())) {
      callback({ cancel: false })
      return
    }
    onBlocked?.(details.url)
    callback({ cancel: true })
  })
  return ses
}
