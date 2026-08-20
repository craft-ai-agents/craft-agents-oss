/**
 * AuditLog tests (spec F2) — path resolution per scope, append with ts/scope
 * fill-in, most-recent-first tail reads, corrupt-line tolerance, and
 * tail-rotation past 10k lines (atomic, no tmp files left behind).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AUDIT_LIMITS, AuditLog, parseAuditEntries } from '../AuditLog'

let configDir: string
let workspaceRoot: string

const tmpDirs: string[] = []

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'audit-config-'))
  workspaceRoot = mkdtempSync(join(tmpdir(), 'audit-ws-'))
  tmpDirs.push(configDir, workspaceRoot)
})

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
})

describe('path resolution', () => {
  it('resolves the global scope under the config dir', () => {
    const log = new AuditLog('global', undefined, configDir)
    expect(log.memoryDir).toBe(join(configDir, 'memory'))
    expect(log.filePath).toBe(join(configDir, 'memory', 'audit.jsonl'))
  })

  it('resolves the workspace scope under the workspace root', () => {
    const log = new AuditLog('workspace', workspaceRoot, configDir)
    expect(log.memoryDir).toBe(join(workspaceRoot, 'memory'))
  })

  it('throws when workspace scope has no root', () => {
    expect(() => new AuditLog('workspace', undefined, configDir)).toThrow()
  })

  it('reads CRAFT_CONFIG_DIR lazily at construction time', () => {
    const prev = process.env.CRAFT_CONFIG_DIR
    process.env.CRAFT_CONFIG_DIR = configDir
    try {
      const log = new AuditLog('global')
      expect(log.memoryDir).toBe(join(configDir, 'memory'))
    } finally {
      if (prev === undefined) delete process.env.CRAFT_CONFIG_DIR
      else process.env.CRAFT_CONFIG_DIR = prev
    }
  })
})

describe('append / read', () => {
  it('appends entries, filling in ts and scope; reads most recent first', () => {
    const log = new AuditLog('workspace', workspaceRoot, configDir)
    expect(log.read()).toEqual([])
    log.append({ actor: 'rpc', action: 'add', target: 'rule a' })
    log.append({ actor: 'queue', action: 'approved', target: 'skill-b', detail: 'extra' })
    const entries = log.read()
    expect(entries.map(e => [e.action, e.actor, e.target])).toEqual([
      ['approved', 'queue', 'skill-b'],
      ['add', 'rpc', 'rule a'],
    ])
    expect(entries[0].detail).toBe('extra')
    for (const e of entries) {
      expect(e.scope).toBe('workspace')
      expect(Number.isNaN(Date.parse(e.ts))).toBe(false)
    }
  })

  it('honors an explicit ts and returns tail-N with limit', () => {
    const log = new AuditLog('global', undefined, configDir)
    for (const [i, ts] of ['2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', '2026-08-03T00:00:00.000Z'].entries()) {
      log.append({ ts, actor: 'rpc', action: 'add', target: `t${i}` })
    }
    const tail = log.read(2)
    expect(tail.map(e => e.target)).toEqual(['t2', 't1'])
    expect(log.read().map(e => e.target)).toEqual(['t2', 't1', 't0'])
  })

  it('skips corrupt lines on read without throwing', () => {
    const log = new AuditLog('global', undefined, configDir)
    log.append({ actor: 'rpc', action: 'add', target: 'good' })
    writeFileSync(log.filePath, readFileSync(log.filePath, 'utf8') + 'not json\n{"broken"\n')
    const entries = log.read()
    expect(entries).toHaveLength(1)
    expect(entries[0].target).toBe('good')
    expect(parseAuditEntries('{"ts":"x"}\n{"noTs":true}\n\n')).toEqual([])
  })

  it('fresh instances see entries written by other instances', () => {
    new AuditLog('global', undefined, configDir).append({ actor: 'distill', action: 'add', target: 'shared file' })
    const entries = new AuditLog('global', undefined, configDir).read()
    expect(entries.map(e => [e.action, e.actor])).toEqual([['add', 'distill']])
  })
})

describe('rotation', () => {
  it('rewrites tail-first past maxLines, keeping keepLines, atomically', () => {
    const log = new AuditLog('workspace', workspaceRoot, configDir)
    const total = AUDIT_LIMITS.maxLines + 5
    for (let i = 0; i < total; i++) {
      log.append({ actor: 'rpc', action: 'add', target: `entry-${i}` })
    }
    const raw = readFileSync(log.filePath, 'utf8').trim().split('\n')
    // Crossed maxLines by one → rotated to keepLines, then 4 more appends.
    expect(raw).toHaveLength(AUDIT_LIMITS.keepLines + 4)
    const parsed = raw.map(l => JSON.parse(l))
    expect(parsed[0].target).toBe(`entry-${total - (AUDIT_LIMITS.keepLines + 4)}`) // entry-3001
    expect(parsed[parsed.length - 1].target).toBe(`entry-${total - 1}`) // newest kept
    // No tmp files left behind.
    for (const entry of readdirSync(log.memoryDir)) {
      expect(entry.endsWith('.tmp')).toBe(false)
    }
    expect(existsSync(log.filePath)).toBe(true)
    // Reads see the rotated tail, most recent first.
    const tail = log.read(3)
    expect(tail.map(e => e.target)).toEqual([`entry-${total - 1}`, `entry-${total - 2}`, `entry-${total - 3}`])
  })

  it('a fresh instance continues from the rotated file without re-rotating', () => {
    const log = new AuditLog('workspace', workspaceRoot, configDir)
    for (let i = 0; i < AUDIT_LIMITS.maxLines + 1; i++) {
      log.append({ actor: 'rpc', action: 'add', target: `e-${i}` })
    }
    const afterRotation = readFileSync(log.filePath, 'utf8').trim().split('\n').length
    expect(afterRotation).toBe(AUDIT_LIMITS.keepLines)
    const fresh = new AuditLog('workspace', workspaceRoot, configDir)
    fresh.append({ actor: 'rpc', action: 'add', target: 'after-rotation' })
    expect(readFileSync(fresh.filePath, 'utf8').trim().split('\n').length).toBe(AUDIT_LIMITS.keepLines + 1)
    expect(fresh.read(1)[0].target).toBe('after-rotation')
  })
})
