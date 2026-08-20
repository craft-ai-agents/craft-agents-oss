/**
 * proposal-actions.ts (P3, spec 05 K-05) — thin typed wrappers over the
 * write-back surface of `window.electronAPI.knowledge` (mutation-proposal
 * lifecycle RPCs). The server owns the status machine (T1–T11); each action
 * here is exactly one RPC plus a transition toast — no status logic, plan or
 * approval shortcuts client-side (there is intentionally NO silent-overwrite
 * helper; spec §3.4.2/§3.5).
 *
 * Structural typing keeps the module host-agnostic so logic stays testable in
 * logic-level `bun:test` (precedent: KnowledgeHome.resolveKnowledgeApi).
 */
import { toast } from 'sonner'
import type {
  ApplyResult,
  MutationInput,
  MutationProposal,
  MutationProposalStatus,
} from '@craft-agent/shared/protocol'

/** i18next `t` — structurally narrowed to what the toasts consume. */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string

/** The P3 write-back subset of ElectronAPI.knowledge (channels knowledge:<camel>). */
export interface KnowledgeMutationsApi {
  proposeMutation(args: {
    connectionId: string
    input: MutationInput
  }): Promise<MutationProposal>
  approveProposal(args: { proposalId: string }): Promise<MutationProposal>
  rejectProposal(args: { proposalId: string }): Promise<{ ok: true }>
  applyProposal(args: { proposalId: string; workspaceId?: string }): Promise<ApplyResult>
  rollbackProposal(args: { proposalId: string }): Promise<ApplyResult>
  getProposal(args: { proposalId: string }): Promise<MutationProposal>
  listProposals(args: {
    workspaceId?: string
    connectionId?: string
    status?: MutationProposalStatus
  }): Promise<MutationProposal[]>
}

/**
 * Reads the P3 write-back surface off the preload-injected ElectronAPI.
 * Returns `null` when the preload predates the P3 channels (feature-off
 * builds) — callers render the error state instead of crashing.
 */
export function resolveKnowledgeMutationsApi(): KnowledgeMutationsApi | null {
  if (typeof window === 'undefined' || !window.electronAPI?.knowledge) return null
  const api = window.electronAPI.knowledge
  return typeof api.proposeMutation === 'function' ? api : null
}

/** One RPC with a uniform error toast; `null` means the call failed loudly. */
async function runAction<T>(t: TranslateFn, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    toast.error(t('knowledge.surface.error'), {
      description: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** T3 (user): pending_review → approved. */
export async function approveProposalAction(
  api: KnowledgeMutationsApi,
  t: TranslateFn,
  proposalId: string,
): Promise<MutationProposal | null> {
  const proposal = await runAction(t, () => api.approveProposal({ proposalId }))
  if (proposal) toast.success(t('knowledge.toast.approved'))
  return proposal
}

/** T4 (user): pending_review → discard (file removed server-side). */
export async function rejectProposalAction(
  api: KnowledgeMutationsApi,
  t: TranslateFn,
  proposalId: string,
): Promise<boolean> {
  const result = await runAction(t, () => api.rejectProposal({ proposalId }))
  if (result?.ok) {
    toast.success(t('knowledge.toast.rejected'))
    return true
  }
  return false
}

/** T5→T6/T7 (user): approved → applied | conflict. */
export async function applyProposalAction(
  api: KnowledgeMutationsApi,
  t: TranslateFn,
  proposalId: string,
  workspaceId?: string,
): Promise<ApplyResult | null> {
  const result = await runAction(t, () => api.applyProposal({ proposalId, workspaceId }))
  if (result) {
    if (result.status === 'conflict') toast.error(t('knowledge.toast.conflict'))
    else toast.success(t('knowledge.toast.applied'))
  }
  return result
}

/** T10 (user): applied → rolled_back via the persisted inverse ops. */
export async function rollbackProposalAction(
  api: KnowledgeMutationsApi,
  t: TranslateFn,
  proposalId: string,
): Promise<ApplyResult | null> {
  const result = await runAction(t, () => api.rollbackProposal({ proposalId }))
  if (result) {
    if (result.status === 'conflict') toast.error(t('knowledge.toast.conflict'))
    else toast.success(t('knowledge.toast.rolledBack'))
  }
  return result
}

/**
 * T9 (user): conflict rebase — re-runs `proposeMutation` against the SAME
 * target with the same patch. The server performs a fresh READ and rebuilds
 * the diff against the live base; the old proposal is marked `superseded`.
 * No toast on success — the caller navigates to the new proposal's surface.
 */
export async function rebaseProposalAction(
  api: KnowledgeMutationsApi,
  t: TranslateFn,
  proposal: MutationProposal,
): Promise<MutationProposal | null> {
  return runAction(t, () =>
    api.proposeMutation({
      connectionId: proposal.connectionId,
      input: {
        targetRef: proposal.targetRef,
        ops: proposal.ops,
        selectionProofs: proposal.selectionProofs.length > 0 ? proposal.selectionProofs : undefined,
        sessionId: proposal.sessionId,
        // Links this fresh cycle to the conflict it replaces: the bridge
        // supersedes the old record (audited) before the new T1 READ (P1-6).
        rebaseOfProposalId: proposal.id,
      },
    }),
  )
}

/** Non-terminal proposal statuses worth surfacing as an actionable count. */
export const ACTIONABLE_PROPOSAL_STATUSES: readonly MutationProposalStatus[] = [
  'pending_review',
  'conflict',
]

/** Count of proposals awaiting a user action (KnowledgeHome badge). */
export async function countActionableProposals(
  api: KnowledgeMutationsApi,
  workspaceId?: string,
): Promise<number> {
  const list = await api.listProposals({ workspaceId })
  return list.filter((p) => ACTIONABLE_PROPOSAL_STATUSES.includes(p.status)).length
}
