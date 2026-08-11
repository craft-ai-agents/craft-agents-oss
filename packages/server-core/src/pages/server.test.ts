/**
 * End-to-end over a real listener. This is the WS0 security matrix turned into
 * a suite that runs in CI, so the properties the trust model depends on are
 * regression-tested rather than remembered.
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { createPage } from '@craft-agent/session-tools-core'
import { PageCatalogService, sessionPagesRoot } from './catalog.ts'
import { startPagesServer, type RunningPagesServer } from './server.ts'

let ws: string
let srv: RunningPagesServer
let pageId: string
let origin: string

beforeAll(async () => {
  ws = mkdtempSync(join(tmpdir(), 'craft-pages-e2e-'))
  const pagesRoot = sessionPagesRoot(ws, 'sess-1')
  mkdirSync(pagesRoot, { recursive: true })

  const created = createPage(pagesRoot, {
    slug: 'demo',
    title: 'Demo Page',
    files: [
      { path: 'index.html', content: '<h1>hello</h1><script src="app.js"></script>' },
      { path: 'app.js', content: 'window.OK = true' },
      { path: 'styles.css', content: 'h1{color:green}' },
      { path: 'assets/logo.png', content: Buffer.from('89504e47', 'hex').toString('base64'), encoding: 'base64' },
      { path: 'en/index.html', content: '<h1>en</h1>' },
    ],
  })
  pageId = created.pageId

  const catalog = new PageCatalogService(ws)
  await catalog.register({ pageId, sessionId: 'sess-1', slug: 'demo', title: 'Demo Page' })

  srv = await startPagesServer({ catalog, workspaceRootPath: ws, port: 0 })
  origin = srv.origin
})

afterAll(async () => { await srv?.close() })

const get = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init)

describe('binding', () => {
  it('binds loopback only — never 0.0.0.0', () => {
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})

describe('serving', () => {
  it('serves the wrapper for a known pageId', async () => {
    const r = await get(`/w/${pageId}`)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('<iframe')
  })

  it('the wrapper iframe carries NO sandbox attribute (ADR 0001 D2)', async () => {
    // With both the attribute and the CSP header, WebKit executes no scripts at
    // all. The header is the only sandbox.
    const html = await (await get(`/w/${pageId}`)).text()
    const iframe = /<iframe[^>]*>/i.exec(html)?.[0] ?? ''
    expect(iframe).not.toContain('sandbox')
  })

  it('serves page files, nested assets, and pretty URLs', async () => {
    expect((await get(`/p/${pageId}/r/1/index.html`)).status).toBe(200)
    expect((await get(`/p/${pageId}/r/1/app.js`)).status).toBe(200)
    expect((await get(`/p/${pageId}/r/1/assets/logo.png`)).status).toBe(200)
    expect((await get(`/p/${pageId}/r/1/`)).status).toBe(200)
    expect((await get(`/p/${pageId}/r/1/en`)).status).toBe(200)
  })

  it('404s an unknown pageId', async () => {
    expect((await get('/w/00000000-0000-0000-0000-000000000000')).status).toBe(404)
    expect((await get('/p/00000000-0000-0000-0000-000000000000/r/1/index.html')).status).toBe(404)
  })
})

describe('CSP', () => {
  it('page content is sandboxed by RESPONSE HEADER', async () => {
    const csp = (await get(`/p/${pageId}/r/1/index.html`)).headers.get('content-security-policy') ?? ''
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it('the wrapper gets a DIFFERENT policy: no sandbox, frame-src self', async () => {
    const csp = (await get(`/w/${pageId}`)).headers.get('content-security-policy') ?? ''
    expect(csp).not.toContain('sandbox')
    // frame-src 'self' is what blocks framed self-navigation off-origin.
    expect(csp).toContain("frame-src 'self'")
    expect(csp).toContain("connect-src 'self'")
  })

  it('does NOT send Cross-Origin-Resource-Policy: same-origin on page content', async () => {
    // REGRESSION. A sandboxed page has an OPAQUE origin, which is never
    // same-origin with anything — so CORP: same-origin makes the browser fetch
    // every subresource and then discard the response. Scripts never execute,
    // styles never apply, and the server log looks perfectly healthy because
    // the requests DID arrive.
    //
    // Found only by loading the page in Chrome; bun's fetch() does not enforce
    // CORP, so the whole suite passed while every real page was blank.
    const corp = (await get(`/p/${pageId}/r/1/index.html`)).headers.get('cross-origin-resource-policy')
    expect(corp).not.toBe('same-origin')
    expect(corp).not.toBe('same-site') // opaque origin is not same-site either
  })

  it('still restricts the trusted wrapper to same-origin', async () => {
    // The wrapper is a normal document on the pages origin, not opaque, so it
    // keeps the stricter policy.
    const corp = (await get(`/w/${pageId}`)).headers.get('cross-origin-resource-policy')
    expect(corp).toBe('same-origin')
  })

  it('sets nosniff, no-referrer and a restrictive permissions policy', async () => {
    const h = (await get(`/p/${pageId}/r/1/index.html`)).headers
    expect(h.get('x-content-type-options')).toBe('nosniff')
    expect(h.get('referrer-policy')).toBe('no-referrer')
    expect(h.get('permissions-policy')).toContain('camera=()')
  })
})

describe('HTTP boundary', () => {
  it('rejects an unexpected Host (DNS rebinding)', async () => {
    const r = await get(`/p/${pageId}/r/1/index.html`, { headers: { host: 'evil.com' } })
    expect(r.status).toBe(400)
  })

  it('rejects non-read methods', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      expect((await get(`/p/${pageId}/r/1/index.html`, { method })).status).toBe(405)
    }
  })

  it('emits no permissive CORS headers', async () => {
    const h = (await get(`/p/${pageId}/r/1/index.html`)).headers
    expect(h.get('access-control-allow-origin')).toBeNull()
  })

  it('the live-data bridge is explicitly unavailable, not silently missing', async () => {
    const r = await get('/internal/query', { method: 'POST' })
    expect(r.status).toBe(404)
    expect(await r.text()).toContain('live_data_unavailable')
  })

  it('forwards a POST body to the bridge', async () => {
    // The node adapter originally read no body at all, because only GET/HEAD
    // reached it. The bridge is a POST, so a body-less forward would make every
    // live-data query look like malformed JSON.
    let seenBody = ''
    const srv2 = await startPagesServer({
      catalog: new PageCatalogService(ws),
      workspaceRootPath: ws,
      port: 0,
      bridge: async (req) => {
        seenBody = await req.text()
        return new Response(JSON.stringify({ echoed: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    try {
      const r = await fetch(`${srv2.origin}/internal/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantId: 'g1', params: { q: 'hello' } }),
      })
      expect(r.status).toBe(200)
      expect(seenBody).toContain('hello')
    } finally {
      await srv2.close()
    }
  })
})

describe('containment over the wire', () => {
  it('rejects encoded and double-encoded traversal', async () => {
    expect((await get(`/p/${pageId}/r/1/%2e%2e%2f%2e%2e%2fpage.json`)).status).toBe(400)
    expect((await get(`/p/${pageId}/r/1/%252e%252e%252fpage.json`)).status).toBe(400)
  })

  it('never serves the manifest', async () => {
    // page.json lives one level above public/, so it is unreachable by design.
    expect((await get(`/p/${pageId}/r/1/page.json`)).status).toBe(404)
  })

  it('does not enumerate directories', async () => {
    expect((await get(`/p/${pageId}/r/1/assets`)).status).toBe(404)
  })

  it('rejects a symlink escape planted inside the page', async () => {
    const pub = join(sessionPagesRoot(ws, 'sess-1'), 'demo', 'revisions', '1', 'public')
    symlinkSync(homedir(), join(pub, 'home'))
    const r = await get(`/p/${pageId}/r/1/home/.craft-agent/credentials.enc`)
    expect(r.status).toBe(400)
  })

  it('rejects a dotfile even when present on disk', async () => {
    const pub = join(sessionPagesRoot(ws, 'sess-1'), 'demo', 'revisions', '1', 'public')
    writeFileSync(join(pub, '.env'), 'SECRET=1')
    expect((await get(`/p/${pageId}/r/1/.env`)).status).toBe(400)
  })
})

describe('grant-holding pages are framed-only (ADR 0001 D6)', () => {
  it('refuses a TOP-LEVEL load but still serves it framed', async () => {
    const catalog2 = new PageCatalogService(ws)
    const srv2 = await startPagesServer({
      catalog: catalog2,
      workspaceRootPath: ws,
      port: 0,
      // Stand in for the grant store: this page holds grants.
      pageHasGrants: async () => true,
      grantedSources: async () => ['gmail'],
    })
    try {
      const base = `${srv2.origin}/p/${pageId}/r/1/index.html`

      // Sec-Fetch-Dest: document is a top-level navigation — refused, because
      // frame-src does not protect a top-level document.
      const top = await fetch(base, { headers: { 'sec-fetch-dest': 'document' } })
      expect(top.status).toBe(403)

      // The same page inside an iframe is fine: that is the supported way to
      // view it, and framing is what supplies the protection.
      const framed = await fetch(base, { headers: { 'sec-fetch-dest': 'iframe' } })
      expect(framed.status).toBe(200)
    } finally {
      await srv2.close()
    }
  })

  it('names the live connectors in the wrapper chrome', async () => {
    // A live-data page must not look identical to a static one.
    const srv2 = await startPagesServer({
      catalog: new PageCatalogService(ws),
      workspaceRootPath: ws,
      port: 0,
      grantedSources: async () => ['gmail', 'linear'],
    })
    try {
      const html = await (await fetch(`${srv2.origin}/w/${pageId}`)).text()
      expect(html).toContain('gmail')
      expect(html).toContain('linear')
      expect(html).toMatch(/Live data/i)
    } finally {
      await srv2.close()
    }
  })

  it('leaves a grantless page openable top-level', async () => {
    const r = await get(`/p/${pageId}/r/1/index.html`, {
      headers: { 'sec-fetch-dest': 'document' },
    })
    expect(r.status).toBe(200)
  })
})
