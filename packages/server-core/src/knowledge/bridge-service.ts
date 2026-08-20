/**
 * KnowledgeBridgeService — the spec-05 (K-05) mutation pipeline as an
 * effect-driver over the pure engine (`@craft-agent/core/knowledge`
 * mutations.ts): bridge executes the engine's TransitionEffect plan objects
 * against provider/store/audit/push, never re-implementing status logic.
 *
 * §3.2 invariants enforced here (all Craft-initiated SiYuan writes pass
 * through this service — ADR-004; RPC handlers construct it per call and own
 * no state of their own):
 * - Apply is possible ONLY from `approved` (engine T5 guard; any other status
 *   is a typed ProposalTransitionError, mirrored to the caller unchanged).
 * - No kernel write begins before a successful HASH CHECK of RE-READ vs
 *   baseHash (T6); partial provider failure lands as conflict with
 *   reason='partial-apply-rolled-back' (§3.2 invariant, compensation is
 *   provider-internal best-effort).
 * - No silent rebase: RE-READs happen only inside apply (T5) and rollback
 *   (T10); baseHash is never overwritten (T9 is a fresh propose call carrying
 *   `rebaseOfProposalId`, which first supersedes the old conflict record).
 * - One hash artifact (P1-3): T1 baseHash, T6 postHash and the T10 rollback
 *   RE-READ ALL cover `provider.get(targetRef)` — the original target. A
 *   created child ref (appendBlock/createDocument) is used only to bind
 *   `$insertedBlockId[N]` inverse placeholders, never for hashing.
 * - No stranded statuses (P1-2/P1-5): every provider failure inside apply
 *   lands as an actionable `conflict` ('apply-failed'; partial-apply and
 *   hash-mismatch keep their own reasons; transport timeouts get the single
 *   T8 retry first); a failed rollback inverse leaves the record 'applied'
 *   plus a `rollback_failed` audit — never a stamped rolled_back without the
 *   inverse; the sweep evacuates 'applying' records stuck past
 *   APPLY_STUCK_TIMEOUT_MS through the engine 'expire' branch.
 * - Approve is human-only in v1: `approvedBy` is always 'user' (engine-typed);
 *   an `actor='automation'` subject MAY create a proposal but every transition
 *   past T1 requires the explicit user clicks that issued the RPC.
 * - Permission gate `assertKnowledgeActionAllowed` runs before T1 (propose),
 *   T3 (approve) and T5/T10 write passes (apply, rollback) — mode is resolved
 *   per proposal session (fail-closed via the gate's default).
 *
 * Persistence: ONE canonical record shape lives in core
 * (`MutationProposalRecord`, canonical home packages/core/src/knowledge/mutations.ts;
 * '@craft-agent/shared/protocol' re-exports it). File-level extras (updatedAt,
 * preStateAttributes, appliedHash, rolledBackAt) are optional fields on that record —
 * the store's fail-soft parse preserves them verbatim. The wire `diff` is a
 * unified-diff STRING (KnowledgeDiff.tsx renders it); the engine's structured
 * ProposalDiffDocument rides as record.diffDocument and is deterministically
 * rebuildable from (preState, ops), so a cold record loses nothing. Mapping at this
 * boundary (`toWireRecord`/`toCoreRecord`) now only renders/rebuilds that diff.
 */
import { CodedError } from '@craft-agent/shared/protocol'
import type {
  KnowledgeChangedPayload,
  MutationInput as WireMutationInput,
  MutationProposalStatus,
} from '@craft-agent/shared/protocol'
import assertKnowledgeActionAllowed from '@craft-agent/shared/agent/knowledge-permissions'
import type {
  KnowledgeAction,
  KnowledgeActionContext,
} from '@craft-agent/shared/agent/knowledge-permissions'
import { getPermissionMode } from '@craft-agent/shared/agent/mode-manager'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import {
  MutationValidationError,
  PartialApplyError,
  ProposalTransitionError,
  assertOpsWithinTargetScope,
  buildProposalDiff,
  createProposalDraft,
  hashKnowledgeContent,
  isApplyStuck,
  isTransientProviderFailure,
  siyuanDeepLink,
  transition,
  validateOpsWhitelist,
  validateProposalOps,
} from '@craft-agent/core/knowledge'
import type {
  ApplyResult as CoreApplyResult,
  KnowledgeProvider,
  KnowledgeRef,
  MutationActor,
  MutationOp,
  MutationProposal as CoreProposal,
  ProposalDiffDocument,
  TransitionEffect,
} from '@craft-agent/core/knowledge'

import { KnowledgeAuditLog } from './knowledge-audit'
import { getSharedAutomationLoopGuard, type AutomationLoopGuard } from './automation-loop-guard'
import { KnowledgeMutationProposalsStore, type ProposalListFilter, type ProposalSweepResult } from './proposals-store'

/** Engine-driven status transitions whose audit actor is 'automation' (§3.2 table, initiator column). */
const SYSTEM_ACTOR_AUDIT_ACTIONS: Record<string, true> = {
  'knowledge.proposal.applied': true,
  'knowledge.proposal.conflict': true,
  'knowledge.proposal.approval_expired': true,
}

