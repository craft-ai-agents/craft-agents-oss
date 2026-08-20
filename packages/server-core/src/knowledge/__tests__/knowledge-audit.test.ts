/**
 * KnowledgeAuditLog tests (spec K-05 §3.8 + K-04 §3.3.6): append writes
 * AuditEntry-compatible jsonl lines (validated through the real
 * parseAuditEntries), the widened actor union ('automation') round-trips,
 * all 12 action strings are exact, rotation honors AUDIT_LIMITS, and corrupt
 * lines are skipped. Harness mirrors connections-store.test.ts (mkdtemp +
 * afterEach cleanup); the log is workspaceRoot-scoped, no CRAFT_CONFIG_DIR.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AUDIT_LIMITS, parseAuditEntries } from '../../memory/AuditLog'
import { KNOWLEDGE_AUDIT_ACTIONS, KnowledgeAuditLog } from '../knowledge-audit'

let workspaceRoot: string
const tmpDirs: string[] = []

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'knowledge-audit-'))
  tmpDirs.push(workspaceRoot)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('path resolution', () => {
  it('targets {workspaceRoot}/knowledge/audit.jsonl (K-05 §3.8)', () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    expect(log.knowledgeDir).toBe(join(workspaceRoot, 'knowledge'))
    expect(log.filePath).toBe(join(workspaceRoot, 'knowledge', 'audit.jsonl'))
  })
})

describe('append', () => {
  it('writes an AuditEntry-parseable line with ts/scope filled in', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    await log.append({
      actor: 'agent',
      action: 'knowledge.proposal.applied',
      target: 'siyuan://blocks/20260803120000-a1b2c3d',
      detail: JSON.stringify({ proposalId: 'p_01', baseHash: '9f2c', postHash: '41de', sessionId: 's_123' }),
    })
    const entries = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.actor).toBe('agent')
    expect(entry.action).toBe('knowledge.proposal.applied')
    expect(entry.target).toBe('siyuan://blocks/20260803120000-a1b2c3d')
    expect(entry.detail).toBe(JSON.stringify({ proposalId: 'p_01', baseHash: '9f2c', postHash: '41de', sessionId: 's_123' }))
    expect(entry.scope).toBe('workspace')
    expect(Number.isNaN(Date.parse(entry.ts))).toBe(false)
  })

  it("accepts the widened actor union — 'automation' round-trips (K-05 §3.8)", async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    await log.append({ actor: 'automation', action: 'knowledge.proposal.approval_expired', target: 'p_02' })
    await log.append({ actor: 'user', action: 'knowledge.proposal.approved', target: 'p_03' })
    await log.append({ actor: 'agent', action: 'knowledge.proposal.created', target: 'p_04' })
    const entries = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(entries.map(e => e.actor)).toEqual(['automation', 'user', 'agent'])
  })

  it('honors an explicit ts override, like AuditLog', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    const ts = '2026-08-07T12:34:56.789Z'
    await log.append({ actor: 'user', action: 'knowledge.proposal.rejected', target: 'p_05', ts })
    const entries = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(entries[0]!.ts).toBe(ts)
  })

  it('read() returns the newest entries first', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    await log.append({ actor: 'user', action: 'knowledge.proposal.created', target: 'p_10' })
    await log.append({ actor: 'user', action: 'knowledge.proposal.approved', target: 'p_10' })
    expect(log.read().map(e => e.action)).toEqual(['knowledge.proposal.approved', 'knowledge.proposal.created'])
    expect(log.read(1).map(e => e.target)).toEqual(['p_10'])
  })
})

describe('action strings (K-05 §3.8, full list)', () => {
  it('constants are the exact §3.8 strings in spec order', () => {
    expect([...KNOWLEDGE_AUDIT_ACTIONS]).toEqual([
      'knowledge.proposal.created',
      'knowledge.proposal.reviewed',
      'knowledge.proposal.approved',
      'knowledge.proposal.rejected',
      'knowledge.proposal.applied',
      'knowledge.proposal.conflict',
      'knowledge.proposal.rolled_back',
      'knowledge.proposal.approval_expired',
      'knowledge.snapshot.created',
      'knowledge.publication.created',
      'knowledge.publish.applied',
      'knowledge.link.added',
      'knowledge.link.removed',
    ])
  })

  it('every §3.8 action round-trips through append → parseAuditEntries', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    for (const action of KNOWLEDGE_AUDIT_ACTIONS) {
      await log.append({ actor: 'automation', action, target: `target-for-${action}` })
    }
    const entries = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(entries.map(e => e.action)).toEqual([...KNOWLEDGE_AUDIT_ACTIONS])
    expect(entries.map(e => e.target)).toEqual(KNOWLEDGE_AUDIT_ACTIONS.map(a => `target-for-${a}`))
  })
})

describe('rotation (AUDIT_LIMITS pattern)', () => {
  it('rotates tail-first when the file grows past maxLines', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    const total = AUDIT_LIMITS.maxLines + 1
    for (let i = 0; i < total; i++) {
      await log.append({ actor: 'agent', action: 'knowledge.proposal.created', target: `entry-${i}` })
    }
    const raw = readFileSync(log.filePath, 'utf8').trim().split('\n')
    expect(raw).toHaveLength(AUDIT_LIMITS.keepLines)
    // Tail-first rotation: the newest entries survive.
    const parsed = raw.map(l => JSON.parse(l))
    expect(parsed[0].target).toBe(`entry-${total - AUDIT_LIMITS.keepLines}`)
    expect(parsed[parsed.length - 1].target).toBe(`entry-${total - 1}`)
    // Atomic rotation leaves no tmp files behind.
    for (const entry of readdirSync(log.knowledgeDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
  })
})

describe('corrupt lines', () => {
  it('skips corrupt lines on parse and keeps appending around them', async () => {
    const log = new KnowledgeAuditLog(workspaceRoot)
    const goodLine = JSON.stringify({
      ts: '2026-08-07T00:00:00.000Z',
      scope: 'workspace',
      actor: 'user',
      action: 'knowledge.proposal.created',
      target: 'good-before',
    })
    mkdirSync(log.knowledgeDir, { recursive: true })
    writeFileSync(log.filePath, `${goodLine}\n{{{ corrupt line\nnot json at all\n`)
    // Pre-existing corruption round-trips safely…
    const before = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(before).toHaveLength(1)
    expect(before[0]!.target).toBe('good-before')
    // …and appends after corruption stay parseable.
    await log.append({ actor: 'agent', action: 'knowledge.link.added', target: 'good-after' })
    const after = parseAuditEntries(readFileSync(log.filePath, 'utf8'))
    expect(after.map(e => e.target)).toEqual(['good-before', 'good-after'])
  })
})
