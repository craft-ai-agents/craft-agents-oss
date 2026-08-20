/**
 * KnowledgeContextSnapshotsStore — immutable per-file context snapshots
 * (spec K-04 §3.3.2 + §3.4).
 *
 * Layout: {workspaceRoot}/knowledge/snapshots/<snapshotId>.json — one JSON
 * document per snapshot. Block content can be large, so per-file layout keeps
 * writes O(entity) and deletion O(1). Writes are atomic via tmp + rename (the
 * exact AuditLog.rotate()/LessonStore.rewrite pattern); a snapshot file is
 * immutable after capture — 'snapshot' mode is defined by a frozen
 * contentHash and live-reference mode re-reads the provider instead of
 * touching this file (K-04 §3.4).
 *
 * The record is a storage envelope: refJson/snapshotJson hold the serialized
 * payloads while sessionId/provider/contentHash/capturedAt stay indexed for
 * lookup and retention. Reads are fail-soft: a corrupt snapshot file is
 * skipped, never thrown. Orphan *.tmp files from a process killed between
 * write and rename are cleaned on construction (K-04 §5).
 *
 * Retention (K-04 §3.4): snapshots are working artifacts, not knowledge. The
 * snapshots dir carries a byte budget enforced lazily on create, evicting
 * oldest-by-capturedAt first (LRU); session-archive cleanup is the bridge
 * service's job on top of remove().
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'node:crypto'
import type { KnowledgeRef } from '@craft-agent/core/knowledge'

/** Retention thresholds, AUDIT_LIMITS-style: pruned lazily inside create(). */
export const SNAPSHOT_LIMITS = {
  /** Byte budget for the whole snapshots dir (K-04 §3.4: потолок ~200 МБ, LRU по capturedAt). */
  maxTotalBytes: 200 * 1024 * 1024,
} as const

export type SnapshotLimits = { readonly maxTotalBytes: number }

/** Storage envelope of one captured context snapshot. */
export interface KnowledgeContextSnapshotRecord {
  id: string
  sessionId: string
  provider: string
  /** Serialized KnowledgeRef of the captured block/document. */
  refJson: string
  /** Hash of the normalized content at capture (K-04 §3.4), supplied by the caller. */
  contentHash: string
  capturedAt: string
  /** Serialized ContextSnapshot payload. */
  snapshotJson: string
}

export interface CreateSnapshotInput {
  sessionId: string
  provider: string
  ref: KnowledgeRef
  contentHash: string
  snapshot: unknown
  /** Defaults to now; honored explicitly like AuditLog's ts override. */
  capturedAt?: string
}

/** Snapshot ids are store-generated uuids — refuse anything that could escape the dir. */
const SNAPSHOT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Resilient per-file parse: corrupt or non-record content → null (parseAuditEntries contract). */
export function parseSnapshotFile(content: string): KnowledgeContextSnapshotRecord | null {
  try {
    const r = JSON.parse(content) as Partial<KnowledgeContextSnapshotRecord>
    if (
      r && typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.sessionId === 'string' &&
      typeof r.provider === 'string' &&
      typeof r.refJson === 'string' &&
      typeof r.contentHash === 'string' &&
      typeof r.capturedAt === 'string' &&
      typeof r.snapshotJson === 'string'
    ) {
      return r as KnowledgeContextSnapshotRecord
    }
  } catch { /* skip corrupt file */ }
  return null
}

export class KnowledgeContextSnapshotsStore {
  /** {workspaceRoot}/knowledge/snapshots — workspace scope, like memory/ and sources/. */
  readonly snapshotsDir: string
  private readonly limits: SnapshotLimits

  constructor(workspaceRoot: string, limits: SnapshotLimits = SNAPSHOT_LIMITS) {
    this.snapshotsDir = join(workspaceRoot, 'knowledge', 'snapshots')
    this.limits = limits
    this.cleanupOrphanTmp()
  }