const DEFAULT_NO_SESSION = 'knowledge-ui' // mode-manager default ('ask') for session-less UI proposals

/**
 * Persisted proposal file = the canonical record (wire shape incl. lifecycle extras:
 * preStateAttributes/preStateChildren for cold-store approve, appliedHash for the T10
 * rollback hash guard, updatedAt for precise TTL bookkeeping).
 */
export type KnowledgeProposalFileRecord = CoreProposal

/** Bridge apply/rollback result = the canonical (converged wire+engine) ApplyResult. */
export type BridgeApplyResult = CoreApplyResult

/** Sweep outcome: the store's TTL result plus bridge-side stuck-apply evacuations (engine 'expire'). */
export interface BridgeSweepResult extends ProposalSweepResult {
  /** 'applying' records evacuated to conflict {reason:'apply-stalled'} (APPLY_STUCK_TIMEOUT_MS, §3.2/§3.7). */
  applyStalled: string[]
}

export interface KnowledgeBridgeProposeArgs {
  connectionId: string
  /** Wire MutationInput; `actor` rides as an optional extension (agent/automation origins). */
  input: WireMutationInput & { actor?: MutationActor }
}

export interface KnowledgeBridgeDeps {
  /** connectionId → connected KnowledgeProvider (existing registry mechanism in handlers/rpc/knowledge.ts). */
  providerResolver: (connectionId: string) => Promise<KnowledgeProvider>
  proposalsStore: KnowledgeMutationProposalsStore
  audit: KnowledgeAuditLog
  /** Permission gate (§3.6); defaults to the shared enforcement point. */
  assertAllowed?: (action: KnowledgeAction, ctx: KnowledgeActionContext) => void
  /** knowledge:changed fan-out (T2/T6/T7/T10). */
  push?: (payload: KnowledgeChangedPayload) => void
  /** Injectable clock (ms epoch) for TTL/approval tests. */
  now?: () => number
  /** Session → permission mode; defaults to the shared mode-manager (fail-closed absent). */
  resolvePermissionMode?: (sessionId?: string) => PermissionMode | undefined
  /** Workspace id for the gate ctx (never grants a bypass; reserved for scoped rules). */
  workspaceId?: string
  /** appendBlock cap (§3.4.1 capability; default DEFAULT_MAX_BLOCK_BYTES in core). */
  maxBlockBytes?: number
  loopGuard?: AutomationLoopGuard
}

export class KnowledgeBridgeService {
  private readonly assertAllowed: (action: KnowledgeAction, ctx: KnowledgeActionContext) => void
  private readonly loopGuard: AutomationLoopGuard

  constructor(private readonly deps: KnowledgeBridgeDeps) {
    this.assertAllowed = deps.assertAllowed ?? assertKnowledgeActionAllowed
    this.loopGuard = deps.loopGuard ?? getSharedAutomationLoopGuard()
  }

  // -------------------------------------------------------------------------
  // Engine boundary mapping (the only place the two record families meet)
  // -------------------------------------------------------------------------

  /** Engine record → persisted wire+extras record; structured diff rendered to the unified-diff string. */
  toWireRecord(core: CoreProposal): KnowledgeProposalFileRecord {
    const record: KnowledgeProposalFileRecord = {
      id: core.id,
      connectionId: core.connectionId,
      targetRef: core.targetRef,
      ops: core.ops,
      selectionProofs: core.selectionProofs,
      baseHash: core.baseHash,
      baseReadAt: core.baseReadAt,
      preState: core.preState,
      hashAlgorithm: 'sha256-canonical-v1',
      status: core.status,
      statusHistory: core.statusHistory,
      createdAt: core.createdAt,
      actor: core.actor,
      // extras
      updatedAt: core.updatedAt,
      preStateAttributes: core.preStateAttributes,
      preStateChildren: core.preStateChildren,
      appliedHash: core.appliedHash,
      rolledBackAt: core.rolledBackAt,
    }
    if (core.sessionId !== undefined) record.sessionId = core.sessionId
    if (core.inverseOps !== undefined) record.inverseOps = core.inverseOps
    if (core.diffDocument !== undefined) record.diff = renderUnifiedDiff(core.diffDocument)
    if (core.approvedBy !== undefined) record.approvedBy = core.approvedBy
    if (core.approvedAt !== undefined) record.approvedAt = core.approvedAt
    if (core.appliedAt !== undefined) record.appliedAt = core.appliedAt
    if (core.createdRef !== undefined) record.createdRef = core.createdRef
    if (core.conflictInfo !== undefined) record.conflictInfo = core.conflictInfo
    return record
  }

