/**
 * KnowledgeContextSnapshotsStore tests (spec K-04 §3.3.2 + §3.4) — per-file
 * capture layout, session filtering and ordering, fail-soft parsing of
 * corrupt files, lazy LRU retention by capturedAt, and atomic tmp+rename
 * writes (no tmp files left behind).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { KnowledgeRef } from '@craft-agent/core/knowledge'
import {
  KnowledgeContextSnapshotsStore,
  SNAPSHOT_LIMITS,
  parseSnapshotFile,
  type CreateSnapshotInput,
  type KnowledgeContextSnapshotRecord,
} from '../snapshots-store'

const REF: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: '20240101000000-abcdefg' }

function makeInput(sessionId: string, overrides: Partial<CreateSnapshotInput> = {}): CreateSnapshotInput {
  return {
    sessionId,
    provider: 'siyuan',
    ref: REF,
    contentHash: 'deadbeef'.repeat(8),
    snapshot: { content: '# captured', mode: 'snapshot' },
    ...overrides,
  }
}

let workspaceRoot: string
const tmpDirs: string[] = []

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-ws-'))
  tmpDirs.push(workspaceRoot)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('create / get', () => {
  it('writes an immutable per-file record under {workspaceRoot}/knowledge/snapshots', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    expect(store.snapshotsDir).toBe(join(workspaceRoot, 'knowledge', 'snapshots'))
    const record = store.create(makeInput('sess-1'))
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number.isNaN(Date.parse(record.capturedAt))).toBe(false)
    expect(JSON.parse(record.refJson)).toEqual(REF)
    expect(record.contentHash).toBe('deadbeef'.repeat(8))
    expect(JSON.parse(record.snapshotJson)).toEqual({ content: '# captured', mode: 'snapshot' })
    const filePath = join(store.snapshotsDir, `${record.id}.json`)
    expect(existsSync(filePath)).toBe(true)
    // The file on disk is exactly the stored record.
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(record)
    expect(store.get(record.id)).toEqual(record)
  })

  it('honors an explicit capturedAt', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    const record = store.create(makeInput('sess-1', { capturedAt: '2026-08-01T00:00:00.000Z' }))
    expect(record.capturedAt).toBe('2026-08-01T00:00:00.000Z')
  })

  it('returns null for unknown or unsafe ids', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    expect(store.get('nope')).toBeNull()
    expect(store.get('../../../etc/passwd')).toBeNull()
    expect(store.get('a/b')).toBeNull()
  })
})

describe('listBySession', () => {
  it('filters by session and returns newest first', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    const oldest = store.create(makeInput('sess-1', { capturedAt: '2026-08-01T00:00:00.000Z' }))
    const other = store.create(makeInput('sess-2', { capturedAt: '2026-08-02T00:00:00.000Z' }))
    const newest = store.create(makeInput('sess-1', { capturedAt: '2026-08-03T00:00:00.000Z' }))
    const forSess1 = store.listBySession('sess-1')
    expect(forSess1.map(r => r.id)).toEqual([newest.id, oldest.id])
    expect(store.listBySession('sess-2')).toEqual([other])
    expect(store.listBySession('sess-3')).toEqual([])
  })

  it('skips corrupt and non-record files without dropping the valid tail', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    const good = store.create(makeInput('sess-1', { capturedAt: '2026-08-01T00:00:00.000Z' }))
    mkdirSync(store.snapshotsDir, { recursive: true })
    writeFileSync(join(store.snapshotsDir, 'broken.json'), '{{{ not json')
    writeFileSync(join(store.snapshotsDir, 'wrong-shape.json'), JSON.stringify({ id: 42 }))
    writeFileSync(join(store.snapshotsDir, 'notes.txt'), 'ignore me')
    expect(store.listBySession('sess-1')).toEqual([good])
    expect(store.get('broken')).toBeNull()
  })
})

describe('remove', () => {
  it('deletes the file once and reports unknown ids', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    const record = store.create(makeInput('sess-1'))
    expect(store.remove(record.id)).toBe(true)
    expect(existsSync(join(store.snapshotsDir, `${record.id}.json`))).toBe(false)
    expect(store.remove(record.id)).toBe(false)
    expect(store.remove('a/b')).toBe(false)
  })
})

describe('retention', () => {
  it('exposes the ~200MB budget constant from K-04 §3.4', () => {
    expect(SNAPSHOT_LIMITS.maxTotalBytes).toBe(200 * 1024 * 1024)
  })

  it('lazily evicts oldest-by-capturedAt once the dir exceeds the budget', () => {
    // Calibrate one record's on-disk size with effectively-unlimited budget.
    const probe = new KnowledgeContextSnapshotsStore(workspaceRoot, { maxTotalBytes: Number.MAX_SAFE_INTEGER })
    const s1 = probe.create(makeInput('sess-1', { capturedAt: '2026-08-01T00:00:00.000Z' }))
    const size = statSync(join(probe.snapshotsDir, `${s1.id}.json`)).size

    // Same workspace, budget that fits two records but not three.
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot, { maxTotalBytes: size * 2 + 1 })
    const s2 = store.create(makeInput('sess-1', { capturedAt: '2026-08-02T00:00:00.000Z' }))
    expect(store.get(s1.id)).not.toBeNull()

    const s3 = store.create(makeInput('sess-1', { capturedAt: '2026-08-03T00:00:00.000Z' }))
    // Oldest snapshot is evicted; the two newest survive.
    expect(store.get(s1.id)).toBeNull()
    expect(store.get(s2.id)).not.toBeNull()
    expect(store.get(s3.id)).not.toBeNull()
    expect(store.listBySession('sess-1').map(r => r.id)).toEqual([s3.id, s2.id])
  })
})

describe('atomic writes', () => {
  it('leaves no tmp files behind after captures', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    store.create(makeInput('sess-1'))
    store.create(makeInput('sess-1'))
    for (const entry of readdirSync(store.snapshotsDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
  })

  it('cleans orphan tmp files on construction', () => {
    const store = new KnowledgeContextSnapshotsStore(workspaceRoot)
    mkdirSync(store.snapshotsDir, { recursive: true })
    const orphan = join(store.snapshotsDir, '.888-1.snapshot.tmp')
    writeFileSync(orphan, '{"partial":')
    new KnowledgeContextSnapshotsStore(workspaceRoot)
    expect(existsSync(orphan)).toBe(false)
  })
})

describe('parseSnapshotFile', () => {
  it('returns records for valid content and null for anything else', () => {
    expect(parseSnapshotFile('{{{ corrupt')).toBeNull()
    expect(parseSnapshotFile('')).toBeNull()
    expect(parseSnapshotFile(JSON.stringify({ id: 'x' }))).toBeNull()
    const record: KnowledgeContextSnapshotRecord = {
      id: 's1', sessionId: 'sess-1', provider: 'siyuan',
      refJson: JSON.stringify(REF), contentHash: 'abc', capturedAt: '2026-08-01T00:00:00.000Z',
      snapshotJson: JSON.stringify({ content: 'x' }),
    }
    expect(parseSnapshotFile(JSON.stringify(record))).toEqual(record)
  })
})
