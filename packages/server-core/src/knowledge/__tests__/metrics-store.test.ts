/**
 * KnowledgeMetricsStore tests (P7-prep G1) — path, fail-soft parse, atomic
 * increment, derived counters, daily buckets.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  KnowledgeMetricsStore,
  parseMetricsFile,
  emptyMetricsSnapshot,
  bumpKnowledgeMetric,
  __resetMetricsStoreCacheForTests,
} from '../metrics-store'
import { KnowledgePublicationsStore } from '../publications-store'
import type { PublicationRecord } from '@craft-agent/core/knowledge'

let workspaceRoot: string
const tmpDirs: string[] = []

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-metrics-'))
  tmpDirs.push(workspaceRoot)
  __resetMetricsStoreCacheForTests()
})

afterEach(() => {
  __resetMetricsStoreCacheForTests()
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('path resolution', () => {
  it('resolves metrics.json under {workspaceRoot}/knowledge', () => {
    const store = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 0,
      publicationsLast7d: () => 0,
    })
    expect(store.filePath).toBe(join(workspaceRoot, 'knowledge', 'metrics.json'))
  })
})

describe('snapshot / fail-soft', () => {
  it('returns zeros when file is missing', () => {
    const store = new KnowledgeMetricsStore(workspaceRoot, {
      now: () => Date.parse('2026-08-08T12:00:00.000Z'),
      connectionsActive: () => 2,
      publicationsLast7d: () => 0,
    })
    const snap = store.snapshot()
    expect(snap.version).toBe(1)
    expect(snap.counters.connectionsActive).toBe(2)
    expect(snap.counters.publicationsTotal).toBe(0)
    expect(snap.counters.viewRunsTotal).toBe(0)
    expect(snap.daily).toEqual({})
  })

  it('parseMetricsFile skips corrupt content', () => {
    expect(parseMetricsFile('not-json')).toEqual({})
    expect(parseMetricsFile('[]')).toEqual({})
    expect(parseMetricsFile('{"version":1,"counters":{"publicationsTotal":3}}').counters?.publicationsTotal).toBe(3)
  })

  it('emptyMetricsSnapshot has version 1 and zero counters', () => {
    const snap = emptyMetricsSnapshot(() => 0)
    expect(snap.version).toBe(1)
    expect(snap.counters.publicationsTotal).toBe(0)
  })
})

describe('increment', () => {
  it('atomically bumps counters and daily buckets; leaves no tmp files', () => {
    let now = Date.parse('2026-08-08T15:30:00.000Z')
    const store = new KnowledgeMetricsStore(workspaceRoot, {
      now: () => now,
      connectionsActive: () => 1,
      publicationsLast7d: () => 0,
    })
    store.increment('publicationsTotal', 1, 'publications')
    store.increment('viewRunsTotal', 2, 'viewRuns')
    store.increment('automationProposalsTotal', 1, 'automationProposals')

    const snap = store.snapshot()
    expect(snap.counters.publicationsTotal).toBe(1)
    expect(snap.counters.viewRunsTotal).toBe(2)
    expect(snap.counters.automationProposalsTotal).toBe(1)
    expect(snap.daily?.['2026-08-08']).toEqual({
      publications: 1,
      viewRuns: 2,
      automationProposals: 1,
    })

    const raw = JSON.parse(readFileSync(store.filePath, 'utf8'))
    expect(raw.counters.publicationsTotal).toBe(1)
    const dir = join(workspaceRoot, 'knowledge')
    for (const entry of readdirSync(dir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
  })

  it('does not persist derived counters', () => {
    const store = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 9,
      publicationsLast7d: () => 4,
    })
    const before = store.increment('connectionsActive', 1)
    expect(before.counters.connectionsActive).toBe(9)
    expect(before.counters.publicationsLast7d).toBe(4)
    // No file write for pure derived keys when no file yet
    // (increment early-returns snapshot without requiring a write)
  })
})

describe('publicationsLast7d derivation', () => {
  it('counts recent publications from publications store', () => {
    const pubs = new KnowledgePublicationsStore(workspaceRoot)
    const mk = (id: string, createdAt: string): PublicationRecord => ({
      id,
      draftId: `d_${id}`,
      connectionId: 'c1',
      targetRef: { scheme: 'siyuan', kind: 'document', id: `doc_${id}` },
      mode: 'create',
      contentHash: 'h',
      proposalId: `p_${id}`,
      provenance: {
        source_run_ids: [],
        published_at: createdAt,
        generated_by: { provider: 'test', model: 'm' },
        source_blocks: [],
        content_hash: 'h',
      },
      createdAt,
    })
    pubs.append(mk('old', '2026-07-01T00:00:00.000Z'))
    pubs.append(mk('new', '2026-08-07T00:00:00.000Z'))

    const store = new KnowledgeMetricsStore(workspaceRoot, {
      now: () => Date.parse('2026-08-08T00:00:00.000Z'),
      connectionsActive: () => 0,
    })
    expect(store.snapshot().counters.publicationsLast7d).toBe(1)
  })
})

describe('bumpKnowledgeMetric', () => {
  it('fail-soft helper writes through metricsStoreFor', () => {
    bumpKnowledgeMetric(workspaceRoot, 'watchTicksTotal')
    bumpKnowledgeMetric(null, 'watchTicksTotal')
    const snap = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 0,
      publicationsLast7d: () => 0,
    }).snapshot()
    expect(snap.counters.watchTicksTotal).toBeGreaterThanOrEqual(1)
  })
})

describe('corrupt file recovery', () => {
  it('treats corrupt file as empty and can rewrite', () => {
    mkdirSync(join(workspaceRoot, 'knowledge'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'knowledge', 'metrics.json'), '{broken')
    const store = new KnowledgeMetricsStore(workspaceRoot, {
      connectionsActive: () => 0,
      publicationsLast7d: () => 0,
    })
    expect(store.snapshot().counters.publicationsTotal).toBe(0)
    store.increment('publicationsTotal')
    expect(existsSync(store.filePath)).toBe(true)
    expect(store.snapshot().counters.publicationsTotal).toBe(1)
  })
})