  /** Persisted record → engine record. Deterministic rebuild: diff from (preState, ops); updatedAt from the history tail. */
  toCoreRecord(wire: KnowledgeProposalFileRecord): CoreProposal {
    const core: CoreProposal = {
      id: wire.id,
      connectionId: wire.connectionId,
      targetRef: wire.targetRef,
      ops: wire.ops,
      selectionProofs: wire.selectionProofs,
      baseHash: wire.baseHash,
      baseReadAt: wire.baseReadAt,
      preState: wire.preState,
      hashAlgorithm: 'sha256-canonical-v1',
      status: wire.status,
      statusHistory: wire.statusHistory,
      createdAt: wire.createdAt,
      updatedAt: wire.updatedAt ?? wire.statusHistory[wire.statusHistory.length - 1]?.at ?? wire.createdAt,
      actor: wire.actor,
    }
    if (wire.sessionId !== undefined) core.sessionId = wire.sessionId
    if (wire.preStateAttributes !== undefined) core.preStateAttributes = wire.preStateAttributes
    if (wire.preStateChildren !== undefined) core.preStateChildren = wire.preStateChildren
    // Deterministic rebuild (buildProposalDiff is pure in preState+ops): no diff state is
    // route-tripped through the wire representation.
    if (wire.diff !== undefined) core.diffDocument = buildProposalDiff(wire.preState, wire.ops)
    if (wire.inverseOps !== undefined) core.inverseOps = wire.inverseOps
    if (wire.approvedBy !== undefined) core.approvedBy = wire.approvedBy
    if (wire.approvedAt !== undefined) core.approvedAt = wire.approvedAt
    if (wire.appliedAt !== undefined) core.appliedAt = wire.appliedAt
    if (wire.appliedHash !== undefined) core.appliedHash = wire.appliedHash
    if (wire.rolledBackAt !== undefined) core.rolledBackAt = wire.rolledBackAt
    if (wire.createdRef !== undefined) core.createdRef = wire.createdRef
    if (wire.conflictInfo !== undefined) core.conflictInfo = wire.conflictInfo
    return core
  }

  // -------------------------------------------------------------------------
  // T1: propose — VALIDATE → READ → BASE HASH → draft → DIFF → pending_review
  // -------------------------------------------------------------------------

  async propose(args: KnowledgeBridgeProposeArgs): Promise<KnowledgeProposalFileRecord> {
    const actor = args.input.actor ?? 'user'
    const sessionId = args.input.sessionId
    this.gate('knowledge.propose', sessionId)

    // T9 (§3.2, §3.5 «Перечитать и пересобрать»): an explicit rebase marker supersedes the old
    // conflict through the engine 'rebase' transition (persist + audit superseded) BEFORE the
    // fresh T1 cycle below — no silent rebase: the new proposal gets its own READ/baseHash.
    if (args.input.rebaseOfProposalId !== undefined) {
      const old = this.requireProposal(args.input.rebaseOfProposalId)
      const oldCore = this.toCoreRecord(old)
      if (oldCore.status !== 'conflict') {
        throw new CodedError(
          'HASH_CONFLICT',
          `knowledge: rebase is allowed only on a conflict proposal (got '${oldCore.status}', spec 05 §3.2 T9)`,
        )
      }
      await this.draftEffects(transition(oldCore, { type: 'rebase' }, this.now()).effects, 'user')
    }

    // §3.4.1 admission guards run BEFORE the READ: cheap rejection, no wasted provider call.
    let ops: MutationOp[]
    try {
      ops = validateOpsWhitelist(args.input.ops)
      validateProposalOps(ops, {
        selectionProofs: args.input.selectionProofs,
        maxBlockBytes: this.deps.maxBlockBytes,
        now: this.now(),
      })
    } catch (error) {
      if (error instanceof MutationValidationError) {
        await this.auditRejectedProposal(error, args, sessionId)
      }
      throw error
    }

    const provider = await this.deps.providerResolver(args.connectionId)
    const node = await provider.get(args.input.targetRef)
    const preState = node.markdown ?? ''
    const preStateAttributes = {
      [node.ref.id]: Object.fromEntries(node.attributes.map((attribute) => [attribute.key, attribute.value])),
    }

    // P1-4 scope guard, bridge-composed (§3.1 «one targetRef per proposal»; the engine runs the
    // identical check for enforceSelectionProofs=true callers): ops may address ONLY the target
    // or blocks inside its child chain captured AT THIS READ. The capture doubles as the
    // block-accurate inverse source at approve (computeInverseOps children snapshot) and as the
    // cold-store flight recorder.
    let preStateChildren: Record<string, string> | undefined
    try {
      const offTarget = ops.some(
        (op) => (op.op === 'updateBlock' || op.op === 'setAttribute') && op.blockId !== node.ref.id,
      )
      if (offTarget) {
        const context = await provider.getContext(args.input.targetRef, 'snapshot')
        preStateChildren = Object.fromEntries(context.children.map((child) => [child.blockId, child.content]))
      }
      assertOpsWithinTargetScope(
        ops,
        args.input.targetRef,
        preStateChildren === undefined ? undefined : new Set(Object.keys(preStateChildren)),
      )
    } catch (error) {
      if (error instanceof MutationValidationError) {
        await this.auditRejectedProposal(error, args, sessionId)
      }
      throw error
    }

    const baseHash = await hashKnowledgeContent(preState)
    const baseReadAt = new Date(this.now()).toISOString()
    const id = `p_${crypto.randomUUID()}`

    const draft = createProposalDraft(
      {
        id,
        connectionId: args.connectionId,
        targetRef: args.input.targetRef,
        ops,
        baseHash,
        baseReadAt,
        preState,
        preStateAttributes,
        preStateChildren,
        selectionProofs: args.input.selectionProofs,
        sessionId,
        actor,
      },
      { enforceSelectionProofs: false, maxBlockBytes: this.deps.maxBlockBytes, now: this.now() },
    )
    await this.draftEffects(draft.effects, actor)

    // T2 immediate (spec §3.2: auto при emerge в UI) — diff is built by the engine from preState+ops.
    const built = transition(draft.proposal, { type: 'buildDiff' }, this.now())
    await this.draftEffects(built.effects, 'user')
    await this.deps.audit.append({
      actor,
      action: 'knowledge.proposal.reviewed',
      target: this.auditTarget(built.proposal),
      detail: this.detail({ proposalId: id, sessionId }),
    })
    return this.toWireRecord(built.proposal)
  }

