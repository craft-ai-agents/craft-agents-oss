/**
 * pages RPC contract, written before the handler exists.
 *
 * The renderer never constructs a page URL itself — the port is chosen at
 * runtime and can move on a conflict, so a URL built client-side would go stale
 * silently. These handlers are the only sanctioned way to get one.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPage } from '@craft-agent/session-tools-core'
import { PagesRuntime } from '../../../pages/runtime.ts'
import { sessionPagesRoot } from '../../../pages/catalog.ts'
import { registerPagesHandlers } from '../pages.ts'

const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
const original = process.env[KEY]

/** Minimal RpcServer stand-in that just captures handlers. */
function fakeServer() {
  const handlers = new Map<string, (ctx: unknown, ...args: any[]) => unknown>()
  return {
    server: { handle: (ch: string, fn: any) => { handlers.set(ch, fn) } } as any,
    call: (ch: string, ...args: unknown[]) => {
      const fn = handlers.get(ch)
      if (!fn) throw new Error(`no handler registered for ${ch}`)
      return fn({}, ...args)
    },
    registered: () => [...handlers.keys()],
  }
}

const deps = (pagesRuntime?: PagesRuntime) => ({
  platform: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
  pagesRuntime,
}) as any

let ws: string
let runtime: PagesRuntime
let pageId: string

beforeEach(async () => {
  process.env[KEY] = '1'
  ws = mkdtempSync(join(tmpdir(), 'craft-rpc-pages-'))
  const pagesRoot = sessionPagesRoot(ws, 'sess-1')
  mkdirSync(pagesRoot, { recursive: true })
  const created = createPage(pagesRoot, {
    slug: 'demo', title: 'Demo',
    files: [{ path: 'index.html', content: '<h1>x</h1>' }],
  })
  pageId = created.pageId
  runtime = new PagesRuntime()
  await runtime.ensureStarted(ws)
  await runtime.catalogFor(ws)!.register({
    pageId, sessionId: 'sess-1', slug: 'demo', title: 'Demo',
  })
})

afterEach(async () => {
  await runtime.disposeAll()
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('registration', () => {
  it('registers both channels', () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    expect(f.registered()).toContain('pages:getUrl')
    expect(f.registered()).toContain('pages:list')
  })
})

describe('pages:getUrl', () => {
  it('returns the wrapper URL for a known page', async () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    const r = await f.call('pages:getUrl', ws, pageId) as { url: string }
    // The wrapper, never /p/* directly: a page loaded top-level loses the
    // frame-src protection that blocks self-navigation exfiltration.
    expect(r.url).toBe(`${runtime.serverFor(ws)!.origin}/w/${pageId}`)
    expect(r.url).not.toContain('/p/')
  })

  it('reports whether the page may be opened outside the app', async () => {
    // ADR 0001 D6: a page holding connector grants must never be loaded as a
    // top-level document, because frame-src — the control that blocks
    // self-navigation exfiltration — does not apply there. A grantless page
    // holds nothing worth exfiltrating and may be opened anywhere.
    //
    // Grants do not exist until WS7, so every page is currently grantless.
    // The gate is wired now so the live-data work cannot forget it.
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    const r = await f.call('pages:getUrl', ws, pageId) as { canOpenExternally: boolean }
    expect(r.canOpenExternally).toBe(true)
  })

  it('returns null for an unknown pageId', async () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    expect(await f.call('pages:getUrl', ws, 'no-such-page')).toBeNull()
  })

  it('returns null rather than throwing when the feature is off', async () => {
    process.env[KEY] = '0'
    const off = new PagesRuntime()
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(off))
    expect(await f.call('pages:getUrl', ws, pageId)).toBeNull()
    await off.disposeAll()
  })

  it('returns null when no runtime is wired at all', async () => {
    // Hosts that do not run pages (headless/thin client) must degrade quietly.
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(undefined))
    expect(await f.call('pages:getUrl', ws, pageId)).toBeNull()
  })
})

describe('pages:list', () => {
  it('lists pages for a session', async () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    const pages = await f.call('pages:list', ws, 'sess-1') as Array<{ slug: string; url: string }>
    expect(pages).toHaveLength(1)
    expect(pages[0]!.slug).toBe('demo')
    expect(pages[0]!.url).toContain('/w/')
  })

  it('returns an empty list for a session with no pages', async () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    expect(await f.call('pages:list', ws, 'other-session')).toEqual([])
  })

  it('returns an empty list when the feature is off', async () => {
    process.env[KEY] = '0'
    const off = new PagesRuntime()
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(off))
    expect(await f.call('pages:list', ws, 'sess-1')).toEqual([])
    await off.disposeAll()
  })
})

