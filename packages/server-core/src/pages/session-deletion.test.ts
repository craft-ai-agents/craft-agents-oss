/**
 * Deleting a chat deletes its pages.
 *
 * Page CONTENT is session-scoped (it lives in the session data dir), so it
 * cannot outlive the session. The user must be told before it happens — a
 * dashboard built three weeks ago vanishing during inbox tidy-up is a bad
 * surprise — and the catalog must not be left pointing at directories that no
 * longer exist.
 *
 * Note the dialog shape this enables: "Delete chat and 2 pages" / "Cancel".
 * NOT a Yes/No, because declining cannot mean "delete the chat but keep the
 * pages" — that outcome is impossible.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPage } from '@craft-agent/session-tools-core'
import { PageCatalogService, sessionPagesRoot } from './catalog.ts'
import { countPagesInSession, purgeSessionPages } from './session-deletion.ts'

let ws: string
let catalog: PageCatalogService

function makePage(sessionId: string, slug: string) {
  const root = sessionPagesRoot(ws, sessionId)
  mkdirSync(root, { recursive: true })
  return createPage(root, {
    slug, title: slug,
    files: [{ path: 'index.html', content: '<h1>x</h1>' }],
  })
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'craft-del-'))
  catalog = new PageCatalogService(ws)
})

describe('countPagesInSession', () => {
  it('returns 0 for a session with no pages', () => {
    expect(countPagesInSession(ws, 'sess-1')).toBe(0)
  })

  it('counts the pages a session owns', () => {
    makePage('sess-1', 'alpha')
    makePage('sess-1', 'beta')
    expect(countPagesInSession(ws, 'sess-1')).toBe(2)
  })

  it('does not count another session\'s pages', () => {
    makePage('sess-1', 'alpha')
    makePage('sess-2', 'beta')
    expect(countPagesInSession(ws, 'sess-1')).toBe(1)
  })

  it('returns 0 rather than throwing for an unknown session', () => {
    expect(countPagesInSession(ws, 'never-existed')).toBe(0)
  })

  it('ignores directories that are not pages', () => {
    makePage('sess-1', 'alpha')
    mkdirSync(join(sessionPagesRoot(ws, 'sess-1'), 'junk'), { recursive: true })
    expect(countPagesInSession(ws, 'sess-1')).toBe(1)
  })
})

describe('purgeSessionPages', () => {
  it('removes catalog entries for the deleted session', async () => {
    const a = makePage('sess-1', 'alpha')
    await catalog.register({ pageId: a.pageId, sessionId: 'sess-1', slug: 'alpha', title: 'alpha' })

    await purgeSessionPages(catalog, ws, 'sess-1')
    expect(await catalog.resolve(a.pageId)).toBeNull()
  })

  it('leaves other sessions\' entries alone', async () => {
    const a = makePage('sess-1', 'alpha')
    const b = makePage('sess-2', 'beta')
    await catalog.register({ pageId: a.pageId, sessionId: 'sess-1', slug: 'alpha', title: 'alpha' })
    await catalog.register({ pageId: b.pageId, sessionId: 'sess-2', slug: 'beta', title: 'beta' })

    await purgeSessionPages(catalog, ws, 'sess-1')
    expect(await catalog.resolve(a.pageId)).toBeNull()
    expect(await catalog.resolve(b.pageId)).not.toBeNull()
  })

  it('is safe for a session that never had pages', async () => {
    await expect(purgeSessionPages(catalog, ws, 'sess-none')).resolves.toBeUndefined()
  })

  it('never throws — a pages failure must not block session deletion', async () => {
    // Deletion is destructive and already underway by the time this runs;
    // failing here would leave the user unable to delete a session at all.
    const broken = {
      listForSession: async () => { throw new Error('catalog unavailable') },
      unregister: async () => {},
      register: async () => {},
      resolve: async () => null,
    }
    await expect(purgeSessionPages(broken, ws, 'sess-1')).resolves.toBeUndefined()
  })

  it('does not delete page files itself', async () => {
    // The session directory is removed wholesale by the caller. Deleting files
    // here too would mean two owners of the same destructive operation.
    const a = makePage('sess-1', 'alpha')
    await catalog.register({ pageId: a.pageId, sessionId: 'sess-1', slug: 'alpha', title: 'alpha' })
    await purgeSessionPages(catalog, ws, 'sess-1')
    expect(existsSync(join(sessionPagesRoot(ws, 'sess-1'), 'alpha'))).toBe(true)
  })
})
