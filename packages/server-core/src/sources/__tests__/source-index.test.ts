import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  closeAllSourceIndexes,
  countIndexedFiles,
  indexSourceTree,
  reindexWorkspaceSources,
  retrieveSourcesForPrompt,
  searchSourceIndex,
  SOURCE_RETRIEVE_MAX_TOKENS,
  walkSourceTree,
} from '../source-index'

function tmpRoot(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

afterEach(() => {
  closeAllSourceIndexes()
})

describe('walkSourceTree', () => {
  it('collects text files and skips node_modules', () => {
    const root = tmpRoot('src-walk')
    try {
      writeFileSync(join(root, 'readme.md'), '# Hello craft sources index')
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'pkg', 'x.md'), 'skip me')
      mkdirSync(join(root, 'docs'), { recursive: true })
      writeFileSync(join(root, 'docs', 'guide.txt'), 'keyword alpha beta')

      const { files, truncated } = walkSourceTree(root)
      expect(truncated).toBe(false)
      const rels = files.map((f) => f.relPath).sort()
      expect(rels).toEqual(['docs/guide.txt', 'readme.md'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('source index FTS/LIKE', () => {
  it('indexes and searches local trees', () => {
    const workspace = tmpRoot('src-ws')
    const folderA = join(workspace, 'src-a')
    const folderB = join(workspace, 'src-b')
    mkdirSync(folderA, { recursive: true })
    mkdirSync(folderB, { recursive: true })
    writeFileSync(join(folderA, 'alpha.md'), 'The quick brown fox jumps over craft agents')
    writeFileSync(join(folderB, 'beta.md'), 'SiYuan flashcards and plugins surface modes')

    try {
      const re = reindexWorkspaceSources(workspace, [
        { slug: 'local-a', path: folderA },
        { slug: 'local-b', path: folderB },
      ])
      expect(re.indexed).toBe(2)
      expect(countIndexedFiles(workspace)).toBe(2)

      const fox = searchSourceIndex(workspace, 'fox', { limit: 5 })
      expect(fox.hits.length).toBeGreaterThanOrEqual(1)
      expect(fox.hits.some((h) => h.path.includes('local-a/alpha.md'))).toBe(true)
      expect(fox.hits[0]!.snippet.toLowerCase()).toContain('fox')

      const flash = searchSourceIndex(workspace, 'flashcards', { limit: 5 })
      expect(flash.hits.some((h) => h.path.includes('local-b/beta.md'))).toBe(true)

      // second index of single tree with clear
      writeFileSync(join(folderA, 'gamma.md'), 'brand new document about zebras')
      const single = indexSourceTree(workspace, folderA, {
        sourceSlug: 'local-a',
        clearSource: true,
      })
      expect(single.indexed).toBe(2)
      const zebra = searchSourceIndex(workspace, 'zebras')
      expect(zebra.hits.some((h) => h.path.endsWith('gamma.md'))).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('returns empty for blank query or missing db', () => {
    const workspace = tmpRoot('src-empty')
    try {
      expect(searchSourceIndex(workspace, '  ').hits).toEqual([])
      expect(searchSourceIndex(workspace, 'anything').hits).toEqual([])
      expect(countIndexedFiles(workspace)).toBe(0)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('retrieveSourcesForPrompt', () => {
  it('returns empty hits for blank query or missing index', () => {
    const workspace = tmpRoot('src-retrieve-empty')
    try {
      expect(retrieveSourcesForPrompt(workspace, '  ').hits).toEqual([])
      expect(retrieveSourcesForPrompt(workspace, 'anything').hits).toEqual([])
      expect(retrieveSourcesForPrompt('', 'query').hits).toEqual([])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('returns ranked excerpts from indexed bodies', () => {
    const workspace = tmpRoot('src-retrieve-hit')
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'alpha.md'), 'The quick brown fox jumps over craft agents source retrieve')
    writeFileSync(join(folder, 'beta.md'), 'Unrelated gardening notes about tomatoes')
    try {
      reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
      const result = retrieveSourcesForPrompt(workspace, 'fox craft', { limit: 5 })
      expect(result.hits.length).toBeGreaterThanOrEqual(1)
      expect(result.hits[0]!.path).toContain('alpha.md')
      expect(result.hits[0]!.excerpt.toLowerCase()).toContain('fox')
      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.totalTokens).toBeLessThanOrEqual(SOURCE_RETRIEVE_MAX_TOKENS)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('greedy-fills by rank and respects maxTokens budget', () => {
    const workspace = tmpRoot('src-retrieve-cap')
    const folder = join(workspace, 'docs')
    mkdirSync(folder, { recursive: true })
    // Three docs that all match "widget" so rank order decides fill.
    writeFileSync(join(folder, 'a.md'), `widget alpha ${'word '.repeat(200)}`)
    writeFileSync(join(folder, 'b.md'), `widget beta ${'word '.repeat(200)}`)
    writeFileSync(join(folder, 'c.md'), `widget gamma ${'word '.repeat(200)}`)
    try {
      reindexWorkspaceSources(workspace, [{ slug: 'docs', path: folder }])
      const tight = retrieveSourcesForPrompt(workspace, 'widget', { limit: 5, maxTokens: 40 })
      expect(tight.hits.length).toBeGreaterThanOrEqual(1)
      expect(tight.totalTokens).toBeLessThanOrEqual(40)
      // With a tiny budget we cannot fit all three full excerpts.
      expect(tight.hits.length).toBeLessThan(3)

      const roomy = retrieveSourcesForPrompt(workspace, 'widget', { limit: 5, maxTokens: 2000 })
      expect(roomy.hits.length).toBeGreaterThanOrEqual(tight.hits.length)
      expect(roomy.totalTokens).toBeLessThanOrEqual(2000)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