describe('what the consent dialog reads and writes', () => {
  const LIVE = 'CRAFT_FEATURE_CRAFT_PAGES_LIVE_DATA'
  const originalLive = process.env[LIVE]

  /** A page whose manifest carries a request, plus a live-data runtime. */
  async function withRequest() {
    process.env[LIVE] = '1'
    const w = mkdtempSync(join(tmpdir(), 'craft-rpc-req-'))
    const pagesRoot = sessionPagesRoot(w, 'sess-1')
    mkdirSync(pagesRoot, { recursive: true })
    const created = createPage(pagesRoot, {
      slug: 'dash', title: 'Dash',
      files: [{ path: 'index.html', content: '<h1>x</h1>' }],
      queries: [
        {
          name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages',
          fixedArgs: { maxResults: 20 }, paramSchema: { q: { type: 'string', maxLength: 50 } },
        },
        { name: 'labels', sourceSlug: 'gmail', toolName: 'list_labels' },
      ],
    })
    const rt = new PagesRuntime(undefined, async () => ({
      callTool: async () => ({}), disconnectAll: async () => {},
    }))
    await rt.ensureStarted(w)
    await rt.catalogFor(w)!.register({
      pageId: created.pageId, sessionId: 'sess-1', slug: 'dash', title: 'Dash',
    })
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(rt))
    return { w, rt, f, pageId: created.pageId }
  }

  afterEach(() => {
    if (originalLive === undefined) delete process.env[LIVE]
    else process.env[LIVE] = originalLive
  })

  it('lists what the page asked for, so a dialog has something to show', async () => {
    const { rt, f, pageId: id, w } = await withRequest()
    try {
      const reqs = await f.call('pages:listQueryRequests', w, id) as any[]
      expect(reqs.map(r => r.name).sort()).toEqual(['labels', 'unread'])
      const unread = reqs.find(r => r.name === 'unread')
      expect(unread.sourceSlug).toBe('gmail')
      expect(unread.toolName).toBe('list_messages')
      expect(unread.fixedArgs).toEqual({ maxResults: 20 })
      expect(unread.approved).toBe(false)
    } finally { await rt.disposeAll() }
  })

  it('marks a request as approved once the user approves it', async () => {
    const { rt, f, pageId: id, w } = await withRequest()
    try {
      await f.call('pages:approveGrants', w, id, [
        { name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages', fixedArgs: {}, paramSchema: {} },
      ])
      const reqs = await f.call('pages:listQueryRequests', w, id) as any[]
      expect(reqs.find(r => r.name === 'unread').approved).toBe(true)
      expect(reqs.find(r => r.name === 'labels').approved).toBe(false)
    } finally { await rt.disposeAll() }
  })

  it('approves under the name the page will use', async () => {
    const { rt, f, pageId: id, w } = await withRequest()
    try {
      const res = await f.call('pages:approveGrants', w, id, [
        { name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages', fixedArgs: {}, paramSchema: {} },
      ]) as any
      expect(res.approved).toBe(1)
      // Without the name the page's craftQuery('unread') resolves to nothing
      // and the approval the user just gave does nothing at all.
      expect(await rt.grantsFor(w)!.grantIdForName(id, 'unread')).toBeTruthy()
    } finally { await rt.disposeAll() }
  })

  it('reports which query was refused and why, without dropping the rest', async () => {
    const { rt, f, pageId: id, w } = await withRequest()
    try {
      const res = await f.call('pages:approveGrants', w, id, [
        { name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages', fixedArgs: {}, paramSchema: {} },
        { name: 'evil', sourceSlug: 'gmail', toolName: 'send_message', fixedArgs: {}, paramSchema: {} },
      ]) as any
      expect(res.approved).toBe(1)
      expect(res.rejected).toHaveLength(1)
      expect(res.rejected[0].reason).toMatch(/allowlist/i)
    } finally { await rt.disposeAll() }
  })

  it('returns nothing when live data is off, so no dialog can appear', async () => {
    // The page may still carry a request in its manifest; with the feature off
    // there is no store to approve into, so the dialog must not offer to.
    const { rt, f, pageId: id, w } = await withRequest()
    await rt.disposeAll()
    delete process.env[LIVE]
    const off = new PagesRuntime()
    await off.ensureStarted(w)
    const f2 = fakeServer()
    registerPagesHandlers(f2.server, deps(off))
    try {
      expect(await f2.call('pages:listQueryRequests', w, id)).toEqual([])
    } finally { await off.disposeAll() }
  })

  it('returns an empty list for a page that asked for nothing', async () => {
    const f = fakeServer()
    registerPagesHandlers(f.server, deps(runtime))
    expect(await f.call('pages:listQueryRequests', ws, pageId)).toEqual([])
  })
})
