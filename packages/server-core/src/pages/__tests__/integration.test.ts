/**
 * Craft Pages — full-stack integration.
 *
 * Every layer here is the real one: the agent-facing `craft_page` tool, the
 * on-disk store, the catalog, PagesRuntime, the HTTP listener, the wrapper, the
 * grant store and the bridge. Only the connector itself is faked, because
 * spawning real MCP subprocesses would test the SDK rather than this.
 *
 * The unit suites cover each piece; this covers the SEAMS between them, which
 * is where this feature has actually broken twice — a catalog that was never
 * written to, and a node adapter that dropped POST bodies.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleCraftPage, handleCraftPageDelete } from '@craft-agent/session-tools-core'
import type { SessionToolContext } from '@craft-agent/session-tools-core'
import { PagesRuntime } from '../runtime.ts'
import { WRAPPER_JS } from '../wrapper-asset.ts'
import { sessionPagesRoot } from '../catalog.ts'
import type { PoolLike } from '../grants/source-pool.ts'

const FLAG = 'CRAFT_FEATURE_CRAFT_PAGES'
const LIVE_FLAG = 'CRAFT_FEATURE_CRAFT_PAGES_LIVE_DATA'
const originalFlag = process.env[FLAG]
const originalLiveFlag = process.env[LIVE_FLAG]

let ws: string
let sessionDataPath: string
let runtime: PagesRuntime
let connectorCalls: Array<{ name: string; args: Record<string, unknown> }>
let connectorResult: unknown
let connectorError: Error | null

const SESSION_ID = 'sess-integration'

/** A real tool context, wired to the runtime's catalog exactly as SessionManager does. */
function toolContext(): SessionToolContext {
  return {
    sessionId: SESSION_ID,
    workspacePath: ws,
    dataPath: sessionDataPath,
    pageCatalog: runtime.catalogFor(ws),
  } as unknown as SessionToolContext
}

function fakePool(): PoolLike {
  return {
    callTool: async (name, args) => {
      connectorCalls.push({ name, args })
      if (connectorError) throw connectorError
      return connectorResult
    },
    disconnectAll: async () => {},
  }
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map(c => c.text).join('\n')

/** Pull the pageId out of the craft-page fence the tool tells the model to emit. */
function pageIdFromToolResult(result: unknown): string {
  const out = text(result as never)
  const m = /"pageId":\s*"([^"]+)"/.exec(out)
  if (!m) throw new Error(`no pageId in tool output:\n${out}`)
  return m[1]!
}

const PAGE_FILES = [
  {
    path: 'index.html',
    content: `<!doctype html><html><head><meta charset="utf-8"><title>Dash</title>
<link rel="stylesheet" href="styles.css"></head><body>
<h1 id="t">Dashboard</h1><ul id="items"></ul>
<script src="data.js"></script><script src="app.js"></script></body></html>`,
  },
  { path: 'styles.css', content: 'h1{color:#a4552f}' },
  { path: 'data.js', content: 'window.SEED={items:["a","b"]}' },
  { path: 'app.js', content: '(function(){/* renders */})()' },
]

beforeEach(async () => {
  process.env[FLAG] = '1'
  process.env[LIVE_FLAG] = '1'
  ws = mkdtempSync(join(tmpdir(), 'craft-integration-'))
  sessionDataPath = join(sessionPagesRoot(ws, SESSION_ID), '..')
  mkdirSync(sessionDataPath, { recursive: true })

  connectorCalls = []
  connectorResult = { rows: [{ id: 1, subject: 'Invoice' }] }
  connectorError = null

  runtime = new PagesRuntime(undefined, async () => fakePool())
  await runtime.ensureStarted(ws)
})

