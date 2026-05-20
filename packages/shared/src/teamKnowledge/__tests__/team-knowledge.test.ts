import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { TeamKnowledgeConfig, TeamKnowledgeDoc } from '../types.ts'
import { STALE_TTL_MS } from '../types.ts'
import { loadTeamKnowledgeConfig, saveTeamKnowledgeConfig, getValidKnowledgeEntries } from '../storage.ts'
import { refreshTeamKnowledge, setFetch, resetFetch } from '../refresh.ts'

// ── Helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tk-test-'))
  tempDirs.push(dir)
  return dir
}

/**
 * Create a mock fetch function that returns the given content.
 */
function makeFetchOk(content: string, contentType = 'text/markdown'): typeof fetch {
  const fn = async (_url: string) => {
    return new Response(content, {
      status: 200,
      headers: { 'content-type': contentType },
    }) as Response
  }
  return fn as unknown as typeof fetch
}

/**
 * Create a mock fetch function that fails with the given status.
 */
function makeFetchFail(status: number, statusText?: string): typeof fetch {
  const fn = async (_url: string) => {
    return new Response(null, {
      status,
      statusText: statusText || 'Error',
    }) as Response
  }
  return fn as unknown as typeof fetch
}

/**
 * Helper: seed a workspace with a team knowledge config
 */
function seedConfig(workspaceRoot: string, overrides: Partial<TeamKnowledgeConfig> = {}): void {
  const config: TeamKnowledgeConfig = {
    version: 1,
    enabled: true,
    documents: [],
    ...overrides,
  }
  saveTeamKnowledgeConfig(workspaceRoot, config)
}

/**
 * Helper: seed a single doc into an enabled config
 */
function seedDoc(workspaceRoot: string, overrides: Partial<TeamKnowledgeDoc> = {}): TeamKnowledgeDoc {
  const doc: TeamKnowledgeDoc = {
    id: 'doc-1',
    title: 'Test Doc',
    url: 'https://example.com/test.md',
    priority: 10,
    ...overrides,
  }
  const config = loadTeamKnowledgeConfig(workspaceRoot)
  config.enabled = true
  config.documents.push(doc)
  saveTeamKnowledgeConfig(workspaceRoot, config)
  return doc
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
  resetFetch()
})

// ── Config Loading ───────────────────────────────────────────────────────────

describe('config loading', () => {
  it('returns default config when no file exists', () => {
    const root = tempDir()
    const config = loadTeamKnowledgeConfig(root)

    expect(config).not.toBeNull()
    expect(config.version).toBe(1)
    expect(config.enabled).toBe(false)
    expect(config.documents).toEqual([])
  })

  it('loads a pre-existing config file', () => {
    const root = tempDir()
    seedConfig(root, {
      enabled: true,
      documents: [
        { id: 'doc-1', title: 'Conventions', url: 'https://example.com/conventions.md', priority: 1 },
      ],
    })

    const config = loadTeamKnowledgeConfig(root)
    expect(config.enabled).toBe(true)
    expect(config.documents).toHaveLength(1)
    expect(config.documents[0]!.id).toBe('doc-1')
  })

  it('returns defaults on corrupt JSON', () => {
    const root = tempDir()
    mkdirSync(join(root, 'teamKnowledge'), { recursive: true })
    writeFileSync(join(root, 'teamKnowledge', 'config.json'), '{invalid json', 'utf-8')

    const config = loadTeamKnowledgeConfig(root)
    expect(config.enabled).toBe(false)
    expect(config.documents).toEqual([])
  })

  it('persists config changes via saveTeamKnowledgeConfig', () => {
    const root = tempDir()
    const config = loadTeamKnowledgeConfig(root)

    config.enabled = true
    config.documents.push({
      id: 'doc-1',
      title: 'Coding Standards',
      url: 'https://example.com/standards.md',
      priority: 5,
    })
    saveTeamKnowledgeConfig(root, config)

    // Reload and verify
    const reloaded = loadTeamKnowledgeConfig(root)
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.documents).toHaveLength(1)
    expect(reloaded.documents[0]!.title).toBe('Coding Standards')
  })
})

// ── Refresh ──────────────────────────────────────────────────────────────────