  /**
   * Capture a snapshot: the store assigns the uuid and capturedAt, serializes
   * ref/snapshot, writes the file atomically, then lazily enforces the
   * directory byte budget. Returns the stored record.
   */
  create(input: CreateSnapshotInput): KnowledgeContextSnapshotRecord {
    const record: KnowledgeContextSnapshotRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      provider: input.provider,
      refJson: JSON.stringify(input.ref),
      contentHash: input.contentHash,
      capturedAt: input.capturedAt ?? new Date().toISOString(),
      snapshotJson: JSON.stringify(input.snapshot),
    }
    mkdirSync(this.snapshotsDir, { recursive: true })
    const tmp = join(this.snapshotsDir, `.${Date.now()}-${process.pid}.snapshot.tmp`)
    writeFileSync(tmp, JSON.stringify(record))
    renameSync(tmp, this.snapshotPath(record.id))
    this.prune()
    return record
  }

  /** Read one snapshot; unknown id, invalid id, or corrupt file → null. */
  get(id: string): KnowledgeContextSnapshotRecord | null {
    if (!SNAPSHOT_ID_RE.test(id)) return null
    const path = this.snapshotPath(id)
    if (!existsSync(path)) return null
    return parseSnapshotFile(readFileSync(path, 'utf8'))
  }

  /** Snapshots belonging to a session, most recent first; corrupt files are skipped. */
  listBySession(sessionId: string): KnowledgeContextSnapshotRecord[] {
    return this.readAll()
      .filter(r => r.sessionId === sessionId)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  }

  remove(id: string): boolean {
    if (!SNAPSHOT_ID_RE.test(id)) return false
    const path = this.snapshotPath(id)
    if (!existsSync(path)) return false
    try {
      unlinkSync(path)
      return true
    } catch {
      return false
    }
  }

  /** All parseable snapshot records in the dir; corrupt files skipped. */
  private readAll(): KnowledgeContextSnapshotRecord[] {
    let names: string[]
    try {
      names = readdirSync(this.snapshotsDir)
    } catch {
      return []
    }
    const records: KnowledgeContextSnapshotRecord[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = parseSnapshotFile(readFileSync(join(this.snapshotsDir, name), 'utf8'))
      if (parsed) records.push(parsed)
    }
    return records
  }

  /**
   * Lazy LRU retention: when the dir exceeds maxTotalBytes, evict
   * oldest-by-capturedAt until under budget. Always keeps the newest file
   * (the one most likely just captured), mirroring AUDIT_LIMITS laziness.
   */
  private prune(): void {
    let entries: { name: string; size: number; capturedAt: string }[]
    try {
      entries = readdirSync(this.snapshotsDir)
        .filter(name => name.endsWith('.json'))
        .map(name => {
          const filePath = join(this.snapshotsDir, name)
          const parsed = parseSnapshotFile(readFileSync(filePath, 'utf8'))
          return { name, size: statSync(filePath).size, capturedAt: parsed?.capturedAt ?? '' }
        })
    } catch {
      return // dir missing or unreadable — nothing to prune
    }
    let total = entries.reduce((acc, e) => acc + e.size, 0)
    if (total <= this.limits.maxTotalBytes) return
    entries.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    let idx = 0
    while (total > this.limits.maxTotalBytes && idx < entries.length - 1) {
      try { unlinkSync(join(this.snapshotsDir, entries[idx].name)) } catch { /* best effort */ }
      total -= entries[idx].size
      idx++
    }
  }

  private snapshotPath(id: string): string {
    return join(this.snapshotsDir, `${id}.json`)
  }

  /** Best-effort removal of tmp files left by a process killed mid-rename. */
  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.snapshotsDir)) return
      for (const entry of readdirSync(this.snapshotsDir)) {
        if (!entry.endsWith('.tmp')) continue
        try { unlinkSync(join(this.snapshotsDir, entry)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}
