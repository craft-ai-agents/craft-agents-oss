import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PageCatalogService, sessionPagesRoot, pagePublicDir } from './catalog.ts'

let ws: string
let catalog: PageCatalogService

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'craft-catalog-'))
  catalog = new PageCatalogService(ws)
})

const entry = (pageId: string, sessionId = 's1', slug = 'demo') =>
  ({ pageId, sessionId, slug, title: 'Demo' })

/** Write a page manifest on disk the way the store would. */
function writeManifest(sessionId: string, slug: string, id: string) {
  const dir = join(sessionPagesRoot(ws, sessionId), slug)
  mkdirSync(join(dir, 'revisions', '1', 'public'), { recursive: true })
  writeFileSync(join(dir, 'page.json'), JSON.stringify({ id, slug, title: slug }))
  writeFileSync(join(dir, 'revisions', '1', 'public', 'index.html'), '<h1>x</h1>')
}

describe('basic operations', () => {
  it('registers and resolves', async () => {
    await catalog.register(entry('p1'))
    expect((await catalog.resolve('p1'))?.slug).toBe('demo')
  })

  it('returns null for an unknown id', async () => {
    expect(await catalog.resolve('nope')).toBeNull()
  })

  it('unregisters', async () => {
    await catalog.register(entry('p1'))
    await catalog.unregister('p1')
    expect(await catalog.resolve('p1')).toBeNull()
  })

  it('re-registering the same id replaces rather than duplicates', async () => {
    await catalog.register(entry('p1', 's1', 'old'))
    await catalog.register(entry('p1', 's1', 'new'))
    expect(await catalog.list()).toHaveLength(1)
    expect((await catalog.resolve('p1'))?.slug).toBe('new')
  })

  it('filters by session', async () => {
    await catalog.register(entry('p1', 's1'))
    await catalog.register(entry('p2', 's2'))
    expect(await catalog.listForSession('s1')).toHaveLength(1)
  })
})

describe('serialization — the reason this is a service', () => {
  it('does not lose entries under concurrent registration', async () => {
    // Fired without awaiting individually: unserialized read-modify-write on a
    // single JSON file loses all but the last writer.
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => catalog.register(entry(`p${i}`))),
    )
    expect(await catalog.list()).toHaveLength(40)
  })

  it('does not lose entries under interleaved register/unregister', async () => {
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => catalog.register(entry(`k${i}`))),
    ])
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => catalog.unregister(`k${i}`)),
      ...Array.from({ length: 10 }, (_, i) => catalog.register(entry(`n${i}`))),
    ])
    const ids = (await catalog.list()).map(e => e.pageId).sort()
    expect(ids).toHaveLength(20)
    expect(ids).not.toContain('k0')
    expect(ids).toContain('k19')
    expect(ids).toContain('n0')
  })

  it('a failed mutation does not poison later ones', async () => {
    await catalog.register(entry('p1'))
    // Force a write failure by making the catalog path a directory.
    rmSync(join(ws, 'pages-catalog.json'), { force: true })
    mkdirSync(join(ws, 'pages-catalog.json'), { recursive: true })
    await catalog.register(entry('p2')).catch(() => undefined)
    // Restore and confirm the chain still works.
    rmSync(join(ws, 'pages-catalog.json'), { recursive: true, force: true })
    await catalog.register(entry('p3'))
    expect((await catalog.resolve('p3'))?.pageId).toBe('p3')
  })
})

describe('corruption tolerance', () => {
  it('treats a corrupt catalog as empty rather than throwing', async () => {
    writeFileSync(join(ws, 'pages-catalog.json'), 'not json{{{')
    expect(await catalog.list()).toEqual([])
    await catalog.register(entry('p1'))
    expect(await catalog.resolve('p1')).not.toBeNull()
  })

  it('writes atomically via a temp file', async () => {
    await catalog.register(entry('p1'))
    expect(existsSync(join(ws, 'pages-catalog.json'))).toBe(true)
    expect(existsSync(join(ws, 'pages-catalog.json.tmp'))).toBe(false)
  })
})

describe('reconcile', () => {
  it('recovers pages from manifests when the catalog is lost', async () => {
    writeManifest('s1', 'alpha', 'id-alpha')
    writeManifest('s2', 'beta', 'id-beta')
    // No catalog file at all — simulates deletion or a first run after upgrade.
    const r = await catalog.reconcile()
    expect(r.recovered).toBe(2)
    expect((await catalog.resolve('id-alpha'))?.sessionId).toBe('s1')
    expect((await catalog.resolve('id-beta'))?.slug).toBe('beta')
  })

  it('drops entries whose page directory is gone', async () => {
    await catalog.register(entry('ghost', 's1', 'ghost'))
    const r = await catalog.reconcile()
    expect(r.dropped).toBe(1)
    expect(await catalog.resolve('ghost')).toBeNull()
  })

  it('skips one unreadable manifest without losing the others', async () => {
    writeManifest('s1', 'good', 'id-good')
    const badDir = join(sessionPagesRoot(ws, 's1'), 'bad')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'page.json'), '{{{ not json')

    const r = await catalog.reconcile()
    expect(r.kept).toBe(1)
    expect(await catalog.resolve('id-good')).not.toBeNull()
  })

  it('is idempotent', async () => {
    writeManifest('s1', 'alpha', 'id-alpha')
    await catalog.reconcile()
    const second = await catalog.reconcile()
    expect(second.recovered).toBe(0)
    expect(second.dropped).toBe(0)
    expect(await catalog.list()).toHaveLength(1)
  })

  it('tolerates a workspace with no sessions directory', async () => {
    const r = await catalog.reconcile()
    expect(r.kept).toBe(0)
  })
})

describe('path helpers', () => {
  it('builds the served root for a revision', () => {
    expect(pagePublicDir('/ws', 'sess', 'demo', 3))
      .toBe(join('/ws', 'sessions', 'sess', 'data', 'pages', 'demo', 'revisions', '3', 'public'))
  })
})
