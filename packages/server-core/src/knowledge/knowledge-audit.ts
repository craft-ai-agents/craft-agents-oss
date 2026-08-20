/**
 * KnowledgeAuditLog — compliance audit trail of the knowledge domain
 * (spec K-05 §3.8): who/what was done to proposals, snapshots, publications,
 * and links. Lives at {workspaceRoot}/knowledge/audit.jsonl.
 *
 * This is an ADAPTATION, not a fork (K-04 §3.3.6): rotation, tmp+rename
 * writes and corrupt-line resilience are inherited verbatim from
 * memory/AuditLog (AUDIT_LIMITS {maxLines:10_000, keepLines:7_000} + a
 * composition-held AuditLog.inDir instance bound to the knowledge dir with
 * scope 'workspace'). The JSONL line format inherits AuditEntry from
 * packages/shared/src/memory/types.ts: {ts, scope, actor, action, target, detail?}.
 *
 * The AuditActor/AuditAction unions predate the knowledge domain, and K-05
 * §3.8 widens actor with 'user'|'agent'|'automation' (= MutationActor) and
 * uses an open `knowledge.*` action namespace — parseAuditEntries is
 * structural (ts/action strings), so the widening is wire-compatible; the
 * cast below marks the documented K-01 ADR extension point instead of
 * editing shared unions mid-batch.
 *
 * `detail` carries the JSON-stringified machine context — proposalId, ops,
 * baseHash/postHash, sessionId/runId, connectionId (K-05 §3.8): no secrets,
 * no content (the audit is compliance metadata, not a payload mirror).
 * The audit and the domain event mirror (events.jsonl, K-04 §3.3) are
 * deliberately separate files.
 */
import { join } from 'path'
import { AuditLog, type AuditInput } from '../memory/AuditLog'
import type { AuditEntry, AuditAction, AuditActor } from '@craft-agent/shared/memory/types'
import type { MutationActor } from '@craft-agent/shared/protocol'

/**
 * Audit action strings (K-05 §3.8, full list verbatim). The proposal.*
 * entries are written by the mutation pipeline; snapshot/publication/link.*
 * are defined for the readers/writers of the other K-04 stores.
 */
export const KNOWLEDGE_AUDIT_ACTIONS = [
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
  'knowledge.publish.applied', // K-06 §3.7 publish.applied under knowledge.* AuditAction template
  'knowledge.link.added',
  'knowledge.link.removed',
] as const

export type KnowledgeAuditAction = (typeof KNOWLEDGE_AUDIT_ACTIONS)[number]

export interface KnowledgeAuditInput {
  actor: MutationActor
  /** One of KNOWLEDGE_AUDIT_ACTIONS (typed as string: the namespace is open per K-05 §3.8). */
  action: string
  /** What was acted on — proposal ref `siyuan://…`, proposalId, link pair, etc. */
  target: string
  /** JSON-stringified machine context (hashes, ops, sessionId/runId) — never secrets/content. */
  detail?: string
  /** Defaults to now; honored explicitly like AuditLog's ts override. */
  ts?: string
}

export class KnowledgeAuditLog {
  /** {workspaceRoot}/knowledge — workspace scope (audit is per-workspace compliance contour). */
  readonly knowledgeDir: string
  private readonly log: AuditLog

  constructor(workspaceRoot: string) {
    this.knowledgeDir = join(workspaceRoot, 'knowledge')
    // DI through AuditLog.inDir (K-04 §3.3.6) — same file protocol, same rotation.
    this.log = AuditLog.inDir(this.knowledgeDir, 'workspace')
  }

  /** Path of the knowledge audit.jsonl. */
  get filePath(): string {
    return this.log.filePath
  }

  /**
   * Append one line (ts defaults to now, scope fixed to 'workspace');
   * rotates tail-first past AUDIT_LIMITS.maxLines.
   */
  async append(input: KnowledgeAuditInput): Promise<void> {
    // K-05 §3.8 widened union values: runtime line format is AuditEntry-exact.
    // ts/detail are set ONLY when supplied — an explicit-undefined key would
    // override AuditLog's computed ts (spread order) and key-drop on stringify.
    const entry = {
      actor: input.actor as unknown as AuditActor,
      action: input.action as unknown as AuditAction,
      target: input.target,
    } as AuditInput
    if (input.detail !== undefined) entry.detail = input.detail
    if (input.ts !== undefined) entry.ts = input.ts
    this.log.append(entry)
  }

  /** Read entries, most recent first (delegates to the underlying AuditLog). */
  read(limit?: number): AuditEntry[] {
    return this.log.read(limit)
  }
}
