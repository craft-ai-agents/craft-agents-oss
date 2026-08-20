/**
 * KnowledgeMutationProposalsStore — persisted mutation proposals
 * (spec K-04 §3.3.4 `MutationProposalFile`, lifecycle K-05 §3.2/§3.7).
 *
 * Layout: {workspaceRoot}/knowledge/proposals/<proposalId>.json — one JSON
 * document per proposal: patches/inverseOps/diff make records bulky and the
 * lifecycle is frequent status rewrites, so per-file layout keeps every
 * transition O(record) and discard O(1) (same reasoning as snapshots).
 * Writes are atomic via tmp + rename (the exact AuditLog.rotate()/
 * LessonStore.rewrite pattern, K-04 §3.3); orphan *.tmp files from a process
 * killed between write and rename are cleaned on construction (K-04 §5).
 *
 * The store is a dumb persistence layer: it manages NO status transitions —
 * callers (bridge-service executing the pure K-05 state machine) append
 * StatusHistoryEntry themselves and save() persists records verbatim.
 * Reads are fail-soft: an unknown id or corrupt file yields null/skips,
 * never a throw.
 *
 * Lazy TTL sweep (K-05 §3.7, no scheduler — bridge-service calls
 * sweepExpired(now) on load):
 * - draft/pending_review with no decision for DRAFT_TTL_MS → авто-T4: the
 *   file is deleted and the id reported in `discarded` (audit of
 *   `knowledge.proposal.rejected` reason='ttl-expired' is the caller's job —
 *   T4's audit effect in the state machine).
 * - approved older than APPROVAL_TTL_MS → status returns to 'pending_review'
 *   with a statusHistory entry (actor 'automation', reason 'approval-expired')
 *   and approvedBy/approvedAt cleared (mirrors the 'expire'/'beginApply'
 *   branches of the K-05 state machine); id reported in `approvalExpired`.
 *   Draft-age is measured from the LAST statusHistory entry (falling back to
 *   createdAt): the persisted record has no updatedAt field, so the tail
 *   entry is the freshness anchor of «7 суток без решения».
 * - 'applying' and terminal states (applied/conflict/superseded/rolled_back)
 *   are never touched by the sweep — applied/conflict/rolled_back stay as
 *   history; 'not deleted' per §3.7.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { APPROVAL_TTL_MS, DRAFT_TTL_MS } from '@craft-agent/core/knowledge'
import type {
  MutationProposalRecord,
  MutationProposalStatus,
  StatusHistoryEntry,
} from '@craft-agent/shared/protocol'

export interface ProposalListFilter {
  status?: MutationProposalStatus
  connectionId?: string
}

export interface ProposalSweepResult {
  /** Ids whose files were deleted (draft/pending_review past DRAFT_TTL_MS). */
  discarded: string[]
  /** Ids returned to pending_review (approved past APPROVAL_TTL_MS). */
  approvalExpired: string[]
}

/** Proposal ids are caller-generated ('p_…', K-05 §3.8) — refuse anything that could escape the dir. */
const PROPOSAL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

/** Resilient per-file parse: corrupt or non-record content → null (parseAuditEntries contract). */
export function parseProposalFile(content: string): MutationProposalRecord | null {
  try {
    const r = JSON.parse(content) as Partial<MutationProposalRecord>
    if (
      r && typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.connectionId === 'string' &&
      typeof r.targetRef === 'object' && r.targetRef !== null &&
      Array.isArray(r.ops) &&
      Array.isArray(r.selectionProofs) &&
      typeof r.baseHash === 'string' &&
      typeof r.baseReadAt === 'string' &&
      typeof r.preState === 'string' &&
      r.hashAlgorithm === 'sha256-canonical-v1' &&
      typeof r.status === 'string' &&
      Array.isArray(r.statusHistory) &&
      typeof r.createdAt === 'string' &&
      typeof r.actor === 'string'
    ) {
      return r as MutationProposalRecord
    }
  } catch { /* skip corrupt file */ }
  return null
}

/** Statuses the lazy sweep never touches (K-05 §3.7): terminal history + in-flight apply. */
const SWEEP_EXEMPT_STATUSES: ReadonlySet<MutationProposalStatus> = new Set([
  'applying',
  'conflict',
  'applied',
  'superseded',
  'rolled_back',
])

export class KnowledgeMutationProposalsStore {
  /** {workspaceRoot}/knowledge/proposals — workspace scope, like snapshots/ and memory/. */
  readonly proposalsDir: string

  constructor(workspaceRoot: string) {
    this.proposalsDir = join(workspaceRoot, 'knowledge', 'proposals')
    this.cleanupOrphanTmp()
  }

