/**
 * KnowledgeWorkEnvelopesStore — jsonl upsert by kind:id (S-08).
 */
import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { KnowledgeRef } from '@craft-agent/core/knowledge'
import { KnowledgeWorkEnvelopesStore, parseWorkEnvelopeLine } from '../work-envelopes-store'

const REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' }
const REF2: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-2' }

describe('parseWorkEnvelopeLine', () => {
  it('skips corrupt / incomplete lines', () => {
    expect(parseWorkEnvelopeLine('')).toBeNull()
    expect(parseWorkEnvelopeLine('{not json')).toBeNull()
    expect(parseWorkEnvelopeLine(JSON.stringify({ knowledgeRef: REF }))).toBeNull()
  })

  it('parses a valid envelope', () => {
    const env = parseWorkEnvelopeLine(
      JSON.stringify({
        knowledgeRef: REF,
        status: 'open',
        labels: ['a'],
        flagged: true,
        createdAt: 1,
        updatedAt: 2,
      }),
    )
    expect(env).toEqual({
      knowledgeRef: REF,
      status: 'open',
      labels: ['a'],
      flagged: true,
      archived: undefined,
      assignedTo: undefined,
      createdAt: 1,
      updatedAt: 2,
    })
  })
})

describe('KnowledgeWorkEnvelopesStore', () => {
  it('upserts by kind:id, preserves createdAt, last-write-wins', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-store-'))
    try {
      const store = new KnowledgeWorkEnvelopesStore(root)
      expect(store.get(REF)).toBeNull()

      const first = store.upsert({
        knowledgeRef: REF,
        status: 'open',
        createdAt: 100,
        updatedAt: 100,
      })
      expect(first.status).toBe('open')
      expect(store.get(REF)?.status).toBe('open')

      const second = store.upsert({
        knowledgeRef: REF,
        status: 'done',
        flagged: true,
        createdAt: 999, // ignored — preserves first.createdAt
        updatedAt: 200,
      })
      expect(second.createdAt).toBe(100)
      expect(second.updatedAt).toBe(200)
      expect(second.status).toBe('done')
      expect(second.flagged).toBe(true)

      store.upsert({
        knowledgeRef: REF2,
        labels: ['x'],
        createdAt: 50,
        updatedAt: 300,
      })
      const list = store.list()
      expect(list).toHaveLength(2)
      // sorted by updatedAt desc
      expect(list[0]!.knowledgeRef.id).toBe('doc-2')
      expect(list[1]!.knowledgeRef.id).toBe('doc-1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('compacts file to one line per key on upsert (no append history)', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-compact-'))
    try {
      const store = new KnowledgeWorkEnvelopesStore(root)
      store.upsert({
        knowledgeRef: REF,
        status: 'open',
        createdAt: 100,
        updatedAt: 100,
      })
      store.upsert({
        knowledgeRef: REF,
        status: 'done',
        createdAt: 100,
        updatedAt: 200,
      })
      store.upsert({
        knowledgeRef: REF2,
        status: 'open',
        createdAt: 50,
        updatedAt: 300,
      })
      const raw = readFileSync(store.filePath, 'utf8').trim().split('\n')
      expect(raw).toHaveLength(2)
      const parsed = raw.map((line) => JSON.parse(line) as { knowledgeRef: KnowledgeRef; status?: string })
      const byId = Object.fromEntries(parsed.map((e) => [e.knowledgeRef.id, e.status]))
      expect(byId['doc-1']).toBe('done')
      expect(byId['doc-2']).toBe('open')
      expect(store.get(REF)?.status).toBe('done')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fail-soft on corrupt file content', () => {
    const root = mkdtempSync(join(tmpdir(), 'env-corrupt-'))
    try {
      mkdirSync(join(root, 'knowledge'), { recursive: true })
      writeFileSync(
        join(root, 'knowledge', 'work-envelopes.jsonl'),
        'not-json\n' +
          JSON.stringify({ knowledgeRef: REF, createdAt: 1, updatedAt: 1 }) +
          '\n{bad\n',
        'utf8',
      )
      const store = new KnowledgeWorkEnvelopesStore(root)
      expect(store.list()).toHaveLength(1)
      expect(store.get(REF)?.knowledgeRef.id).toBe('doc-1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