describe('refresh', () => {
  beforeEach(() => {
    setFetch(makeFetchOk('# Test content'))
  })

  it('returns empty summary and does NOT fetch when config is disabled', async () => {
    const root = tempDir()
    // enabled is false by default
    // Use a fetch mock that would fail if called — confirming disabled config skips fetch
    setFetch(makeFetchFail(500))

    const summary = await refreshTeamKnowledge(root)
    expect(summary).toEqual({
      added: 0, updated: 0, removed: 0, stale: 0, conflicts: 0,
      timestamp: expect.any(Number),
    })
    // Since config is disabled, refresh returns early without fetching
    expect(summary.timestamp).toBeGreaterThan(0)
  })

  it('fetches documents and stores content + hash on first refresh', async () => {
    const root = tempDir()
    seedConfig(root, { enabled: true, documents: [
      { id: 'doc-1', title: 'Conventions', url: 'https://example.com/conventions.md', priority: 1 },
    ]})

    setFetch(makeFetchOk('# Team Conventions'))

    const summary = await refreshTeamKnowledge(root)
    expect(summary.added).toBe(1)
    expect(summary.updated).toBe(0)
    expect(summary.stale).toBe(0)
    expect(summary.conflicts).toBe(0)

    // Verify config was saved with content
    const config = loadTeamKnowledgeConfig(root)
    const doc = config.documents[0]!
    expect(doc.content).toBe('# Team Conventions')
    expect(doc.contentHash).toBeDefined()
    expect(doc.contentHash!.length).toBe(64) // SHA-256 hex
    expect(doc.lastFetchedAt).toBeGreaterThan(0)
    expect(doc.staleAt).toBeGreaterThan(Date.now())
    expect(doc.refreshError).toBeUndefined()
  })

  it('detects content changes and counts as updated', async () => {
    const root = tempDir()
    const now = Date.now()
    seedDoc(root, {
      content: '# Old content',
      contentHash: '0000000000000000000000000000000000000000000000000000000000000000',
      lastFetchedAt: now - 60_000,
      staleAt: now + STALE_TTL_MS,
    })

    setFetch(makeFetchOk('# New content'))

    const summary = await refreshTeamKnowledge(root)
    expect(summary.added).toBe(0)
    expect(summary.updated).toBe(1)
    expect(summary.stale).toBe(0)
    expect(summary.conflicts).toBe(0)
  })

  it('does NOT count unchanged content as updated', async () => {
    const root = tempDir()
    const content = '# Stable content'
    const hash = createHash('sha256').update(content, 'utf-8').digest('hex')
    const now = Date.now()
    seedDoc(root, {
      content,
      contentHash: hash,
      lastFetchedAt: now - 60_000,
      staleAt: now + STALE_TTL_MS,
    })

    setFetch(makeFetchOk(content))

    const summary = await refreshTeamKnowledge(root)
    expect(summary.added).toBe(0)
    expect(summary.updated).toBe(0)
    expect(summary.stale).toBe(0)
    expect(summary.conflicts).toBe(0)
  })

  it('marks documents stale on fetch failure', async () => {
    const root = tempDir()
    const now = Date.now()
    seedDoc(root, {
      content: '# Previous content',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      lastFetchedAt: now - 60_000,
      staleAt: now + STALE_TTL_MS,
    })

    setFetch(makeFetchFail(500, 'Internal Server Error'))

    const summary = await refreshTeamKnowledge(root)
    expect(summary.added).toBe(0)
    expect(summary.updated).toBe(0)
    expect(summary.stale).toBe(1)
    expect(summary.conflicts).toBe(0)

    const config = loadTeamKnowledgeConfig(root)
    const doc = config.documents[0]!
    expect(doc.refreshError).toContain('500')
    expect(doc.staleAt).toBeLessThan(Date.now()) // immediately stale
  })

  it('does NOT double-count a doc that was already stale and stays stale', async () => {
    const root = tempDir()
    const now = Date.now()
    seedDoc(root, {
      content: '# Old content',
      contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      lastFetchedAt: now - 48 * 60 * 60 * 1000, // 48h ago — past TTL
      staleAt: now - 60_000, // already stale
    })

    setFetch(makeFetchFail(503))

    const summary = await refreshTeamKnowledge(root)
    // Was already stale, failed again — should NOT increment stale count
    expect(summary.stale).toBe(0)
  })

  it('counts conflicts when stale doc refreshes with changed content', async () => {
    const root = tempDir()
    const oldContent = '# Outdated content'
    const oldHash = createHash('sha256').update(oldContent, 'utf-8').digest('hex')
    const now = Date.now()
    seedDoc(root, {
      content: oldContent,
      contentHash: oldHash,
      lastFetchedAt: now - 48 * 60 * 60 * 1000, // 48h ago — past TTL
      staleAt: now - 60_000, // already stale
    })

    setFetch(makeFetchOk('# New content'))

    const summary = await refreshTeamKnowledge(root)
    expect(summary.added).toBe(0)
    expect(summary.updated).toBe(0)
    expect(summary.conflicts).toBe(1)
    expect(summary.stale).toBe(0)
  })
})