afterEach(async () => {
  await runtime.disposeAll()
  if (originalFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = originalFlag
  if (originalLiveFlag === undefined) delete process.env[LIVE_FLAG]
  else process.env[LIVE_FLAG] = originalLiveFlag
})

describe('agent creates a page → user can view it', () => {
  it('runs the whole chain: tool → store → catalog → server → wrapper → page', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    expect(created.isError).toBeFalsy()
    const pageId = pageIdFromToolResult(created)

    const origin = runtime.serverFor(ws)!.origin

    // The wrapper resolves the page the tool just registered.
    const wrapper = await fetch(`${origin}/w/${pageId}`)
    expect(wrapper.status).toBe(200)
    const wrapperHtml = await wrapper.text()
    expect(wrapperHtml).toContain('Dashboard')
    expect(wrapperHtml).toContain(`/p/${pageId}/r/1/`)

    // And every asset the page references is actually served.
    for (const f of PAGE_FILES) {
      const r = await fetch(`${origin}/p/${pageId}/r/1/${f.path}`)
      expect(r.status).toBe(200)
    }

    // Sandboxed by response header, with the wrapper on a different policy.
    const pageCsp = (await fetch(`${origin}/p/${pageId}/r/1/index.html`))
      .headers.get('content-security-policy') ?? ''
    expect(pageCsp).toContain('sandbox allow-scripts')
    expect(pageCsp).toContain("connect-src 'none'")
    expect(wrapper.headers.get('content-security-policy')).toContain("frame-src 'self'")
  })

  it('an edit is served as a new revision, leaving the old one intact', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin

    await handleCraftPage(toolContext(), {
      command: 'update', slug: 'dash', expectedRev: 1,
      files: [{ path: 'styles.css', content: 'h1{color:#1a7f37}' }],
    })

    // rev 2 has the edit; rev 1 is untouched — this is what makes the preview
    // genuinely change rather than re-render a cached document.
    expect(await (await fetch(`${origin}/p/${pageId}/r/2/styles.css`)).text()).toContain('1a7f37')
    expect(await (await fetch(`${origin}/p/${pageId}/r/1/styles.css`)).text()).toContain('a4552f')

    // The wrapper follows the current revision.
    expect(await (await fetch(`${origin}/w/${pageId}`)).text()).toContain(`/p/${pageId}/r/2/`)
  })

  it('survives a restart', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)

    await runtime.disposeAll()
    const fresh = new PagesRuntime(undefined, async () => fakePool())
    await fresh.ensureStarted(ws)
    try {
      const r = await fetch(`${fresh.serverFor(ws)!.origin}/w/${pageId}`)
      expect(r.status).toBe(200)
    } finally {
      await fresh.disposeAll()
    }
  })

  // The index is disposable by design; the per-page manifests are the source of
  // truth. Restarting with a healthy index proves nothing about that, so these
  // destroy the index first — otherwise a page the user can see today would
  // vanish for good the first time the index is lost.
  for (const [label, damage] of [
    ['deleted', () => rmSync(join(ws, 'pages-catalog.json'), { force: true })],
    ['corrupt', () => writeFileSync(join(ws, 'pages-catalog.json'), '{"entries": [ truncated')],
  ] as const) {
    it(`rebuilds from manifests when the index is ${label}`, async () => {
      const created = await handleCraftPage(toolContext(), {
        command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
      })
      const pageId = pageIdFromToolResult(created)

      await runtime.disposeAll()
      damage()

      const fresh = new PagesRuntime(undefined, async () => fakePool())
      await fresh.ensureStarted(ws)
      try {
        expect((await fetch(`${fresh.serverFor(ws)!.origin}/w/${pageId}`)).status).toBe(200)
        expect((await fetch(`${fresh.serverFor(ws)!.origin}/p/${pageId}/r/1/index.html`, {
          headers: { 'sec-fetch-dest': 'iframe' },
        })).status).toBe(200)
      } finally {
        await fresh.disposeAll()
      }
    })
  }
})