  // -------------------------------------------------------------------------
  // T3: approve — pending_review only (engine guard); inverse computed by engine from cold preState
  // -------------------------------------------------------------------------

  async approve(proposalId: string): Promise<KnowledgeProposalFileRecord> {
    const wire = this.requireProposal(proposalId)
    this.gate('knowledge.approve', wire.sessionId)
    let core = this.toCoreRecord(wire)

    // Cold-store degradation guard: if file-level preStateAttributes were stripped, re-capture
    // the current attributes so setAttribute inverses keep the true old value (best-effort —
    // the '' remove-sense fallback stands when the target is unreadable).
    if (core.preStateAttributes === undefined && core.ops.some((op) => op.op === 'setAttribute')) {
      try {
        const node = await (await this.deps.providerResolver(wire.connectionId)).get(wire.targetRef)
        core = {
          ...core,
          preStateAttributes: {
            [node.ref.id]: Object.fromEntries(node.attributes.map((a) => [a.key, a.value])),
          },
        }
      } catch {
        /* inverse degrades to the '' remove-sense — intentional, never mask the approve */
      }
    }

    // Same guard for the child-chain capture (P1-4, §3.8): stripped preStateChildren with
    // off-target ops would degrade the approve-time inverse to a whole-preState restore —
    // re-capture best-effort so the child-accurate inverse stands.
    if (
      core.preStateChildren === undefined &&
      core.ops.some((op) => (op.op === 'updateBlock' || op.op === 'setAttribute') && op.blockId !== wire.targetRef.id)
    ) {
      try {
        const context = await (await this.deps.providerResolver(wire.connectionId)).getContext(wire.targetRef, 'snapshot')
        core = {
          ...core,
          preStateChildren: Object.fromEntries(context.children.map((child) => [child.blockId, child.content])),
        }
      } catch {
        /* inverse degrades to the whole-preState restore — intentional, never mask the approve */
      }
    }

    const result = transition(core, { type: 'approve' }, this.now())
    await this.draftEffects(result.effects, 'user')
    return this.toWireRecord(result.proposal)
  }

  // -------------------------------------------------------------------------
  // T4: reject — engine path for draft/pending_review/conflict; explicit for approved
  // -------------------------------------------------------------------------

  async reject(proposalId: string): Promise<{ ok: true }> {
    const wire = this.requireProposal(proposalId)
    if (wire.status === 'approved') {
      // Engine T4 covers draft/pending_review/conflict; discarding an approved proposal is
      // the same user decision — delete + audit without a state-machine hop (no inverse exec).
      this.deps.proposalsStore.remove(proposalId)
      await this.deps.audit.append({
        actor: 'user',
        action: 'knowledge.proposal.rejected',
        target: siyuanDeepLink(wire.targetRef),
        detail: this.detail({ proposalId, reason: 'user-discard', from: 'approved' }),
      })
      return { ok: true }
    }
    const result = transition(this.toCoreRecord(wire), { type: 'reject', reason: 'user-discard' }, this.now())
    await this.draftEffects(result.effects, 'user')
    return { ok: true }
  }

  // -------------------------------------------------------------------------
  // T5→T6/T7: apply — RE-READ → HASH CHECK → execute → verify RE-READ → applied
  // -------------------------------------------------------------------------

