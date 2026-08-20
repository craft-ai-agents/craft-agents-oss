/**
 * Knowledge mutation-pipeline permission gate (P3, spec 05 §3.6).
 *
 * `bridge-service.ts` calls `assertKnowledgeActionAllowed(action, ctx)` before
 * the T1 (propose), T3 (approve) and T5 (apply) transitions — this module is
 * the single enforcement point wiring the permissions engine into the
 * MutationProposal state machine.
 *
 * Mode matrix (spec 05 §3.6, verbatim semantics):
 *
 * | Mode (canonical)      | propose (T1) | approve (T3)     | apply (T5→T6)        |
 * |-----------------------|--------------|------------------|----------------------|
 * | `safe` (Explore)      | DENIED       | DENIED           | DENIED               |
 * | `ask` (Ask to Edit)   | allowed      | human click only | only after approval  |
 * | `allow-all` (Auto)    | allowed      | human click only | only after approval  |
 *
 * - `safe`: proposal creation is forbidden, so no proposal can exist —
 *   approve/apply are unreachable in principle and are denied fail-closed too.
 * - `ask` / `allow-all`: this gate returns. Approval and application still
 *   happen ONLY through explicit user clicks (T3/T5) — the state machine
 *   (spec 05 §3.2) refuses apply from any status other than `approved` and
 *   `approvedBy` is always `'user'`.
 *
 * INVARIANT (spec 05 §4, §6 open question 5): NO permission mode bypasses the
 * pipeline. There is no auto-approve or direct-write path in v1, and this
 * module MUST NOT grow one — a future per-workspace auto-approve rule would
 * require its own ADR plus audit wiring.
 */
import { CodedError, type ErrorCode } from '../protocol/types.ts';
import type { PermissionMode } from './mode-types.ts';

/**
 * Actions the pipeline gate can be asked to authorize. Names follow the
 * audit-vocabulary style of spec 05 §3.8 (`knowledge.*`).
 */
export type KnowledgeAction =
  | 'knowledge.propose'
  | 'knowledge.approve'
  | 'knowledge.apply';

export interface KnowledgeActionContext {
  /** Workspace the proposal targets (reserved: future workspace-scoped rules; never grants a bypass). */
  workspaceId?: string;
  /**
   * Effective permission mode. When omitted the gate is FAIL-CLOSED and
   * behaves as `safe` — a caller that forgot to resolve the mode must not
   * accidentally authorize writes.
   */
  mode?: PermissionMode;
}

/**
 * Error `code` carried by the CodedError thrown on denial.
 *
 * The protocol `ErrorCode` union has no PERMISSION_DENIED member yet (P3
 * protocol surface); `CAPABILITY_DISABLED` is the closest existing code for
 * "this capability is disabled in the current mode". Exported as a constant
 * so consumers branch on a stable symbol — receivers MUST match on
 * `err.code`, never `instanceof CodedError` (class identity is lost across
 * the wire). If the protocol later adds PERMISSION_DENIED, switching is a
 * one-line change here.
 */
export const KNOWLEDGE_PERMISSION_DENIED_CODE = 'CAPABILITY_DISABLED' satisfies ErrorCode;

/**
 * Throw when `action` is not allowed in the current permission mode; return
 * otherwise. See the module docstring for the mode matrix and the
 * no-auto-approve invariant.
 */
export function assertKnowledgeActionAllowed(
  action: KnowledgeAction,
  ctx: KnowledgeActionContext = {},
): void {
  const mode = ctx.mode ?? 'safe';
  if (mode === 'safe') {
    throw new CodedError(
      KNOWLEDGE_PERMISSION_DENIED_CODE,
      `Knowledge action '${action}' is disabled in safe (Explore) permission mode: ` +
        `SiYuan writes flow through the mutation proposal pipeline (spec 05 §3.6), ` +
        `which requires Ask to Edit or Auto mode. Switch permission mode to proceed.`,
    );
  }
  // 'ask' | 'allow-all': allowed by this gate; human approve/apply clicks are
  // enforced by the proposal state machine, not here.
  return;
}

// Default export kept for bridge-service constructor-injection compatibility
// (`deps.assertKnowledgeActionAllowed ?? <default>`); identical function.
export default assertKnowledgeActionAllowed;