  /**
   * Persist a proposal record verbatim (create or status rewrite alike).
   * The store assigns/no-processes nothing — id, timestamps and statusHistory
   * are the caller's state-machine output. Atomic via tmp + rename.
   */
  save(record: MutationProposalRecord): MutationProposalRecord {
    if (!PROPOSAL_ID_RE.test(record.id)) {
      throw new TypeError(`Invalid proposal id (refused for path safety): ${JSON.stringify(record.id)}`)
    }
    this.writeRecord(record)
    return record
  }

  /** Read one proposal; unknown id, invalid id, or corrupt file → null. */
  get(id: string): MutationProposalRecord | null {
    if (!PROPOSAL_ID_RE.test(id)) return null
    const path = this.proposalPath(id)
    if (!existsSync(path)) return null
    return parseProposalFile(readFileSync(path, 'utf8'))
  }

  /** All parseable proposals, optionally filtered; most recent (createdAt) first. */
  list(filter?: ProposalListFilter): MutationProposalRecord[] {
    return this.readAll()
      .filter(r => (filter?.status === undefined || r.status === filter.status) &&
                   (filter?.connectionId === undefined || r.connectionId === filter.connectionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  remove(id: string): boolean {
    if (!PROPOSAL_ID_RE.test(id)) return false
    const path = this.proposalPath(id)
    if (!existsSync(path)) return false
    try {
      unlinkSync(path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Lazy TTL hygiene (K-05 §3.7). Corrupt files are skipped, never thrown.
   * Returns the affected ids so the caller can append audit lines
   * (`knowledge.proposal.rejected` reason='ttl-expired' /
   * `knowledge.proposal.approval_expired`, K-05 §3.8).
   */
  sweepExpired(now: number): ProposalSweepResult {
    const discarded: string[] = []
    const approvalExpired: string[] = []
    for (const record of this.readAll()) {
      if (record.status === 'draft' || record.status === 'pending_review') {
        const lastActivity = record.statusHistory.length > 0
          ? record.statusHistory[record.statusHistory.length - 1]!.at
          : record.createdAt
        if (now - Date.parse(lastActivity) > DRAFT_TTL_MS) {
          // Auto-T4: discard deletes the file (K-05 §3.2 T4).
          try {
            unlinkSync(this.proposalPath(record.id))
            discarded.push(record.id)
          } catch { /* best effort */ }
        }
      } else if (record.status === 'approved') {
        if (record.approvedAt === undefined) continue
        if (now - Date.parse(record.approvedAt) > APPROVAL_TTL_MS) {
          const entry: StatusHistoryEntry = {
            from: 'approved',
            to: 'pending_review',
            at: new Date(now).toISOString(),
            actor: 'automation',
            reason: 'approval-expired',
          }
          // Mirrors the state machine's approval-expiry branch: fresh approve required.
          this.writeRecord({
            ...record,
            status: 'pending_review',
            statusHistory: [...record.statusHistory, entry],
            approvedBy: undefined,
            approvedAt: undefined,
          })
          approvalExpired.push(record.id)
        }
      } else if (!SWEEP_EXEMPT_STATUSES.has(record.status)) continue
    }
    return { discarded, approvalExpired }
  }

  /** All parseable proposal records in the dir (sorted by filename for determinism); corrupt files skipped. */
  private readAll(): MutationProposalRecord[] {
    let names: string[]
    try {
      names = readdirSync(this.proposalsDir).sort()
    } catch {
      return []
    }
    const records: MutationProposalRecord[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const parsed = parseProposalFile(readFileSync(join(this.proposalsDir, name), 'utf8'))
      if (parsed) records.push(parsed)
    }
    return records
  }

  private writeRecord(record: MutationProposalRecord): void {
    mkdirSync(this.proposalsDir, { recursive: true })
    const tmp = join(this.proposalsDir, `.${Date.now()}-${process.pid}.proposal.tmp`)
    writeFileSync(tmp, JSON.stringify(record))
    renameSync(tmp, this.proposalPath(record.id))
  }

  private proposalPath(id: string): string {
    return join(this.proposalsDir, `${id}.json`)
  }

  /** Best-effort removal of tmp files left by a process killed mid-rename. */
  private cleanupOrphanTmp(): void {
    try {
      if (!existsSync(this.proposalsDir)) return
      for (const entry of readdirSync(this.proposalsDir)) {
        if (!entry.endsWith('.tmp')) continue
        try { unlinkSync(join(this.proposalsDir, entry)) } catch { /* best effort */ }
      }
    } catch { /* best effort */ }
  }
}