  async apply(proposalId: string): Promise<BridgeApplyResult> {
    const wire = this.requireProposal(proposalId)
    this.gate('knowledge.apply', wire.sessionId)
    const core = this.toCoreRecord(wire)

    // T5 guard: engine throws ProposalTransitionError from any status != approved;
    // approval-expired bounces back to pending_review with its own audit + push effects.
    const begun = transition(core, { type: 'beginApply' }, this.now())
    if (begun.proposal.status === 'pending_review') {
      await this.draftEffects(begun.effects, 'automation')
      return { proposalId, applied: false, conflicted: false, status: 'pending_review', reason: 'approval-expired' }
    }
    await this.draftEffects(begun.effects, begun.proposal.actor) // T5 snapshot persisted

    // P1-2: EVERY failure after the T5 persist lands as an actionable conflict (§3.5 card) —
    // a rethrown provider/engine error would strand the record in 'applying' and make it
    // permanently un-actionable (the stuck-apply sweep below is only the crash backstop).
    let observedHash: string | undefined
    try {
      const provider = await this.deps.providerResolver(wire.connectionId)
      const reRead = await provider.get(wire.targetRef)
      const currentContent = reRead.markdown ?? ''
      const actualHash = await hashKnowledgeContent(currentContent)
      observedHash = actualHash

      const resolved = transition(begun.proposal, { type: 'resolveHashCheck', actualHash, currentContent }, this.now())
      if (resolved.proposal.status === 'conflict') {
        // T7: nothing was written; conflictInfo + audit + push ride the engine effects.
        await this.draftEffects(resolved.effects, 'automation')
        return {
          proposalId,
          applied: false,
          conflicted: true,
          status: 'conflict',
          reason: 'hash-mismatch',
          currentHash: actualHash,
          conflictInfo: this.toWireRecord(resolved.proposal).conflictInfo,
        }
      }

      // execute-ops plan: the provider's mutation path (InMemory executes in memory; the real
      // provider executes the kernel via its mutation adapter). T8 retry-once loop: ONLY
      // transport-level timeouts (isTransientProviderFailure) re-arm a producer pass; the
      // engine refuses a second retry via the statusHistory guard ('retry-already-used').
      let current = resolved.proposal
      for (;;) {
        let appliedResult: CoreApplyResult
        try {
          appliedResult = await this.executeViaProvider(provider, current.ops, current)
        } catch (error) {
          if (error instanceof PartialApplyError) {
            const failed = transition(
              current,
              {
                type: 'applyOpsPartialFailure',
                failedOpIndex: error.failedOpIndex,
                message: `partial-apply: op ${error.failedOpIndex} failed, ${error.compensatedOps.length} inverse op(s) applied best-effort`,
                actualHash,
              },
              this.now(),
            )
            await this.draftEffects(failed.effects, 'automation')
            return {
              proposalId,
              applied: false,
              conflicted: true,
              status: 'conflict',
              reason: 'partial-apply-rolled-back',
              currentHash: actualHash,
              conflictInfo: this.toWireRecord(failed.proposal).conflictInfo,
            }
          }
          if (isTransientProviderFailure(error) && !current.statusHistory.some((entry) => entry.reason === 'retry-transient')) {
            const retried = transition(current, { type: 'applyTransientFailure' }, this.now())
            await this.draftEffects(retried.effects, 'automation')
            current = retried.proposal
            continue // the retried provider pass does its own RE-READ + hash-check; drift surfaces as conflicted
          }
          throw error // not a mapped path — the outer failure net takes it
        }
        if (appliedResult.conflicted) {
          // Defensive: provider-side drift between our check and its write — map through the same T7 transition.
          const drifted = transition(
            current,
            { type: 'resolveHashCheck', actualHash: appliedResult.currentHash ?? actualHash, currentContent },
            this.now(),
          )
          await this.draftEffects(drifted.effects, 'automation')
          return {
            proposalId,
            applied: false,
            conflicted: true,
            status: 'conflict',
            reason: appliedResult.reason ?? 'hash-mismatch',
            currentHash: appliedResult.currentHash,
            conflictInfo: this.toWireRecord(drifted.proposal).conflictInfo,
          }
        }

        this.loopGuard.consumePendingWrite(proposalId)

        // §3.8: kernel-assigned ids exist only at apply time — bind $insertedBlockId placeholders
        // in the persisted inverse ops to the concrete created ref.
        const inverseOps =
          appliedResult.createdRef && current.inverseOps
            ? bindInsertedBlockId(current.inverseOps, appliedResult.createdRef.id)
            : current.inverseOps

        // Verify RE-READ (§3.1 same-reader rule) — ONE artifact discipline at all three hash
        // points (P1-3): T1 baseHash, this postHash and the T10 rollback RE-READ all cover
        // provider.get(targetRef), the ORIGINAL target. appendBlock/createDocument land inside
        // the target's own serialization, so hashing createdRef instead (as before) made every
        // append/create rollback conflict by construction.
        const verified = await provider.get(wire.targetRef)
        const postHash = await hashKnowledgeContent(verified.markdown ?? '')

        const succeeded = transition(current, { type: 'applyOpsSucceeded', postHash }, this.now())
        let finalProposal = inverseOps && inverseOps !== succeeded.proposal.inverseOps
          ? { ...succeeded.proposal, inverseOps }
          : succeeded.proposal
        // Persist kernel-created ref on the proposal record so publish finalize can resolve
        // the doc id after reload without the UI re-supplying appliedDocRef.
        if (appliedResult.createdRef) {
          finalProposal = { ...finalProposal, createdRef: appliedResult.createdRef }
        }
        const effects =
          finalProposal === succeeded.proposal
            ? succeeded.effects
            : succeeded.effects.map((effect) =>
                effect.kind === 'persist-proposal' ? { ...effect, proposal: finalProposal } : effect,
              )
        await this.draftEffects(effects, 'automation')
        const result: BridgeApplyResult = {
          proposalId,
          applied: true,
          conflicted: false,
          status: 'applied',
          appliedAt: finalProposal.appliedAt,
        }
        if (appliedResult.createdRef) result.createdRef = appliedResult.createdRef
        return result
      }
    } catch (error) {
      // P1-2 failure net: anything that is not one of the mapped conflict paths above becomes
      // conflict reason 'apply-failed'. The record moves applying → conflict with the error
      // text as the card content — persisted, audited, pushed; NEVER a rethrown strand.
      const message = error instanceof Error ? error.message : String(error)
      const at = new Date(this.now()).toISOString()
      const conflicted: CoreProposal = {
        ...begun.proposal,
        status: 'conflict',
        updatedAt: at,
        statusHistory: [
          ...begun.proposal.statusHistory,
          { from: begun.proposal.status, to: 'conflict', at, actor: 'automation', reason: 'apply-failed' },
        ],
        conflictInfo: {
          baseHash: begun.proposal.baseHash,
          baseReadAt: begun.proposal.baseReadAt,
          // The provider RE-READ may never have happened — baseHash placeholder, partial-apply precedent.
          actualHash: observedHash ?? begun.proposal.baseHash,
          currentContent: message, // the error text IS the actionable content of this card
          reason: 'apply-failed',
        },
      }
      this.deps.proposalsStore.save(this.toWireRecord(conflicted))
      await this.deps.audit.append({
        actor: 'automation',
        action: 'knowledge.proposal.conflict',
        target: this.auditTarget(conflicted),
        detail: this.detail({ proposalId, reason: 'apply-failed', message }),
      })
      this.deps.push?.({ ref: conflicted.targetRef, change: 'updated' })
      const result: BridgeApplyResult = {
        proposalId,
        applied: false,
        conflicted: true,
        status: 'conflict',
        reason: 'apply-failed',
        conflictInfo: this.toWireRecord(conflicted).conflictInfo,
      }
      if (observedHash !== undefined) result.currentHash = observedHash
      return result
    }
  }

