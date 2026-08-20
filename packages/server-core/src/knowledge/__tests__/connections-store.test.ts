/**
 * KnowledgeConnectionsStore tests (spec K-04 §3.3.1) — path resolution,
 * save/remove/setStatus upsert semantics, fail-soft parsing of corrupt
 * connections.json, and atomic tmp+rename writes (no tmp files left behind).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { KnowledgeConnectionsStore, parseConnectionFile, type KnowledgeConnectionRecord } from '../connections-store'

let configDir: string
const tmpDirs: string[] = []

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'knowledge-config-'))
  tmpDirs.push(configDir)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('path resolution', () => {
  it('resolves connections.json under {configDir}/knowledge', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.knowledgeDir).toBe(join(configDir, 'knowledge'))
    expect(store.filePath).toBe(join(configDir, 'knowledge', 'connections.json'))
  })

  it('reads CRAFT_CONFIG_DIR lazily at construction time', () => {
    const prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = configDir
    try {
      const store = new KnowledgeConnectionsStore()
      expect(store.knowledgeDir).toBe(join(configDir, 'knowledge'))
    } finally {
      if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = prev
    }
  })
})

describe('save / list / get', () => {
  it('creates a record with generated uuid, defaults, and ISO timestamps', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.list()).toEqual([])
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'source_bearer::ws-1::conn-1' })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(saved.provider).toBe('siyuan')
    expect(saved.mode).toBe('external-local')
    expect(saved.status).toBe('unknown')
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false)
    expect(Number.isNaN(Date.parse(saved.updatedAt))).toBe(false)
    // The file holds no secret material — only the CredentialManager key (K-04 §5).
    expect(Object.keys(saved).sort()).toEqual(
      ['baseUrl', 'createdAt', 'credentialRef', 'id', 'mode', 'provider', 'status', 'updatedAt'].sort(),
    )
    expect(store.list()).toEqual([saved])
    expect(store.get(saved.id)).toEqual(saved)
  })

  it('round-trips optional version and capabilitiesJson', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({
      baseUrl: 'http://localhost:6806',
      credentialRef: 'source_bearer::ws-1::conn-2',
      version: '3.1.20',
      capabilitiesJson: JSON.stringify({ search: true, backlinks: true }),
    })
    expect(store.get(saved.id)).toEqual(saved)
    expect(JSON.parse(store.get(saved.id)!.capabilitiesJson!)).toEqual({ search: true, backlinks: true })
  })

  it('upserts by id: preserves createdAt, refreshes updatedAt, replaces fields', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const created = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'source_bearer::ws-1::conn-3' })
    const updated = store.save({
      id: created.id,
      baseUrl: 'http://127.0.0.1:6806',
      credentialRef: 'source_bearer::ws-1::conn-3',
      status: 'ok',
      version: '3.1.21',
    })
    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt >= created.createdAt).toBe(true)
    expect(updated.baseUrl).toBe('http://127.0.0.1:6806')
    expect(updated.status).toBe('ok')
    expect(updated.version).toBe('3.1.21')
    expect(store.list()).toHaveLength(1)
  })

  it('creates a new record when save gets an explicit unknown id', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ id: 'conn-explicit', baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(saved.id).toBe('conn-explicit')
    expect(store.get('conn-explicit')).toEqual(saved)
  })

  it('returns null for unknown ids', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    expect(store.get('nope')).toBeNull()
  })
})

describe('remove / setStatus', () => {
  it('removes an existing record once', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(store.remove(saved.id)).toBe(true)
    expect(store.list()).toEqual([])
    expect(store.remove(saved.id)).toBe(false)
  })

  it('transitions the cached probe status', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    const probed = store.setStatus(saved.id, 'ok')
    expect(probed?.status).toBe('ok')
    expect(store.setStatus(saved.id, 'needs_auth')?.status).toBe('needs_auth')
    expect(store.get(saved.id)?.status).toBe('needs_auth')
    expect(store.setStatus('nope', 'ok')).toBeNull()
  })
})

describe('fail-soft parsing', () => {
  it('treats a corrupt connections.json as empty and recovers on save', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    writeFileSync(store.filePath, 'not json at all {{{')
    expect(store.list()).toEqual([])
    expect(store.get('anything')).toBeNull()
    const saved = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref' })
    expect(store.list()).toEqual([saved])
  })

  it('treats valid JSON with a non-array root as empty', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    writeFileSync(store.filePath, JSON.stringify({ connections: [] }))
    expect(store.list()).toEqual([])
  })

  it('parseConnectionFile skips entries that do not look like records', () => {
    const good: KnowledgeConnectionRecord = {
      id: 'c1', provider: 'siyuan', mode: 'external-local', baseUrl: 'http://localhost:6806',
      credentialRef: 'ref', status: 'unknown', createdAt: '2026-08-07T00:00:00.000Z', updatedAt: '2026-08-07T00:00:00.000Z',
    }
    const parsed = parseConnectionFile(JSON.stringify([good, { id: 42 }, null, 'junk']))
    expect(parsed).toEqual([good])
    expect(parseConnectionFile('{{{ corrupt')).toEqual([])
    expect(parseConnectionFile('')).toEqual([])
  })
})

describe('atomic writes', () => {
  it('leaves no tmp files behind after mutations', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    const a = store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref-a' })
    store.setStatus(a.id, 'ok')
    store.remove(a.id)
    store.save({ baseUrl: 'http://localhost:6806', credentialRef: 'ref-b' })
    for (const entry of readdirSync(store.knowledgeDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
    expect(existsSync(store.filePath)).toBe(true)
  })

  it('cleans orphan tmp files on construction', () => {
    const store = new KnowledgeConnectionsStore(configDir)
    mkdirSync(store.knowledgeDir, { recursive: true })
    const orphan = join(store.knowledgeDir, '.999-1.connections.tmp')
    writeFileSync(orphan, '{"partial":')
    new KnowledgeConnectionsStore(configDir)
    expect(existsSync(orphan)).toBe(false)
  })
})
