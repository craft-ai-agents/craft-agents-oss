/**
 * Marketplace install registry — lock.json + per-install provenance markers.
 * Spec: docs/runtime-context-marketplace-prd.md §8.1, plan §5 (M4a).
 *
 * Aggregate lock file: <CONFIG_DIR>/marketplace/lock.json — one record per
 * install. Additionally every installed target (skill dir / context doc)
 * gets a `.craft-marketplace.lock.json` marker so removal can prove we own
 * the artifact and detect local edits (soft-clean).
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { atomicWriteFileSync } from './catalog.ts'
import type { MarketplaceEntryKind } from './catalog.ts'

export const MARKETPLACE_LOCK_VERSION = 1 as const
export const INSTALL_MARKER_NAME = '.craft-marketplace.lock.json'

export interface MarketplaceLockRecord {
  /** Catalog entry id. */
  id: string
  kind: MarketplaceEntryKind
  /** Repository (owner/repo) and pinned commit this install came from. */
  repo: string
  ref: string
  installedAt: number
  updatedAt?: number
  /**
   * 'installed' — artifacts on disk (skillpack/context-doc) OR kind:tool whose
   *               toolchain.update completed with phase ready.
   * 'deferred'  — kind:tool intent recorded; toolchain install not yet ready
   *               (in progress / failed — user can retry Update).
   */
  status: 'installed' | 'deferred'
  /** Absolute paths of installed artifacts (skill dirs / doc files). */
  targets: string[]
  /** Installed skill dir basenames (skillpack, informational). */
  skills?: string[]
  /** kind:tool — toolchain manifest tool name. */
  toolName?: string
  /** target path → SHA-256 of its content at install time (soft-clean diffing). */
  contentSha256?: Record<string, string>
}

export interface MarketplaceLockFile {
  version: typeof MARKETPLACE_LOCK_VERSION
  entries: Record<string, MarketplaceLockRecord>
}

const EMPTY_LOCK: MarketplaceLockFile = { version: MARKETPLACE_LOCK_VERSION, entries: {} }

/** Read the aggregate lock file. Missing/corrupt → empty registry (never throws). */
export function readLock(lockPath: string): MarketplaceLockFile {
  try {
    if (!existsSync(lockPath)) return { version: MARKETPLACE_LOCK_VERSION, entries: {} }
    const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<MarketplaceLockFile>
    if (raw.version !== MARKETPLACE_LOCK_VERSION || typeof raw.entries !== 'object' || raw.entries === null) {
      return { ...EMPTY_LOCK, entries: {} }
    }
    return { version: MARKETPLACE_LOCK_VERSION, entries: raw.entries }
  } catch {
    return { version: MARKETPLACE_LOCK_VERSION, entries: {} }
  }
}

export function writeLock(lockPath: string, lock: MarketplaceLockFile): void {
  atomicWriteFileSync(lockPath, JSON.stringify(lock, null, 2))
}

/**
 * Insert or replace a record (idempotent by record.id).
 * Sync RMW is safe in-process: no await between read and write, and the
 * marketplace server is single-writer for this config dir. Cross-id concurrent
 * installEntry calls serialize here at the JS event-loop boundary.
 */
export function upsertLockRecord(lockPath: string, record: MarketplaceLockRecord): MarketplaceLockFile {
  const lock = readLock(lockPath)
  lock.entries[record.id] = record
  writeLock(lockPath, lock)
  return lock
}

export function removeLockRecord(lockPath: string, id: string): MarketplaceLockFile {
  const lock = readLock(lockPath)
  delete lock.entries[id]
  writeLock(lockPath, lock)
  return lock
}

/** Per-install provenance marker, written into (dirs) or beside (.md files) every target we own. */
export function writeInstallMarker(targetPath: string, record: MarketplaceLockRecord): void {
  atomicWriteFileSync(markerPathFor(targetPath), JSON.stringify(record, null, 2))
}

/** Marker for file targets (context-doc): written next to the file, not inside it. */
export function markerPathFor(targetPath: string): string {
  return targetPath.endsWith('.md') ? `${targetPath}${INSTALL_MARKER_NAME}` : join(targetPath, INSTALL_MARKER_NAME)
}

export function readInstallMarker(targetPath: string): MarketplaceLockRecord | null {
  try {
    const file = markerPathFor(targetPath)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as MarketplaceLockRecord
  } catch {
    return null
  }
}

export function removeInstallMarker(targetPath: string): void {
  rmSync(markerPathFor(targetPath), { force: true })
}