  // -------------------------------------------------------------------------
  // T10: rollback — RE-READ hash-check vs post-apply hash, then the inverse
  // ops flow as a second apply pass (same HASH CHECK semantics).
  // -------------------------------------------------------------------------

  async rollback(proposalId: string): Promise<BridgeApplyResult> {
    const wire = this.requireProposal(proposalId)
    this.gate('knowledge.apply', wire.sessionId)
    const core = this.toCoreRecord(wire)
    if (core.status !== 'applied') {
      // Typed guard mirroring the engine's closed table (§3.2): rollback from non-applied is T11-illegal.
      throw new ProposalTransitionError(
        core.status,
        'rollback',
        `Transition "rollback" is not allowed from status "${core.status}" (§3.2 table is closed)`,
      )
    }

    const provider = await this.deps.providerResolver(wire.connectionId)
    const reRead = await provider.get(wire.targetRef)
    const currentContent = reRead.markdown ?? ''
    const currentHash = await hashKnowledgeContent(currentContent)

    let planned
    try {
      planned = transition(core, { type: 'rollback', currentHash }, this.now())
    } catch (error) {
      // The rollback itself conflicts (target drifted since apply): T7 semantics — persist
      // conflictInfo + audit + push, no write (§3.2 T10 guard: "rollback сам конфликтует → T7").
      if (error instanceof ProposalTransitionError && error.reason === 'rollback-hash-mismatch') {
        const at = new Date(this.now()).toISOString()
        const conflicted: CoreProposal = {
          ...core,
          status: 'conflict',
          updatedAt: at,
          statusHistory: [
            ...core.statusHistory,
            { from: core.status, to: 'conflict', at, actor: 'automation', reason: 'rollback-hash-mismatch' },
          ],
          conflictInfo: {
            baseHash: core.appliedHash ?? core.baseHash,
            baseReadAt: core.baseReadAt,
            actualHash: currentHash,
            currentContent,
            reason: 'rollback-hash-mismatch',
          },
        }
        this.deps.proposalsStore.save(this.toWireRecord(conflicted))
        await this.deps.audit.append({
          actor: 'automation',
          action: 'knowledge.proposal.conflict',
          target: this.auditTarget(conflicted),
          detail: this.detail({ proposalId, reason: 'rollback-hash-mismatch', actualHash: currentHash }),
        })
        this.deps.push?.({ ref: conflicted.targetRef, change: 'updated' })
        return {
          proposalId,
          applied: false,
          conflicted: true,
          status: 'conflict',
          reason: 'rollback-hash-mismatch',
          currentHash,
          conflictInfo: this.toWireRecord(conflicted).conflictInfo,
        }
      }
      throw error
    }

    // execute-inverse plan: one provider mutation pass PER inverse op (P1-3/P1-5). transactions
    // are an optional capability (InMemory defaults transactions=false) and §3.8 inverse ops may
    // address kernel-created children (append/create tombstones), never targetRef itself — so a
    // single-op pass with the op-implied ref is the only shape every provider accepts.
    const inverseEffect = planned.effects.find(
      (effect): effect is Extract<TransitionEffect, { kind: 'execute-inverse' }> => effect.kind === 'execute-inverse',
    )
    const inverseOps = inverseEffect?.ops ?? planned.proposal.inverseOps ?? []
    try {
      for (const op of inverseOps) {
        const opResult = await this.executeViaProvider(provider, [op], planned.proposal, inverseTargetRef(planned.proposal, op))
        if (!opResult.applied || opResult.conflicted) {
          throw new Error(
            `inverse op '${op.op}' was not applied cleanly (provider reported ${opResult.reason ?? 'no effect'})`,
          )
        }
      }
    } catch (error) {
      // P1-5: the inverse did NOT fully land → rolled_back is NEVER persisted. The record stays
      // 'applied' (the rollback click remains retryable from the conflict/applied card) and the
      // failure is audited + pushed instead of silently stamped.
      const message = error instanceof Error ? error.message : String(error)
      await this.deps.audit.append({
        actor: 'automation',
        action: 'knowledge.proposal.rollback_failed',
        target: this.auditTarget(core),
        detail: this.detail({ proposalId, reason: 'inverse-apply-failed', message }),
      })
      this.deps.push?.({ ref: core.targetRef, change: 'updated' })
      return { proposalId, applied: false, conflicted: false, status: 'applied', reason: 'rollback-failed' }
    }
    await this.draftEffects(planned.effects, 'user')
    return {
      proposalId,
      applied: true,
      conflicted: false,
      status: 'rolled_back',
      // P1-5b: T10 carries rolledBackAt; it must NOT be reported through the appliedAt field.
      rolledBackAt: planned.proposal.rolledBackAt,
    }
  }