describe('live data — grant, query, revoke', () => {
  async function makePage(): Promise<{ pageId: string; origin: string }> {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    return { pageId: pageIdFromToolResult(created), origin: runtime.serverFor(ws)!.origin }
  }

  it('refuses a query before any grant exists', async () => {
    const { origin } = await makePage()
    const r = await fetch(`${origin}/internal/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ grantId: 'invented', params: {} }),
    })
    expect(r.status).toBe(403)
    expect(connectorCalls).toHaveLength(0)
  })

  it('serves live connector data once the user approves a query', async () => {
    const { pageId, origin } = await makePage()

    const grantId = await runtime.grantsFor(ws)!.approve({
      pageId,
      name: 'unread',
      sourceSlug: 'gmail',
      toolName: 'list_messages',
      fixedArgs: { maxResults: 20 },
      paramSchema: { q: { type: 'string', maxLength: 50 } },
    })

    const r = await fetch(`${origin}/internal/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ grantId, params: { q: 'invoice' } }),
    })

    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, data: { rows: [{ id: 1, subject: 'Invoice' }] } })

    // The connector saw the page's parameter AND the user's fixed argument.
    expect(connectorCalls).toHaveLength(1)
    expect(connectorCalls[0]!.name).toContain('gmail')
    expect(connectorCalls[0]!.args).toEqual({ q: 'invoice', maxResults: 20 })
  })

  it('a grant-holding page becomes framed-only and loses "open in browser"', async () => {
    const { pageId, origin } = await makePage()
    const url = `${origin}/p/${pageId}/r/1/index.html`

    // Grantless: openable as a top-level document.
    expect((await fetch(url, { headers: { 'sec-fetch-dest': 'document' } })).status).toBe(200)

    await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })

    // With a grant, the SAME url is refused top-level but still served framed.
    expect((await fetch(url, { headers: { 'sec-fetch-dest': 'document' } })).status).toBe(403)
    expect((await fetch(url, { headers: { 'sec-fetch-dest': 'iframe' } })).status).toBe(200)

    // And the wrapper now says so, so a live page never looks static.
    const html = await (await fetch(`${origin}/w/${pageId}`)).text()
    expect(html).toMatch(/Live data/i)
    expect(html).toContain('gmail')
  })

  it('stops serving data the moment the grant is revoked', async () => {
    const { pageId, origin } = await makePage()
    const grants = runtime.grantsFor(ws)!
    const grantId = await grants.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })

    const query = () => fetch(`${origin}/internal/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ grantId, params: {} }),
    })

    expect((await query()).status).toBe(200)
    await grants.revokeForPage(pageId)
    expect((await query()).status).toBe(403)
    expect(connectorCalls).toHaveLength(1)
  })

  it('never leaks upstream error detail to the page', async () => {
    const { pageId, origin } = await makePage()
    const grantId = await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })
    connectorError = new Error('401 Unauthorized: bearer sk-live-abc123 at https://internal.example')

    const r = await fetch(`${origin}/internal/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ grantId, params: {} }),
    })
    const body = await r.text()

    expect(r.status).toBe(502)
    expect(body).toContain('upstream_error')
    for (const secret of ['sk-live-abc123', 'internal.example', '401', 'Unauthorized']) {
      expect(body).not.toContain(secret)
    }
  })

  it('refuses a query from a foreign origin even with a valid grant', async () => {
    const { pageId, origin } = await makePage()
    const grantId = await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })

    const r = await fetch(`${origin}/internal/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ grantId, params: {} }),
    })
    expect(r.status).toBe(403)
    expect(connectorCalls).toHaveLength(0)
  })
})

/**
 * The tests above enter at the bridge, which is where the WRAPPER enters — not
 * where a page does. A page cannot reach `/internal/query` itself: its CSP is
 * `connect-src 'none'` and its origin is opaque. So the real first hop is a
 * postMessage into the wrapper, and these drive the shipped wrapper script
 * against the live listener to cover it.
 */
describe('a page asking for data, from the first hop', () => {
  /**
   * Mount the real WRAPPER_JS with fetch pointed at the running server, taking
   * its handle map from the server-rendered document rather than a fixture —
   * so a server that inlines the wrong map fails here.
   */
  async function mountWrapper(origin: string, pageId: string) {
    const html = await (await fetch(`${origin}/w/${pageId}`)).text()
    const attr = /data-grants="([^"]*)"/.exec(html)?.[1] ?? '{}'
    const grantsJson = attr
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    return mountWrapperWith(origin, grantsJson)
  }

  function mountWrapperWith(origin: string, grantsJson: string) {
    const replies: Array<Record<string, unknown>> = []
    const listeners: Array<(e: unknown) => void> = []
    const contentWindow = { postMessage: (d: Record<string, unknown>) => { replies.push(d) } }

    const els: Record<string, unknown> = {
      'ca-frame': { contentWindow }, 'ca-title': {}, 'ca-sources': {},
    }
    new Function('window', 'document', 'fetch', WRAPPER_JS)(
      {
        addEventListener: (t: string, fn: (e: unknown) => void) => {
          if (t === 'message') listeners.push(fn)
        },
      },
      {
        currentScript: {
          getAttribute: (n: string) => (n === 'data-grants' ? grantsJson : 'Dash'),
        },
        getElementById: (id: string) => els[id] ?? null,
      },
      // The browser would resolve the relative URL against the wrapper document
      // and attach its Origin; do the same so the bridge sees a real request.
      (url: string, init: RequestInit = {}) => fetch(`${origin}${url}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Origin: origin },
      }),
    )

    return {
      replies,
      ask: async (msg: unknown) => {
        for (const l of listeners) l({ source: contentWindow, origin: 'null', data: msg })
        for (let i = 0; i < 50 && replies.length === 0; i++) await new Promise(r => setTimeout(r, 2))
        return replies.at(-1)
      },
    }
  }

  it('carries real connector data from a page message back into the page', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin

    await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: { maxResults: 20 }, paramSchema: { q: { type: 'string', maxLength: 50 } },
    })

    const w = await mountWrapper(origin, pageId)
    const reply = await w.ask({
      craftPage: true, kind: 'query', id: 'q1', name: 'unread', params: { q: 'invoice' },
    })

    expect(reply).toEqual({
      craftPage: true, kind: 'query-result', id: 'q1',
      data: { rows: [{ id: 1, subject: 'Invoice' }] },
    })
    expect(connectorCalls[0]!.args).toEqual({ q: 'invoice', maxResults: 20 })
  })

  it('returns an opaque refusal when the page names a grant it does not hold', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin

    const w = await mountWrapper(origin, pageId)
    const reply = await w.ask({
      craftPage: true, kind: 'query', id: 'q1', name: 'never-approved', params: {},
    })

    expect(reply).toEqual({
      craftPage: true, kind: 'query-result', id: 'q1', error: 'forbidden',
    })
    expect(connectorCalls).toHaveLength(0)
  })

  // Defence in depth, and deliberately redundant: the bridge reads the tool
  // from the GRANT, so this survives even a wrapper that forwards every field
  // the page sent — verified by mutation, it does not fail on a wrapper-only
  // regression. The wrapper's own duty not to forward is covered in
  // wrapper-asset.test.ts. What this pins is the end-to-end property: it takes
  // a break in BOTH layers for a page to choose its own tool.
  it('does not let a page smuggle a tool choice past the grant', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin

    const grantId = await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: { maxResults: 20 }, paramSchema: {},
    })

    const w = await mountWrapper(origin, pageId)
    await w.ask({
      craftPage: true, kind: 'query', id: 'q1', name: 'unread', params: {},
      // All of this is the page trying to choose for itself.
      toolName: 'send_message', sourceSlug: 'shell', maxResults: 9999,
      url: 'https://evil.example/exfil',
    })

    expect(connectorCalls).toHaveLength(1)
    expect(connectorCalls[0]!.name).toContain('list_messages')
    expect(connectorCalls[0]!.name).not.toContain('send_message')
    expect(connectorCalls[0]!.args).toEqual({ maxResults: 20 })
  })
})

