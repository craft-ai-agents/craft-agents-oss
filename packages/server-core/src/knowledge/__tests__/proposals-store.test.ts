/**
 * KnowledgeMutationProposalsStore tests (spec K-04 §3.3.4 file layout +
 * K-05 §3.7 lazy TTL sweep): save/get verbatim persistence, status/connectionId
 * list filters, fail-soft per-file parsing, atomic tmp+rename writes, and the
 * full sweep matrix — draft/pending_review TTL discard, approval-expiry
 * demotion, and terminal/'applying' immunity.
 *
 * Harness mirrors connections-store.test.ts: fresh mkdtemp per test, cleanup
 * in afterEach. The store is workspaceRoot-scoped (spec §3.3.4) and resolves
 * no config dir, so no CRAFT_CONFIG_DIR manipulation is needed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { APPROVAL_TTL_MS, DRAFT_TTL_MS } from '@craft-agent/core/knowledge'
import type { MutationProposalRecord, MutationProposalStatus } from '@craft-agent/shared/protocol'
import { KnowledgeMutationProposalsStore, parseProposalFile } from '../proposals-store'

let workspaceRoot: string
const tmpDirs: string[] = []

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-proposals-'))
  tmpDirs.push(workspaceRoot)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

const T0 = Date.parse('2026-08-07T00:00:00.000Z')

function makeRecord(id: string, over: Partial<MutationProposalRecord> = {}): MutationProposalRecord {
  const createdAt = new Date(T0).toISOString()
  return {
    id,
    connectionId: 'conn-1',
    targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
    ops: [{ op: 'appendBlock', documentId: 'doc-1', markdown: 'hello' }],
    selectionProofs: [],
    baseHash: 'base-hash-1',
    baseReadAt: createdAt,
    preState: 'PRE-STATE',
    hashAlgorithm: 'sha256-canonical-v1',
    status: 'draft',
    statusHistory: [{ from: 'draft', to: 'draft', at: createdAt, actor: 'agent', reason: 'created' }],
    createdAt,
    actor: 'agent',
    ...over,
  }
}

describe('path resolution', () => {
  it('resolves the per-workspace proposals dir (K-04 §3.3.4)', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    expect(store.proposalsDir).toBe(join(workspaceRoot, 'knowledge', 'proposals'))
  })
})

describe('save / get / list', () => {
  it('persists a record verbatim and reads it back', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    expect(store.list()).toEqual([])
    const record = makeRecord('p_01')
    expect(store.save(record)).toBe(record)
    expect(store.get('p_01')).toEqual(record)
    expect(store.list()).toEqual([record])
    // Raw file holds the same document (fail-soft parse of real bytes).
    expect(parseProposalFile(readFileSync(join(store.proposalsDir, 'p_01.json'), 'utf8'))).toEqual(record)
  })

  it('update rewrites by id: status changes, statusHistory grows, no duplicates', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    const record = store.save(makeRecord('p_02'))
    const updated: MutationProposalRecord = {
      ...record,
      status: 'pending_review',
      diff: '--- base\n+++ patched\n',
      statusHistory: [
        ...record.statusHistory,
        { from: 'draft', to: 'pending_review', at: new Date(T0 + 60_000).toISOString(), actor: 'user' },
      ],
    }
    expect(store.save(updated)).toBe(updated)
    expect(store.list()).toHaveLength(1)
    const reread = store.get('p_02')!
    expect(reread.status).toBe('pending_review')
    expect(reread.statusHistory).toHaveLength(2)
    expect(reread.statusHistory[1]!.to).toBe('pending_review')
    expect(reread.diff).toBe('--- base\n+++ patched\n')
  })

  it('returns null for unknown or path-unsafe ids', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    expect(store.get('nope')).toBeNull()
    expect(store.get('../escape')).toBeNull()
    expect(store.get('a/b')).toBeNull()
  })

  it('refuses to save a path-unsafe id', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    expect(() => store.save(makeRecord('../evil'))).toThrow(TypeError)
    expect(store.list()).toEqual([])
  })

  it('list returns newest createdAt first', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    store.save(makeRecord('p_old', { createdAt: new Date(T0).toISOString() }))
    store.save(makeRecord('p_new', { createdAt: new Date(T0 + 5_000).toISOString() }))
    store.save(makeRecord('p_mid', { createdAt: new Date(T0 + 2_000).toISOString() }))
    expect(store.list().map(r => r.id)).toEqual(['p_new', 'p_mid', 'p_old'])
  })
})

describe('remove', () => {
  it('removes an existing record once', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    store.save(makeRecord('p_03'))
    expect(store.remove('p_03')).toBe(true)
    expect(store.list()).toEqual([])
    expect(store.remove('p_03')).toBe(false)
    expect(store.remove('../escape')).toBe(false)
  })
})

describe('list filters', () => {
  it('filters by status and connectionId (independently and combined)', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    store.save(makeRecord('p1', { connectionId: 'conn-a', status: 'draft', createdAt: new Date(T0).toISOString() }))
    store.save(makeRecord('p2', { connectionId: 'conn-a', status: 'approved', createdAt: new Date(T0 + 1_000).toISOString() }))
    store.save(makeRecord('p3', { connectionId: 'conn-b', status: 'draft', createdAt: new Date(T0 + 2_000).toISOString() }))
    store.save(makeRecord('p4', { connectionId: 'conn-b', status: 'applied', createdAt: new Date(T0 + 3_000).toISOString() }))
    const ids = (rs: MutationProposalRecord[]) => rs.map(r => r.id)
    expect(ids(store.list())).toEqual(['p4', 'p3', 'p2', 'p1'])
    expect(ids(store.list({ status: 'draft' }))).toEqual(['p3', 'p1'])
    expect(ids(store.list({ status: 'approved' }))).toEqual(['p2'])
    expect(ids(store.list({ connectionId: 'conn-a' }))).toEqual(['p2', 'p1'])
    expect(ids(store.list({ connectionId: 'conn-b' }))).toEqual(['p4', 'p3'])
    expect(ids(store.list({ status: 'draft', connectionId: 'conn-a' }))).toEqual(['p1'])
    expect(ids(store.list({ status: 'approved', connectionId: 'conn-b' }))).toEqual([])
  })
})

describe('fail-soft parsing', () => {
  it('a corrupt proposal file is isolated: get null, list skips, sweep survives', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    const good = store.save(makeRecord('p_good', { status: 'applied', createdAt: new Date(T0).toISOString() }))
    mkdirSync(store.proposalsDir, { recursive: true })
    writeFileSync(join(store.proposalsDir, 'p_bad.json'), 'not json at all {{{')
    expect(store.get('p_bad')).toBeNull()
    expect(store.list()).toEqual([good])
    // Sweep skips the corrupt file instead of throwing and leaves it on disk.
    expect(store.sweepExpired(T0 + 365 * 24 * 60 * 60 * 1000)).toEqual({ discarded: [], approvalExpired: [] })
    expect(store.get('p_good')).toEqual(good)
  })

  it('parseProposalFile rejects non-records and corrupt content', () => {
    const good = makeRecord('p_ok')
    expect(parseProposalFile(JSON.stringify(good))).toEqual(good)
    expect(parseProposalFile('{{{ corrupt')).toBeNull()
    expect(parseProposalFile('')).toBeNull()
    expect(parseProposalFile(JSON.stringify({ id: 'p_x', status: 'draft' }))).toBeNull()
    expect(parseProposalFile(JSON.stringify(null))).toBeNull()
    // preState must be a string (K-05 record); a core-engine record with preState omitted is not a wire record.
    const { preState: _dropped, ...noPreState } = good
    expect(parseProposalFile(JSON.stringify(noPreState))).toBeNull()
  })
})

describe('sweepExpired (K-05 §3.7)', () => {
  const NOW = Date.parse('2026-09-01T00:00:00.000Z')

  function seed(): KnowledgeMutationProposalsStore {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    // Fresh draft — no TTL yet (history tail anchors the age, so keep it fresh too).
    store.save(makeRecord('draft-fresh', {
      status: 'draft',
      createdAt: new Date(NOW - 60_000).toISOString(),
      statusHistory: [{ from: 'draft', to: 'draft', at: new Date(NOW - 60_000).toISOString(), actor: 'agent' }],
    }))
    // Old draft — past DRAFT_TTL_MS since creation.
    store.save(makeRecord('draft-old', {
      status: 'draft',
      createdAt: new Date(NOW - DRAFT_TTL_MS - 1_000).toISOString(),
      statusHistory: [{ from: 'draft', to: 'draft', at: new Date(NOW - DRAFT_TTL_MS - 1_000).toISOString(), actor: 'agent' }],
    }))
    // Old pending_review — past DRAFT_TTL_MS since the last decision.
    store.save(makeRecord('pending-old', {
      status: 'pending_review',
      createdAt: new Date(NOW - DRAFT_TTL_MS - 60_000).toISOString(),
      statusHistory: [{ from: 'draft', to: 'pending_review', at: new Date(NOW - DRAFT_TTL_MS - 1_000).toISOString(), actor: 'user' }],
    }))
    // Recently-EDITED pending_review: createdAt is ancient but the last decision is fresh → kept.
    store.save(makeRecord('pending-active', {
      status: 'pending_review',
      createdAt: new Date(NOW - DRAFT_TTL_MS - 60_000).toISOString(),
      statusHistory: [
        { from: 'draft', to: 'pending_review', at: new Date(NOW - DRAFT_TTL_MS - 10_000).toISOString(), actor: 'user' },
        { from: 'pending_review', to: 'pending_review', at: new Date(NOW - 5_000).toISOString(), actor: 'user', reason: 'rebased' },
      ],
    }))
    // Fresh approval.
    store.save(makeRecord('approved-fresh', {
      status: 'approved',
      approvedBy: 'user',
      approvedAt: new Date(NOW - 60_000).toISOString(),
    }))
    // Expired approval → demotion to pending_review.
    store.save(makeRecord('approved-old', {
      status: 'approved',
      approvedBy: 'user',
      approvedAt: new Date(NOW - APPROVAL_TTL_MS - 1_000).toISOString(),
    }))
    // Approved with missing approvedAt → not expiry-checkable, untouched.
    store.save(makeRecord('approved-noat', { status: 'approved', approvedBy: 'user' }))
    // Terminal states + applying: never swept, however old (seeds with ancient timestamps).
    const ancient = {
      createdAt: new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString(),
      approvedAt: new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString(),
    }
    for (const status of ['applying', 'conflict', 'applied', 'superseded', 'rolled_back'] as MutationProposalStatus[]) {
      store.save(makeRecord(`terminal-${status}`, { status, ...ancient }))
    }
    return store
  }

  it('discards stale drafts, demotes expired approvals, leaves everything else', () => {
    const store = seed()
    const result = store.sweepExpired(NOW)
    expect([...result.discarded].sort()).toEqual(['draft-old', 'pending-old'])
    expect(result.approvalExpired).toEqual(['approved-old'])

    // Discarded files are gone (T4 removes the file).
    expect(store.get('draft-old')).toBeNull()
    expect(store.get('pending-old')).toBeNull()
    expect(existsSync(join(store.proposalsDir, 'draft-old.json'))).toBe(false)

    // Fresh + active proposals untouched.
    expect(store.get('draft-fresh')).not.toBeNull()
    expect(store.get('pending-active')?.status).toBe('pending_review')
    expect(store.get('approved-fresh')?.status).toBe('approved')
    expect(store.get('approved-noat')?.status).toBe('approved')

    // Approval-expired: back to pending_review, history entry, approval fields cleared.
    const demoted = store.get('approved-old')!
    expect(demoted.status).toBe('pending_review')
    expect(demoted.approvedAt).toBeUndefined()
    expect(demoted.approvedBy).toBeUndefined()
    expect('approvedAt' in demoted).toBe(false)
    expect('approvedBy' in demoted).toBe(false)
    const tail = demoted.statusHistory[demoted.statusHistory.length - 1]!
    expect(tail).toEqual({
      from: 'approved',
      to: 'pending_review',
      at: new Date(NOW).toISOString(),
      actor: 'automation',
      reason: 'approval-expired',
    })

    // Terminal states + applying persist byte-identical.
    for (const status of ['applying', 'conflict', 'applied', 'superseded', 'rolled_back'] as MutationProposalStatus[]) {
      const r = store.get(`terminal-${status}`)!
      expect(r.status).toBe(status)
      expect(r.statusHistory).toHaveLength(1)
    }
  })

  it('is idempotent: a second sweep at the same now re-finds nothing', () => {
    const store = seed()
    store.sweepExpired(NOW)
    expect(store.sweepExpired(NOW)).toEqual({ discarded: [], approvalExpired: [] })
    // The demoted proposal becomes an ordinary fresh pending_review.
    expect(store.get('approved-old')?.status).toBe('pending_review')
  })
})

describe('atomic writes', () => {
  it('leaves no tmp files behind after mutations', () => {
    const store = new KnowledgeMutationProposalsStore(workspaceRoot)
    store.save(makeRecord('p_a'))
    store.save(makeRecord('p_a', { status: 'pending_review' }))
    store.remove('p_a')
    store.save(makeRecord('p_b'))
    for (const entry of readdirSync(store.proposalsDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
    expect(existsSync(join(store.proposalsDir, 'p_b.json'))).toBe(true)
  })

  it('cleans orphan tmp files on construction (K-04 §5)', () => {
    const dir = join(workspaceRoot, 'knowledge', 'proposals')
    mkdirSync(dir, { recursive: true })
    const orphan = join(dir, '.999-1.proposal.tmp')
    writeFileSync(orphan, '{"partial":')
    new KnowledgeMutationProposalsStore(workspaceRoot)
    expect(existsSync(orphan)).toBe(false)
  })
})
