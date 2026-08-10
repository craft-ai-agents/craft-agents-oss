/**
 * Craft Pages egress policy and Electron wiring.
 *
 * The decision "may this request leave?" is a pure function so it can be tested
 * without launching Electron. It is the second layer behind the wrapper's
 * frame-src (ADR 0001 D6) and the only control that catches a page loaded as a
 * TOP-LEVEL document, where frame-src does not apply.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CRAFT_PAGES_SESSION_PARTITION,
  isPagesEgressAllowed,
} from '../pages-egress.ts'

const ORIGIN = 'http://127.0.0.1:51234'

describe('isPagesEgressAllowed', () => {
  it('allows the pages origin itself', () => {
    for (const url of [
      `${ORIGIN}/w/abc`,
      `${ORIGIN}/p/abc/r/1/index.html`,
      `${ORIGIN}/p/abc/r/1/assets/logo.png?v=2`,
      `${ORIGIN}/w-assets/wrapper.js`,
    ]) {
      expect(isPagesEgressAllowed(url, ORIGIN)).toBe(true)
    }
  })

  it('blocks every external host', () => {
    for (const url of [
      'https://example.com/',
      'http://example.com/collect?d=SECRET',
      'https://evil.test/x.png',
      'wss://example.com/socket',
    ]) {
      expect(isPagesEgressAllowed(url, ORIGIN)).toBe(false)
    }
  })

  it('blocks loopback on a DIFFERENT port', () => {
    // The exfil target in the WS0 measurement was exactly this shape: same
    // host, different port, which is a different origin and must not be
    // reachable just because it is local.
    expect(isPagesEgressAllowed('http://127.0.0.1:9999/collect?d=SECRET', ORIGIN)).toBe(false)
    expect(isPagesEgressAllowed('http://localhost:9999/x', ORIGIN)).toBe(false)
  })

  it('blocks a userinfo prefix-collision that parses cleanly', () => {
    // THE case a naive startsWith() gets wrong. `http://<origin>@evil.com/x`
    // parses to host evil.com — everything before the "@" is userinfo — yet the
    // string begins with the pages origin verbatim.
    //
    // Mutation-verified: replacing the origin comparison with
    // `url.startsWith(pagesOrigin)` makes THIS assertion fail. The earlier
    // variants of this test did not bite, because
    // `http://127.0.0.1:51234.evil.com` has a non-numeric port and
    // `http://127.0.0.1:512345` a port above 65535, so both are rejected by URL
    // parsing before the origin check is ever reached.
    expect(isPagesEgressAllowed(`${ORIGIN}@evil.com/x`, ORIGIN)).toBe(false)
    expect(isPagesEgressAllowed(`${ORIGIN}@evil.com/collect?d=SECRET`, ORIGIN)).toBe(false)
  })

  it('also blocks malformed hosts that merely start with the origin string', () => {
    // These are rejected by URL parsing rather than the origin comparison —
    // still correct, but they do NOT exercise the origin check.
    expect(isPagesEgressAllowed(`${ORIGIN}.evil.com/x`, ORIGIN)).toBe(false)
    expect(isPagesEgressAllowed('http://127.0.0.1:512345/x', ORIGIN)).toBe(false)
  })

  it('blocks non-http schemes used as exfiltration or execution vectors', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'blob:http://127.0.0.1:51234/uuid',
      'javascript:alert(1)',
      'chrome-extension://abc/x.js',
    ]) {
      expect(isPagesEgressAllowed(url, ORIGIN)).toBe(false)
    }
  })

  it('allows devtools so the pane stays debuggable', () => {
    expect(isPagesEgressAllowed('devtools://devtools/bundled/inspector.html', ORIGIN)).toBe(true)
  })

  it('blocks everything when the origin is not yet known', () => {
    // Fail closed: before the listener has bound there is no legitimate
    // destination, so nothing should be permitted.
    expect(isPagesEgressAllowed(`${ORIGIN}/w/abc`, null)).toBe(false)
    expect(isPagesEgressAllowed('https://example.com', null)).toBe(false)
  })

  it('does not throw on an unparseable URL, and blocks it', () => {
    expect(isPagesEgressAllowed('not a url', ORIGIN)).toBe(false)
    expect(isPagesEgressAllowed('', ORIGIN)).toBe(false)
  })
})

describe('session partition', () => {
  it('is distinct from the browser-pane partition', async () => {
    // Sharing the browser-pane partition would put agent-authored pages in the
    // same cookie/storage jar as every site the agent has browsed.
    const { BROWSER_PANE_SESSION_PARTITION } = await import('../browser-pane-manager.ts')
      .catch(() => ({ BROWSER_PANE_SESSION_PARTITION: 'persist:browser-pane' }))
    expect(CRAFT_PAGES_SESSION_PARTITION).not.toBe(BROWSER_PANE_SESSION_PARTITION)
    expect(CRAFT_PAGES_SESSION_PARTITION).toMatch(/^persist:/)
  })
})

describe('proxy registration', () => {
  it('applies the proxy to the pages partition too', () => {
    // Omitting it silently breaks every corporate-proxy user: pages load
    // nothing and there is no actionable error.
    const src = readFileSync(
      join(import.meta.dir, '..', 'network-proxy.ts'),
      'utf-8',
    )
    expect(src).toContain('CRAFT_PAGES_SESSION_PARTITION')
  })
})

describe('renderer CSP', () => {
  it('permits framing the loopback pages origin', () => {
    // The meta CSP is default-src 'self' with no frame-src, so frame-src falls
    // back to 'self' and the wrapper iframe is blocked outright.
    const html = readFileSync(
      join(import.meta.dir, '..', '..', 'renderer', 'index.html'),
      'utf-8',
    )
    const csp = /content="([^"]*default-src[^"]*)"/i.exec(html)?.[1] ?? ''
    expect(csp).toMatch(/frame-src[^;]*127\.0\.0\.1/)
  })
})