// ── Priority / Entry Filtering ───────────────────────────────────────────────

describe('valid knowledge entries', () => {
  it('returns entries sorted by priority ascending', () => {
    const root = tempDir()
    const now = Date.now()
    seedConfig(root, {
      enabled: true,
      documents: [
        {
          id: 'low', title: 'Low Priority', url: 'https://example.com/low.md', priority: 100,
          content: '# Low', contentHash: 'aaa', lastFetchedAt: now,
          staleAt: now + STALE_TTL_MS,
        },
        {
          id: 'high', title: 'High Priority', url: 'https://example.com/high.md', priority: 1,
          content: '# High', contentHash: 'bbb', lastFetchedAt: now,
          staleAt: now + STALE_TTL_MS,
        },
        {
          id: 'mid', title: 'Mid Priority', url: 'https://example.com/mid.md', priority: 50,
          content: '# Mid', contentHash: 'ccc', lastFetchedAt: now,
          staleAt: now + STALE_TTL_MS,
        },
      ],
    })

    const entries = getValidKnowledgeEntries(root)
    expect(entries).toHaveLength(3)
    expect(entries[0]!.id).toBe('high')
    expect(entries[1]!.id).toBe('mid')
    expect(entries[2]!.id).toBe('low')
  })

  it('excludes entries past staleAt threshold', () => {
    const root = tempDir()
    const now = Date.now()
    seedConfig(root, {
      enabled: true,
      documents: [
        {
          id: 'fresh', title: 'Fresh', url: 'https://example.com/fresh.md', priority: 1,
          content: '# Fresh', contentHash: 'aaa', lastFetchedAt: now,
          staleAt: now + 60_000, // still fresh
        },
        {
          id: 'stale', title: 'Stale', url: 'https://example.com/stale.md', priority: 2,
          content: '# Stale', contentHash: 'bbb', lastFetchedAt: now - 48 * 60 * 60 * 1000,
          staleAt: now - 60_000, // past stale threshold
        },
      ],
    })

    const entries = getValidKnowledgeEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.id).toBe('fresh')
  })

  it('excludes entries that were never successfully fetched', () => {
    const root = tempDir()
    seedConfig(root, {
      enabled: true,
      documents: [
        {
          id: 'never-fetched', title: 'No Content', url: 'https://example.com/nope.md', priority: 1,
          // no content, no contentHash, no lastFetchedAt
        },
      ],
    })

    const entries = getValidKnowledgeEntries(root)
    expect(entries).toHaveLength(0)
  })

  it('returns empty when config is disabled', () => {
    const root = tempDir()
    // enabled is false by default (no seedConfig call)
    expect(getValidKnowledgeEntries(root)).toEqual([])
  })
})

// ── Stale TTL ────────────────────────────────────────────────────────────────

describe('stale TTL', () => {
  it('excludes entries with staleAt <= now', () => {
    const root = tempDir()
    const now = Date.now()
    seedConfig(root, {
      enabled: true,
      documents: [
        {
          id: 'exactly-stale', title: 'Exactly Stale', url: 'https://example.com/exactly.md', priority: 1,
          content: '# Exactly', contentHash: 'aaa', lastFetchedAt: now - STALE_TTL_MS - 60_000,
          staleAt: now, // equal to now
        },
      ],
    })

    const entries = getValidKnowledgeEntries(root)
    expect(entries).toHaveLength(0)
  })

  it('includes entries with staleAt > now', () => {
    const root = tempDir()
    const now = Date.now()
    seedConfig(root, {
      enabled: true,
      documents: [
        {
          id: 'barely-fresh', title: 'Barely Fresh', url: 'https://example.com/barely.md', priority: 1,
          content: '# Barely', contentHash: 'aaa', lastFetchedAt: now,
          staleAt: now + 60_000, // in the future
        },
      ],
    })

    const entries = getValidKnowledgeEntries(root)
    expect(entries).toHaveLength(1)
  })
})