  // -------------------------------------------------------------------------
  // Reads + lazy TTL hygiene (§3.7)
  // -------------------------------------------------------------------------

  get(proposalId: string): KnowledgeProposalFileRecord | null {
    return this.deps.proposalsStore.get(proposalId) as KnowledgeProposalFileRecord | null
  }

  list(filter?: ProposalListFilter): KnowledgeProposalFileRecord[] {
    return this.deps.proposalsStore.list(filter) as KnowledgeProposalFileRecord[]
  }

  /**
   * Lazy sweep (§3.7, no scheduler — invoked on bridge load): draft/pending_review past
   * DRAFT_TTL_MS are file-deleted (auto-T4, audit rejected reason='ttl-expired'); approved past
   * APPROVAL_TTL_MS are returned to pending_review by the store (audit approval_expired).
   * Bridge-side addition (P1-2 backstop): a producer that died after the T5 persist strands
   * its record in 'applying' — anything past APPLY_STUCK_TIMEOUT_MS is evacuated to an
   * actionable conflict through the ENGINE 'expire' branch (closed §3.2 table, one mechanism;
   * the store stays a dumb persistence layer — wire↔core mapping lives here).
   */
  async sweepExpired(): Promise<BridgeSweepResult> {
    const result = this.deps.proposalsStore.sweepExpired(this.now())
    for (const id of result.discarded) {
      await this.deps.audit.append({
        actor: 'automation',
        action: 'knowledge.proposal.rejected',
        target: `knowledge:proposal/${id}`,
        detail: this.detail({ proposalId: id, reason: 'ttl-expired' }),
      })
    }
    for (const id of result.approvalExpired) {
      const record = this.deps.proposalsStore.get(id)
      await this.deps.audit.append({
        actor: 'automation',
        action: 'knowledge.proposal.approval_expired',
        target: record ? siyuanDeepLink(record.targetRef) : `knowledge:proposal/${id}`,
        detail: this.detail({ proposalId: id, reason: 'approval-expired' }),
      })
    }
    const applyStalled: string[] = []
    for (const wire of this.deps.proposalsStore.list({ status: 'applying' })) {
      const core = this.toCoreRecord(wire as KnowledgeProposalFileRecord)
      if (!isApplyStuck(core, this.now())) continue
      const evacuated = transition(core, { type: 'expire' }, this.now())
      await this.draftEffects(evacuated.effects, 'automation')
      applyStalled.push(wire.id)
    }
    return { ...result, applyStalled }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** §3.4.1: guard rejections are audited as rejected proposals (no file is ever created). */
  private async auditRejectedProposal(
    error: MutationValidationError,
    args: KnowledgeBridgeProposeArgs,
    sessionId: string | undefined,
  ): Promise<void> {
    await this.deps.audit.append({
      actor: args.input.actor ?? 'user',
      action: 'knowledge.proposal.rejected',
      target: args.input.targetRef ? siyuanDeepLink(args.input.targetRef) : 'knowledge:proposal',
      detail: JSON.stringify({ reason: error.reason, connectionId: args.connectionId, sessionId }),
    })
  }

  private requireProposal(proposalId: string): KnowledgeProposalFileRecord {
    const record = this.deps.proposalsStore.get(proposalId) as KnowledgeProposalFileRecord | null
    if (!record) throw new CodedError('NOT_FOUND', `Knowledge mutation proposal not found: ${proposalId}`)
    return record
  }

  /** Permission-gate call (§3.6) with the session-resolved mode; fail-closed when unresolved. */
  private gate(action: KnowledgeAction, sessionId?: string): void {
    const mode = this.deps.resolvePermissionMode?.(sessionId) ?? getPermissionMode(sessionId ?? DEFAULT_NO_SESSION)
    this.assertAllowed(action, { workspaceId: this.deps.workspaceId, mode })
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private auditTarget(proposal: { targetRef: KnowledgeRef }): string {
    return siyuanDeepLink(proposal.targetRef)
  }

  private detail(fields: Record<string, unknown>): string {
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) clean[key] = value
    return JSON.stringify(clean)
  }

  /**
   * Execute the engine's effect plan: persistence to the proposals store, audit lines, and
   * knowledge:changed push. `read-target`/`execute-ops`/`execute-inverse` are consumed by the
   * apply/rollback drivers directly — they never appear here by construction.
   */
  private async draftEffects(effects: TransitionEffect[], fallbackAuditActor: MutationActor): Promise<void> {
    let auditTarget: string | null = null
    for (const effect of effects) {
      switch (effect.kind) {
        case 'persist-proposal': {
          this.deps.proposalsStore.save(this.toWireRecord(effect.proposal))
          auditTarget = this.auditTarget(effect.proposal)
          break
        }
        case 'delete-proposal-file':
          this.deps.proposalsStore.remove(effect.proposalId)
          break
        case 'audit':
          await this.deps.audit.append({
            actor: SYSTEM_ACTOR_AUDIT_ACTIONS[effect.action] === true ? 'automation' : fallbackAuditActor,
            action: effect.action,
            target: auditTarget ?? 'knowledge:proposal',
            detail: effect.detail ? JSON.stringify(effect.detail) : undefined,
          })
          break
        case 'push-changed':
          this.deps.push?.({ ref: effect.ref, change: effect.change })
          break
        // read-target / execute-ops / execute-inverse: consumed inline by apply()/rollback().
      }
    }
  }

  /**
   * One mutation pass through the provider's adapter path: a fresh provider-side proposal carries
   * the op batch (proof/permission gates are bridge-side, already executed) and provider
   * applyMutation executes with its own RE-READ + hash-check (defense in depth).
   * `targetRef` defaults to the proposal target; rollback passes one op-implied ref per inverse
   * op because §3.8 tombstones address kernel-created children, never the original target.
   */
  private async executeViaProvider(
    provider: KnowledgeProvider,
    ops: MutationOp[],
    proposal: CoreProposal,
    targetRef: KnowledgeRef = proposal.targetRef,
  ): Promise<CoreApplyResult> {
    const registered = await provider.proposeMutation({
      targetRef,
      ops,
      selectionProofs: proposal.selectionProofs,
      sessionId: proposal.sessionId,
      actor: proposal.actor,
    })
    return provider.applyMutation(registered.id)
  }
}

/** Render the engine's structured line diff as the unified-diff string the wire/UI expect. */
function renderUnifiedDiff(diff: ProposalDiffDocument): string {
  const body = diff.lines
    .map((line) => (line.kind === 'added' ? `+${line.text}` : line.kind === 'removed' ? `-${line.text}` : ` ${line.text}`))
    .join('\n')
  return `--- base\n+++ patched\n${body}`
}

/** Inverse-op implied target ref (§3.8): tombstone ops address kernel-created ids, not targetRef. */
function inverseTargetRef(proposal: CoreProposal, op: MutationOp): KnowledgeRef {
  const scheme = proposal.targetRef.scheme
  switch (op.op) {
    case 'updateBlock':
    case 'setAttribute':
      return { scheme, kind: 'block', id: op.blockId }
    case 'appendBlock':
      return { scheme, kind: 'document', id: op.documentId }
    default:
      return proposal.targetRef // createDocument never appears in an inverse batch
  }
}

/** Bind `$insertedBlockId[N]` placeholders in persisted inverse ops to the kernel-created id (§3.8). */
function bindInsertedBlockId(ops: readonly MutationOp[], createdId: string): MutationOp[] {
  const resolve = (value: string): string => value.replace(/\$insertedBlockId\[\d+\]/g, createdId)
  return ops.map((op) => {
    switch (op.op) {
      case 'updateBlock':
        return { ...op, blockId: resolve(op.blockId) }
      case 'setAttribute':
        return { ...op, blockId: resolve(op.blockId) }
      case 'appendBlock':
        return { ...op, documentId: resolve(op.documentId) }
      default:
        return op
    }
  })
}