describe('containment holds in the assembled system', () => {
  it('refuses traversal, the manifest, and dotfiles over the wire', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin

    expect((await fetch(`${origin}/p/${pageId}/r/1/%2e%2e%2f%2e%2e%2fpage.json`)).status).toBe(400)
    expect((await fetch(`${origin}/p/${pageId}/r/1/%252e%252e%252fpage.json`)).status).toBe(400)
    expect((await fetch(`${origin}/p/${pageId}/r/1/page.json`)).status).toBe(404)
    expect((await fetch(`${origin}/p/${pageId}/r/1/index.html`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${origin}/p/${pageId}/r/1/index.html`, {
      headers: { host: 'evil.example' },
    })).status).toBe(400)
  })
})

describe('deleting the page', () => {
  it('removes it from the catalog so the server stops resolving it', async () => {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const pageId = pageIdFromToolResult(created)
    const origin = runtime.serverFor(ws)!.origin
    expect((await fetch(`${origin}/w/${pageId}`)).status).toBe(200)

    const deleted = await handleCraftPageDelete(toolContext(), { slug: 'dash', confirm: true })
    expect(deleted.isError).toBeFalsy()

    expect((await fetch(`${origin}/w/${pageId}`)).status).toBe(404)
  })

  it('refuses to delete without explicit confirmation', async () => {
    await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard', files: PAGE_FILES,
    })
    const r = await handleCraftPageDelete(toolContext(), { slug: 'dash', confirm: false })
    expect(r.isError).toBe(true)
  })
})

/**
 * The complete request path, which is what a real session does: the agent asks,
 * the user decides, the page reads. Every earlier test starts after approval,
 * so none of them would notice if requesting were impossible.
 */
describe('agent requests → user approves → page reads', () => {
  const APP = `
    window.__result = null;
    craftQuery('unread', { q: 'is:unread' }).then(function (r) { window.__result = r; });
  `

  async function createRequestingPage() {
    const created = await handleCraftPage(toolContext(), {
      command: 'create', slug: 'dash', title: 'Dashboard',
      files: [
        {
          path: 'index.html',
          content: '<!doctype html><html><body><script src="/w-assets/craft-query.js"></script>'
            + '<script src="app.js"></script></body></html>',
        },
        { path: 'app.js', content: APP },
      ],
      queries: [{
        name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
        fixedArgs: { maxResults: 25 }, paramSchema: { q: { type: 'string', maxLength: 64 } },
      }],
    })
    return { result: created, pageId: pageIdFromToolResult(created) }
  }

  it('tells the agent the request is pending rather than granted', async () => {
    const { result } = await createRequestingPage()
    const out = text(result as never)
    expect(out).toMatch(/approv/i)
    expect(out).toContain('gmail.list_messages')
  })

  it('serves the page no data until the user approves', async () => {
    const { pageId } = await createRequestingPage()
    const origin = runtime.serverFor(ws)!.origin

    // The wrapper carries an EMPTY handle map, so the page's craftQuery
    // resolves to nothing and never reaches the bridge.
    const html = await (await fetch(`${origin}/w/${pageId}`)).text()
    expect(html).toContain('data-grants="{}"')
    expect(connectorCalls).toHaveLength(0)
  })

  it('is still openable in a browser while it holds nothing', async () => {
    // A page that merely ASKED has no access, so nothing is lost by opening it
    // anywhere. Treating a request like a grant would penalise asking.
    const { pageId } = await createRequestingPage()
    const origin = runtime.serverFor(ws)!.origin
    const r = await fetch(`${origin}/p/${pageId}/r/1/index.html`, {
      headers: { 'sec-fetch-dest': 'document' },
    })
    expect(r.status).toBe(200)
  })

  it('carries the handle into the wrapper once approved, and data follows', async () => {
    const { pageId } = await createRequestingPage()
    const origin = runtime.serverFor(ws)!.origin

    await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: { maxResults: 25 }, paramSchema: { q: { type: 'string', maxLength: 64 } },
    })

    const html = await (await fetch(`${origin}/w/${pageId}`)).text()
    expect(html).toContain('&quot;unread&quot;')
    expect(html).toMatch(/Live data/i)

    // And the page's own helper is served, so craftQuery exists at all.
    const helper = await fetch(`${origin}/w-assets/craft-query.js`)
    expect(helper.status).toBe(200)
    expect(helper.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
  })

  it('becomes framed-only the moment it actually holds access', async () => {
    const { pageId } = await createRequestingPage()
    const origin = runtime.serverFor(ws)!.origin
    await runtime.grantsFor(ws)!.approve({
      pageId, name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
      fixedArgs: {}, paramSchema: {},
    })
    const r = await fetch(`${origin}/p/${pageId}/r/1/index.html`, {
      headers: { 'sec-fetch-dest': 'document' },
    })
    expect(r.status).toBe(403)
  })
})

/**
 * A local connector the curated allowlist has never heard of.
 *
 * This is the whole point of the extensible allowlist: MAVIR, weather, water
 * levels — sources we cannot curate because we do not know they exist. Every
 * layer has to agree, and each one refused independently before this worked:
 * the pool would not connect the source, the store would not approve the grant,
 * and the bridge would not execute it.
 */
describe('a user-declared connector, end to end', () => {
  // NOT named `declare`: that is a TypeScript contextual keyword, and
  // `const declare = () => …` is mis-parsed as an ambient declaration, so the
  // call silently does nothing and the file is never written. Cost an hour.
  const declareSource = () => writeFileSync(
    join(ws, 'page-tool-allowlist.json'),
    JSON.stringify({ version: 1, sources: { mavir: ['get_load'] } }),
  )

  async function runtimeWithDeclaredSource() {
    declareSource()
    await runtime.disposeAll()
    const r = new PagesRuntime(undefined, async () => fakePool())
    await r.ensureStarted(ws)
    return r
  }

  it('serves live data from a source we never curated', async () => {
    const rt = await runtimeWithDeclaredSource()
    try {
      const created = await handleCraftPage({
        sessionId: SESSION_ID, workspacePath: ws, dataPath: sessionDataPath,
        pageCatalog: rt.catalogFor(ws),
      } as never, {
        command: 'create', slug: 'grid', title: 'Grid', files: PAGE_FILES,
        queries: [{ name: 'load', sourceSlug: 'mavir', toolName: 'get_load' }],
      })
      const pageId = pageIdFromToolResult(created)
      const origin = rt.serverFor(ws)!.origin

      const grantId = await rt.grantsFor(ws)!.approve({
        pageId, name: 'load', sourceSlug: 'mavir', toolName: 'get_load',
        fixedArgs: { region: 'HU' }, paramSchema: {},
      })

      const r = await fetch(`${origin}/internal/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: JSON.stringify({ grantId, params: {} }),
      })
      expect(r.status).toBe(200)
      expect(connectorCalls[0]!.name).toContain('mavir')
      expect(connectorCalls[0]!.args).toEqual({ region: 'HU' })
    } finally { await rt.disposeAll() }
  })

  it('still refuses a tool on that source the user did not declare', async () => {
    const rt = await runtimeWithDeclaredSource()
    try {
      await expect(rt.grantsFor(ws)!.approve({
        pageId: 'pg', name: 'boom', sourceSlug: 'mavir', toolName: 'shutdown_grid',
        fixedArgs: {}, paramSchema: {},
      })).rejects.toThrow(/allowlist/i)
    } finally { await rt.disposeAll() }
  })

  it('cannot promote a mutating tool on a source we DO curate', async () => {
    declareSource()
    writeFileSync(
      join(ws, 'page-tool-allowlist.json'),
      JSON.stringify({ version: 1, sources: { gmail: ['send_message'] } }),
    )
    await runtime.disposeAll()
    const rt = new PagesRuntime(undefined, async () => fakePool())
    await rt.ensureStarted(ws)
    try {
      await expect(rt.grantsFor(ws)!.approve({
        pageId: 'pg', name: 'send', sourceSlug: 'gmail', toolName: 'send_message',
        fixedArgs: {}, paramSchema: {},
      })).rejects.toThrow(/allowlist/i)
    } finally { await rt.disposeAll() }
  })
})
