import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  INSTALL_MARKER_NAME,
  MARKETPLACE_LOCK_VERSION,
  markerPathFor,
  readInstallMarker,
  readLock,
  removeInstallMarker,
  removeLockRecord,
  upsertLockRecord,
  writeInstallMarker,
  type MarketplaceLockRecord,
} from '../lock.ts'

const REF = 'b'.repeat(40)

function record(id: string, targets: string[]): MarketplaceLockRecord {
  return { id, kind: 'skillpack', repo: 'owner/repo', ref: REF, installedAt: 123, status: 'installed', targets }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'craft-marketplace-lock-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('lock.json registry', () => {
  it('round-trips records through upsert/read/remove', () => {
    const lockPath = join(dir, 'lock.json')
    expect(readLock(lockPath)).toEqual({ version: MARKETPLACE_LOCK_VERSION, entries: {} })

    upsertLockRecord(lockPath, record('alpha', ['/tmp/a']))
    upsertLockRecord(lockPath, record('beta', ['/tmp/b']))
    // idempotent replace, not duplicate
    upsertLockRecord(lockPath, record('alpha', ['/tmp/a2']))

    const lock = readLock(lockPath)
    expect(Object.keys(lock.entries).sort()).toEqual(['alpha', 'beta'])
    expect(lock.entries.alpha!.targets).toEqual(['/tmp/a2'])
    expect(lock.entries.beta!.ref).toBe(REF)

    removeLockRecord(lockPath, 'alpha')
    expect(Object.keys(readLock(lockPath).entries)).toEqual(['beta'])
  })

  it('survives a corrupt lock file (treated as empty)', () => {
    const lockPath = join(dir, 'lock.json')
    writeFileSync(lockPath, '{not json')
    expect(readLock(lockPath).entries).toEqual({})
  })
})

describe('per-install provenance markers', () => {
  it('writes markers inside directory targets and beside .md targets', () => {
    const dirTarget = join(dir, 'skills', 'my-skill')
    const mdTarget = join(dir, 'context', 'soul.md')
    mkdirSync(dirTarget, { recursive: true })
    mkdirSync(join(dir, 'context'), { recursive: true })

    const rec = record('pack', [dirTarget, mdTarget])
    writeInstallMarker(dirTarget, rec)
    writeInstallMarker(mdTarget, rec)

    expect(markerPathFor(dirTarget)).toBe(join(dirTarget, INSTALL_MARKER_NAME))
    expect(markerPathFor(mdTarget)).toBe(`${mdTarget}${INSTALL_MARKER_NAME}`)
    expect(existsSync(markerPathFor(dirTarget))).toBe(true)
    expect(existsSync(markerPathFor(mdTarget))).toBe(true)
    expect(readInstallMarker(dirTarget)?.id).toBe('pack')
    expect(readInstallMarker(mdTarget)?.ref).toBe(REF)

    removeInstallMarker(dirTarget)
    removeInstallMarker(mdTarget)
    expect(readInstallMarker(dirTarget)).toBeNull()
    expect(readInstallMarker(mdTarget)).toBeNull()
  })
})
