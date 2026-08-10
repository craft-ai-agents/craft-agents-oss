/**
 * The seam SessionManager uses to hand a session its page catalog.
 *
 * Extracted rather than inlined so the gating and start-ordering are testable
 * without instantiating SessionManager (5000+ lines). The ordering matters: the
 * catalog only exists once the runtime has started, so asking for it first
 * yields undefined and the session silently loses the capability.
 */
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PagesRuntime } from './runtime.ts'
import { resolvePageCatalogForSession } from './session-binding.ts'

const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
const original = process.env[KEY]
let ws: string
let runtime: PagesRuntime

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'craft-binding-'))
  process.env[KEY] = '1'
  runtime = new PagesRuntime()
})
afterEach(async () => {
  await runtime.disposeAll()
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('resolvePageCatalogForSession', () => {
  it('starts the runtime on demand and returns a usable catalog', async () => {
    // Callers must not have to remember to start it first.
    expect(runtime.isRunning(ws)).toBe(false)
    const catalog = await resolvePageCatalogForSession(runtime, ws)
    expect(catalog).toBeDefined()
    expect(runtime.isRunning(ws)).toBe(true)

    await catalog!.register({ pageId: 'p1', sessionId: 's1', slug: 'demo', title: 'D' })
    expect((await catalog!.resolve('p1'))?.slug).toBe('demo')
  })

  it('returns undefined when the feature is off, and binds no listener', async () => {
    process.env[KEY] = '0'
    const off = new PagesRuntime()
    expect(await resolvePageCatalogForSession(off, ws)).toBeUndefined()
    expect(off.isRunning(ws)).toBe(false)
    await off.disposeAll()
  })

  it('returns undefined when no runtime is provided', async () => {
    expect(await resolvePageCatalogForSession(undefined, ws)).toBeUndefined()
  })

  it('never throws — a pages failure must not block session creation', async () => {
    // Session creation is the critical path. An unwritable workspace path must
    // cost the user Craft Pages, not the ability to start a session.
    const bogus = '/definitely/not/a/real/path/\0invalid'
    await expect(resolvePageCatalogForSession(runtime, bogus)).resolves.toBeUndefined()
  })

  it('hands the same catalog to two sessions in one workspace', async () => {
    // Distinct instances would each hold their own view of the file and lose
    // each other's writes — the exact failure PageCatalogService serializes away.
    const a = await resolvePageCatalogForSession(runtime, ws)
    const b = await resolvePageCatalogForSession(runtime, ws)
    expect(a).toBe(b)
  })
})
