/**
 * Exporting a page to a plain folder.
 *
 * The output has to stand on its own with no Craft Agents running, which makes
 * one thing load-bearing: a page that calls `craftQuery` gets that function
 * from `/w-assets/craft-query.js`, served by the app. Exported as-is, the very
 * first call is a ReferenceError and the whole page dies — including the parts
 * that never needed live data.
 *
 * So the export ships an offline shim that resolves `{error: …}`, which is the
 * path the skill already tells agents to write. A live-data page exports to a
 * page showing its empty state, not a blank screen.
 */
import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPage, updatePage, exportPage, PageStoreError } from './store.ts'

let root: string
let dest: string

const FILES = [
  { path: 'index.html', content: '<!doctype html><html><body><h1>Hi</h1><script src="app.js"></script></body></html>' },
  { path: 'app.js', content: 'console.log("hi")' },
  { path: 'assets/logo.svg', content: '<svg/>' },
]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-export-src-'))
  dest = mkdtempSync(join(tmpdir(), 'craft-export-dst-'))
})

describe('what lands on disk', () => {
  it('writes every file of the current revision', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const r = exportPage(root, 'site', dest)

    for (const f of FILES) {
      expect(existsSync(join(r.outputDir, f.path))).toBe(true)
      expect(readFileSync(join(r.outputDir, f.path), 'utf-8')).toBe(f.content)
    }
    expect(r.files.sort()).toEqual(FILES.map(f => f.path).sort())
  })

  it('exports the CURRENT revision, not the first', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    updatePage(root, { slug: 'site', files: [{ path: 'app.js', content: 'console.log("v2")' }] })

    const r = exportPage(root, 'site', dest)
    expect(readFileSync(join(r.outputDir, 'app.js'), 'utf-8')).toContain('v2')
    expect(r.rev).toBe(2)
  })

  it('preserves the directory structure', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const r = exportPage(root, 'site', dest)
    expect(existsSync(join(r.outputDir, 'assets', 'logo.svg'))).toBe(true)
  })

  it('never writes the manifest, which is internal bookkeeping', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const r = exportPage(root, 'site', dest)
    expect(existsSync(join(r.outputDir, 'page.json'))).toBe(false)
  })

  it('refuses a page that does not exist', () => {
    expect(() => exportPage(root, 'nope', dest)).toThrow(PageStoreError)
  })
})

describe('a page that asked for live data', () => {
  const LIVE = [
    {
      path: 'index.html',
      content: '<!doctype html><html><body><p id="o"></p>'
        + '<script src="/w-assets/craft-query.js"></script><script src="app.js"></script></body></html>',
    },
    {
      path: 'app.js',
      content: 'craftQuery("unread").then(function(r){'
        + 'document.getElementById("o").textContent = r.error ? "offline" : r.data.n; })',
    },
  ]

  const makeLive = () => createPage(root, {
    slug: 'dash', title: 'Dash', files: LIVE,
    queries: [{ name: 'unread', sourceSlug: 'gmail', toolName: 'list_messages' }],
  })

  it('ships an offline craftQuery so the page does not die on the first call', () => {
    makeLive()
    const r = exportPage(root, 'dash', dest)
    const shim = join(r.outputDir, 'w-assets', 'craft-query.js')
    expect(existsSync(shim)).toBe(true)
    expect(readFileSync(shim, 'utf-8')).toContain('craftQuery')
  })

  it('rewrites the absolute script src so it resolves from a file:// folder', () => {
    // "/w-assets/craft-query.js" is absolute; opened from a folder it points at
    // the filesystem root and 404s. The export is useless if the page cannot
    // even load its own scripts.
    makeLive()
    const r = exportPage(root, 'dash', dest)
    const html = readFileSync(join(r.outputDir, 'index.html'), 'utf-8')
    expect(html).not.toContain('"/w-assets/craft-query.js"')
    expect(html).toContain('w-assets/craft-query.js')
  })

  it('resolves rather than rejects, matching the online contract', () => {
    // A page written against the real helper handles {error}. If the shim
    // rejected instead, every exported live page would throw.
    makeLive()
    const r = exportPage(root, 'dash', dest)
    const shim = readFileSync(join(r.outputDir, 'w-assets', 'craft-query.js'), 'utf-8')
    expect(shim).toContain('resolve')
    expect(shim).not.toMatch(/\breject\b/)
  })

  it('reports which queries stopped working, so the caller can say so', () => {
    makeLive()
    const r = exportPage(root, 'dash', dest)
    expect(r.disabledQueries).toEqual(['unread'])
  })

  it('adds no shim to a page that never asked for live data', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const r = exportPage(root, 'site', dest)
    expect(existsSync(join(r.outputDir, 'w-assets'))).toBe(false)
    expect(r.disabledQueries).toEqual([])
  })
})

describe('where it writes', () => {
  it('puts the page in its own directory under the destination', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const r = exportPage(root, 'site', dest)
    expect(r.outputDir).toBe(join(dest, 'site'))
  })

  it('refuses a slug that is not a valid page name', () => {
    // The slug becomes a directory name under a caller-supplied root, so the
    // same rules that guard page storage guard the export path.
    for (const bad of ['../escape', 'a/b', '..']) {
      expect(() => exportPage(root, bad, dest)).toThrow()
    }
  })

  it('overwrites a previous export of the same page', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    exportPage(root, 'site', dest)
    updatePage(root, { slug: 'site', files: [{ path: 'app.js', content: 'v2' }] })
    const r = exportPage(root, 'site', dest)
    expect(readFileSync(join(r.outputDir, 'app.js'), 'utf-8')).toBe('v2')
  })

  it('does not leave files from an older export behind', () => {
    // A stale file from a previous export is worse than a missing one: the
    // page would load it and behave like a version nobody chose.
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    exportPage(root, 'site', dest)
    writeFileSync(join(dest, 'site', 'stale.js'), 'old')
    exportPage(root, 'site', dest)
    expect(existsSync(join(dest, 'site', 'stale.js'))).toBe(false)
  })

  it('creates the destination when it does not exist yet', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    const fresh = join(dest, 'deeper', 'still')
    const r = exportPage(root, 'site', fresh)
    expect(existsSync(join(r.outputDir, 'index.html'))).toBe(true)
  })

  it('writes nothing outside the destination directory', () => {
    createPage(root, { slug: 'site', title: 'Site', files: FILES })
    mkdirSync(join(dest, 'sentinel'), { recursive: true })
    exportPage(root, 'site', dest)
    expect(readdirSync(dest).sort()).toEqual(['sentinel', 'site'])
  })
})
