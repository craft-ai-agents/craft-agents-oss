/**
 * PagesRuntime contract, written before the implementation.
 *
 * Owns the per-workspace catalog + listener lifecycle so SessionManager (5000+
 * lines) does not grow another responsibility, and so the lifecycle is testable
 * without standing up a session.
 */
import { describe, expect, it, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPage } from '@craft-agent/session-tools-core'
import { PagesRuntime } from './runtime.ts'
import { sessionPagesRoot } from './catalog.ts'

const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
let ws: string
let runtime: PagesRuntime
const original = process.env[KEY]

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'craft-runtime-'))
  process.env[KEY] = '1'
  runtime = new PagesRuntime()
})
afterEach(async () => {
  await runtime.disposeAll()
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('feature gating', () => {
  it('does nothing at all when the flag is off', async () => {
    process.env[KEY] = '0'
    const r = new PagesRuntime()
    const handle = await r.ensureStarted(ws)
    // Not merely hidden: no listener bound, nothing to reach.
    expect(handle).toBeNull()
    expect(r.isRunning(ws)).toBe(false)
    await r.disposeAll()
  })

  it('starts when the flag is on', async () => {
    const handle = await runtime.ensureStarted(ws)
    expect(handle).not.toBeNull()
    expect(runtime.isRunning(ws)).toBe(true)
    expect(handle!.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})

describe('lifecycle', () => {
  it('is idempotent — repeated starts reuse one listener', async () => {
    const a = await runtime.ensureStarted(ws)
    const b = await runtime.ensureStarted(ws)
    expect(a!.origin).toBe(b!.origin)
  })

  it('does not race when started concurrently', async () => {
    // Two sessions in the same workspace can call this simultaneously; without
    // an in-flight guard that binds two listeners and leaks one.
    const [a, b, c] = await Promise.all([
      runtime.ensureStarted(ws),
      runtime.ensureStarted(ws),
      runtime.ensureStarted(ws),
    ])
    expect(a!.origin).toBe(b!.origin)
    expect(b!.origin).toBe(c!.origin)
  })

  it('refuses to start for a workspace path that does not exist', async () => {
    // Binding a listener for a workspace that is not there wastes a port and
    // yields a catalog that can never resolve anything. Fail closed instead.
    // Nested under the fresh mkdtemp workspace so it cannot be left behind by
    // an earlier run — PageCatalogService.write() mkdirs the workspace root, so
    // a fixed tmp path gets created by the very failure this test detects.
    const missing = join(ws, 'nested', 'absent-workspace')
    const h = await runtime.ensureStarted(missing)
    expect(h).toBeNull()
    expect(runtime.isRunning(missing)).toBe(false)
  })

  it('gives separate workspaces separate listeners and catalogs', async () => {
    const ws2 = mkdtempSync(join(tmpdir(), 'craft-runtime-2-'))
    const a = await runtime.ensureStarted(ws)
    const b = await runtime.ensureStarted(ws2)
    expect(a!.origin).not.toBe(b!.origin)
    expect(runtime.catalogFor(ws)).not.toBe(runtime.catalogFor(ws2))
  })

  it('stops a workspace and frees its port', async () => {
    const handle = await runtime.ensureStarted(ws)
    const origin = handle!.origin
    await runtime.dispose(ws)
    expect(runtime.isRunning(ws)).toBe(false)
    await expect(fetch(`${origin}/w/anything`)).rejects.toThrow()
  })

  it('disposeAll stops every workspace', async () => {
    const ws2 = mkdtempSync(join(tmpdir(), 'craft-runtime-3-'))
    await runtime.ensureStarted(ws)
    await runtime.ensureStarted(ws2)
    await runtime.disposeAll()
    expect(runtime.isRunning(ws)).toBe(false)
    expect(runtime.isRunning(ws2)).toBe(false)
  })
})

describe('catalog integration', () => {
  it('exposes a catalog usable as the tool-context capability', async () => {
    await runtime.ensureStarted(ws)
    const catalog = runtime.catalogFor(ws)!
    await catalog.register({ pageId: 'p1', sessionId: 's1', slug: 'demo', title: 'Demo' })
    expect((await catalog.resolve('p1'))?.slug).toBe('demo')
  })

  it('reconciles from manifests on start so pages survive a restart', async () => {
    // Page written by a previous run; catalog file absent.
    const pagesRoot = sessionPagesRoot(ws, 'sess-old')
    mkdirSync(pagesRoot, { recursive: true })
    const created = createPage(pagesRoot, {
      slug: 'survivor', title: 'Survivor',
      files: [{ path: 'index.html', content: '<h1>still here</h1>' }],
    })

    await runtime.ensureStarted(ws)
    const catalog = runtime.catalogFor(ws)!
    expect((await catalog.resolve(created.pageId))?.slug).toBe('survivor')
  })
})

describe('serving', () => {
  it('serves a page created through the catalog it owns', async () => {
    const pagesRoot = sessionPagesRoot(ws, 'sess-1')
    mkdirSync(pagesRoot, { recursive: true })
    const created = createPage(pagesRoot, {
      slug: 'demo', title: 'Demo',
      files: [{ path: 'index.html', content: '<h1>served</h1>' }],
    })
    const handle = await runtime.ensureStarted(ws)
    await runtime.catalogFor(ws)!.register({
      pageId: created.pageId, sessionId: 'sess-1', slug: 'demo', title: 'Demo',
    })

    const r = await fetch(handle!.urlForPage(created.pageId))
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('<iframe')
  })
})
