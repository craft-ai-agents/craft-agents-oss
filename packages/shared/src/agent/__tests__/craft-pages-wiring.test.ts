/**
 * Wiring contract for Craft Pages.
 *
 * WS1 and WS2 produced well-tested components that nothing in the running app
 * touches. These tests describe the five connection points that turn them into
 * a feature, and they are written BEFORE the wiring exists so each one is
 * observed failing first.
 *
 * The load-bearing one is the context binding: without it `craft_page` succeeds
 * and produces a page the server can never resolve — a silent "invisible page",
 * because the handler degrades gracefully by design.
 */
import { describe, expect, it, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PageCatalogInterface, PageCatalogEntry } from '@craft-agent/session-tools-core'
import { createClaudeContext } from '../claude-context.ts'
import { attachSessionSelfManagementBindings } from '../session-self-management-bindings.ts'
import {
  registerSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from '../session-scoped-tool-callback-registry.ts'
import { FEATURE_FLAGS, isCraftPagesEnabled, isCraftPagesLiveDataEnabled } from '../../feature-flags.ts'

const SESSION_ID = 'wiring-test-session'

function makeContext(workspacePath: string) {
  const ctx = createClaudeContext({
    sessionId: SESSION_ID,
    workspacePath,
    workspaceId: 'ws-1',
    onPlanSubmitted: () => {},
    onAuthRequest: () => {},
  })
  attachSessionSelfManagementBindings(ctx, SESSION_ID)
  return ctx
}

function fakeCatalog(): PageCatalogInterface & { entries: PageCatalogEntry[] } {
  const entries: PageCatalogEntry[] = []
  return {
    entries,
    register: async (e) => { entries.push(e) },
    unregister: async (id) => {
      const i = entries.findIndex(e => e.pageId === id)
      if (i >= 0) entries.splice(i, 1)
    },
    resolve: async (id) => entries.find(e => e.pageId === id) ?? null,
    listForSession: async (s) => entries.filter(e => e.sessionId === s),
  }
}

let workspacePath: string
beforeEach(() => { workspacePath = mkdtempSync(join(tmpdir(), 'craft-wiring-')) })
afterEach(() => { unregisterSessionScopedToolCallbacks(SESSION_ID) })

describe('feature flag', () => {
  const KEY = 'CRAFT_FEATURE_CRAFT_PAGES'
  const original = process.env[KEY]
  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('exists and defaults to disabled', () => {
    delete process.env[KEY]
    expect(isCraftPagesEnabled()).toBe(false)
    expect(FEATURE_FLAGS.craftPages).toBe(false)
  })

  it('is enabled by env override', () => {
    process.env[KEY] = '1'
    expect(isCraftPagesEnabled()).toBe(true)
    expect(FEATURE_FLAGS.craftPages).toBe(true)
  })

  it('is explicitly disableable', () => {
    process.env[KEY] = '0'
    expect(isCraftPagesEnabled()).toBe(false)
  })

  it('re-evaluates at access time rather than being captured once', () => {
    // FEATURE_FLAGS is a getter, so a flag flipped after module load must be
    // observed — otherwise gating depends on import order.
    delete process.env[KEY]
    expect(FEATURE_FLAGS.craftPages).toBe(false)
    process.env[KEY] = 'true'
    expect(FEATURE_FLAGS.craftPages).toBe(true)
  })
})

describe('live-data flag', () => {
  const PAGES = 'CRAFT_FEATURE_CRAFT_PAGES'
  const LIVE = 'CRAFT_FEATURE_CRAFT_PAGES_LIVE_DATA'
  const originalPages = process.env[PAGES]
  const originalLive = process.env[LIVE]

  afterEach(() => {
    for (const [k, v] of [[PAGES, originalPages], [LIVE, originalLive]] as const) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('defaults to disabled even when Craft Pages itself is on', () => {
    // Static pages are a complete release on their own. Live data reaches a
    // user's connected accounts, so it ships dark until deliberately enabled.
    process.env[PAGES] = '1'
    delete process.env[LIVE]
    expect(isCraftPagesLiveDataEnabled()).toBe(false)
    expect(FEATURE_FLAGS.craftPagesLiveData).toBe(false)
  })

  it('stays disabled when Craft Pages is off, whatever its own value says', () => {
    // It is a sub-flag, not an independent one: there is no page to hold a
    // grant, no listener to serve it, and no wrapper to broker it.
    process.env[PAGES] = '0'
    process.env[LIVE] = '1'
    expect(isCraftPagesLiveDataEnabled()).toBe(false)
  })

  it('is enabled only when both flags are on', () => {
    process.env[PAGES] = '1'
    process.env[LIVE] = '1'
    expect(isCraftPagesLiveDataEnabled()).toBe(true)
    expect(FEATURE_FLAGS.craftPagesLiveData).toBe(true)
  })

  it('re-evaluates at access time', () => {
    process.env[PAGES] = '1'
    delete process.env[LIVE]
    expect(FEATURE_FLAGS.craftPagesLiveData).toBe(false)
    process.env[LIVE] = 'true'
    expect(FEATURE_FLAGS.craftPagesLiveData).toBe(true)
  })
})

describe('tool context binding', () => {
  it('exposes pageCatalog when the backend registered one', () => {
    const catalog = fakeCatalog()
    registerSessionScopedToolCallbacks(SESSION_ID, { pageCatalog: catalog })
    const ctx = makeContext(workspacePath)
    expect(ctx.pageCatalog).toBe(catalog)
  })

  it('leaves pageCatalog undefined when no backend registered one', () => {
    // Backends that do not run alongside SessionManager must degrade, not throw.
    const ctx = makeContext(workspacePath)
    expect(ctx.pageCatalog).toBeUndefined()
  })

  it('resolves from the registry on EVERY access, not at attach time', () => {
    // The context is built before callbacks are registered in the real startup
    // order, so a value captured at attach time would always be undefined.
    const ctx = makeContext(workspacePath)
    expect(ctx.pageCatalog).toBeUndefined()

    const catalog = fakeCatalog()
    registerSessionScopedToolCallbacks(SESSION_ID, { pageCatalog: catalog })
    expect(ctx.pageCatalog).toBe(catalog)

    unregisterSessionScopedToolCallbacks(SESSION_ID)
    expect(ctx.pageCatalog).toBeUndefined()
  })

  it('is scoped per session', () => {
    const catalog = fakeCatalog()
    registerSessionScopedToolCallbacks(SESSION_ID, { pageCatalog: catalog })
    const other = createClaudeContext({
      sessionId: 'a-different-session',
      workspacePath,
      workspaceId: 'ws-1',
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    })
    attachSessionSelfManagementBindings(other, 'a-different-session')
    expect(other.pageCatalog).toBeUndefined()
  })
})

describe('end-to-end: creating a page registers it so the server can resolve it', () => {
  it('registers the created page in the injected catalog', async () => {
    // This is the whole point of the binding. Without it the tool still
    // succeeds and writes files, but the page is unreachable — the failure is
    // invisible rather than loud.
    const catalog = fakeCatalog()
    registerSessionScopedToolCallbacks(SESSION_ID, { pageCatalog: catalog })
    const ctx = makeContext(workspacePath)

    const { handleCraftPage } = await import('@craft-agent/session-tools-core')
    const result = await handleCraftPage(ctx, {
      command: 'create',
      slug: 'wired',
      title: 'Wired',
      files: [{ path: 'index.html', content: '<h1>wired</h1>' }],
    })

    expect(result.isError).toBeFalsy()
    expect(catalog.entries).toHaveLength(1)
    expect(catalog.entries[0]!.slug).toBe('wired')
    expect(catalog.entries[0]!.sessionId).toBe(SESSION_ID)
    // The id the catalog stores must be the same one the tool reported, or the
    // wrapper URL will 404.
    const reported = result.content.map(c => c.text).join('\n')
    expect(reported).toContain(catalog.entries[0]!.pageId)
  })
})
