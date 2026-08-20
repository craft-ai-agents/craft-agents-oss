/**
 * AutomationLoopGuard — suppress re-entrancy when an automation's own write
 * would re-fire the same automation (P6 / K-10).
 *
 * Both KnowledgeChangeWatcher (before emit) and KnowledgeActionExecutor
 * (after bridge apply) consult this registry. Automation proposals reserve a
 * pending write for five minutes, then consume it when the write succeeds.
 *
 * Keys: `${connectionId}|${refId}|${attrName|*}|${automationId}`
 * Watcher suppress uses shouldSuppressRef (any automation wrote this ref/attr).
 */

export interface LoopGuardWriteMeta {
  connectionId: string
  refId: string
  /** Attribute name when the write was set_attribute; omit for content writes. */
  attrName?: string
  automationId: string
  /** Epoch ms; defaults to Date.now(). */
  ts?: number
}

export interface LoopGuardCheckMeta {
  connectionId: string
  refId: string
  attrName?: string
  automationId: string
  /** Epoch ms; defaults to Date.now(). */
  now?: number
}

export interface LoopGuardRefCheckMeta {
  connectionId: string
  refId: string
  attrName?: string
  /** Epoch ms; defaults to Date.now(). */
  now?: number
}

const DEFAULT_TTL_MS = 120_000
const PENDING_TTL_MS = 5 * 60_000

function keyOf(meta: {
  connectionId: string
  refId: string
  attrName?: string
  automationId: string
}): string {
  const attr = meta.attrName ?? '*'
  return `${meta.connectionId}|${meta.refId}|${attr}|${meta.automationId}`
}

export class AutomationLoopGuard {
  private readonly entries = new Map<string, number>()
  private readonly pendingWrites = new Map<string, LoopGuardWriteMeta>()
  private readonly ttlMs: number
  private readonly nowFn: () => number

  constructor(options?: { ttlMs?: number; now?: () => number }) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    this.nowFn = options?.now ?? (() => Date.now())
  }

  /** Record that automationId just wrote ref (optionally attr). */
  noteWrite(meta: LoopGuardWriteMeta): void {
    const ts = meta.ts ?? this.nowFn()
    this.entries.set(keyOf(meta), ts)
    // Also record a content-level marker so DocumentUpdated after set_attribute can suppress.
    if (meta.attrName) {
      this.entries.set(
        keyOf({
          connectionId: meta.connectionId,
          refId: meta.refId,
          automationId: meta.automationId,
        }),
        ts,
      )
    }
    this.prune(ts)
  }

  notePendingWrite(proposalId: string, meta: LoopGuardWriteMeta): void {
    const ts = meta.ts ?? this.nowFn()
    this.pendingWrites.set(proposalId, { ...meta, ts })
    this.prune(ts)
  }

  consumePendingWrite(proposalId: string): void {
    const meta = this.pendingWrites.get(proposalId)
    if (!meta) return
    this.pendingWrites.delete(proposalId)
    if (this.nowFn() - (meta.ts ?? 0) <= PENDING_TTL_MS) {
      const writeMeta: LoopGuardWriteMeta = {
        connectionId: meta.connectionId,
        refId: meta.refId,
        automationId: meta.automationId,
      }
      if (meta.attrName !== undefined) writeMeta.attrName = meta.attrName
      this.noteWrite(writeMeta)
    }
  }

  /**
   * True when the same automation wrote this ref (and optional attr) within TTL.
   * Handler/executor should skip re-execution for the same automationId.
   */
  shouldSuppress(meta: LoopGuardCheckMeta): boolean {
    const now = meta.now ?? this.nowFn()
    this.prune(now)

    const exact = this.entries.get(keyOf(meta))
    if (exact !== undefined && now - exact <= this.ttlMs) return true

    // Attribute-specific event: also suppress if a wildcard content write was noted.
    if (meta.attrName) {
      const contentKey = keyOf({
        connectionId: meta.connectionId,
        refId: meta.refId,
        automationId: meta.automationId,
      })
      const contentTs = this.entries.get(contentKey)
      if (contentTs !== undefined && now - contentTs <= this.ttlMs) return true
    }

    return false
  }

  /**
   * True if ANY automation wrote this ref(/attr) within TTL.
   * Watcher emit path uses this — payloads normally lack automationId.
   */
  shouldSuppressRef(meta: LoopGuardRefCheckMeta): boolean {
    const now = meta.now ?? this.nowFn()
    this.prune(now)

    const prefix = `${meta.connectionId}|${meta.refId}|`
    for (const [k, ts] of this.entries) {
      if (!k.startsWith(prefix)) continue
      if (now - ts > this.ttlMs) continue
      // key = connectionId|refId|attr|automationId
      const rest = k.slice(prefix.length)
      const attrPart = rest.split('|')[0] ?? '*'
      if (meta.attrName) {
        // Match exact attr or content wildcard (*)
        if (attrPart === meta.attrName || attrPart === '*') return true
      } else {
        // Any write to this ref suppresses content-level events
        return true
      }
    }
    return false
  }

  /** Drop expired entries. */
  prune(now = this.nowFn()): void {
    for (const [k, ts] of this.entries) {
      if (now - ts > this.ttlMs) this.entries.delete(k)
    }
    for (const [proposalId, meta] of this.pendingWrites) {
      if (now - (meta.ts ?? now) > PENDING_TTL_MS) this.pendingWrites.delete(proposalId)
    }
  }

  /** Test helper — number of live entries after prune. */
  size(): number {
    this.prune()
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
    this.pendingWrites.clear()
  }
}

/** Process-wide default guard shared by watcher + executor within a server process. */
let sharedGuard: AutomationLoopGuard | null = null

export function getSharedAutomationLoopGuard(): AutomationLoopGuard {
  if (!sharedGuard) sharedGuard = new AutomationLoopGuard()
  return sharedGuard
}

/** Test seam — replace or clear the shared instance. */
export function __setSharedAutomationLoopGuard(guard: AutomationLoopGuard | null): void {
  sharedGuard = guard
}
