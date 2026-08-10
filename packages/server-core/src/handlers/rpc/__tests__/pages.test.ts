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
    const url = await f.call('pages:getUrl', ws, pageId)
    // The wrapper, never /p/* directly: a page loaded top-level loses the
    // frame-src protection that blocks self-navigation exfiltration.
    expect(url).toBe(`${runtime.serverFor(ws)!.origin}/w/${pageId}`)
    expect(url).not.toContain('/p/')
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
