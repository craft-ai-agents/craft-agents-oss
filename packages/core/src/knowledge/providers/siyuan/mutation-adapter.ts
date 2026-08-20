/**
 * mutation-adapter.ts — strictly-sequential executor of the whitelisted MutationOps (P3,
 * docs/specs/2026-08-07-siyuan-integration/05-mutation-safety.md §3.4.1) over SiyuanKernelClient.
 *
 * Failure semantics (§3.8 + K-05 acceptance): if ops[k] fails with k > 0, the already-applied
 * ops 0..k-1 are compensated BEST-EFFORT (each inverse is try/caught so a failed tombstone never
 * masks the original error), in reverse application order, then PartialApplyError
 * { failedOpIndex: k, compensatedOps } is thrown — bridge-service maps it to conflict
 * reason='partial-apply-rolled-back'. A failure of ops[0] is rethrown untouched (nothing applied).
 *
 * NO delete/remove kernel endpoint exists anywhere on this path (§3.4.2): compensation is SOFT —
 * tombstone updateBlock + craft-rolled-back attribute, derived by P3-CORE's computeInverseOps.
 * Permission gating (§3.6 allowedApiEndpoints) is NOT enforced here; ops are assumed already
 * validated (validateProposalOps) and permitted by the bridge layer. The post-apply verify hash
 * is likewise the bridge's job: RE-READ via provider.get(targetRef) (§3.1 same-reader rule).
 *
 * Kernel attribute naming: SiYuan requires custom-* IAL keys (docs/API.zh-CN.md L1050) while the
 * Craft domain uses bare craft-* and knowledge-* names — applyOne() translates write-side, mirroring
 * the read-side 'custom-' strip in adapter.ts ialToAttributes().
 */

import {
  INSERTED_BLOCK_ID_REF,
  PartialApplyError,
  computeInverseOps,
  sliceCompensationInverses,
  type MutationOp,
  type PreStateSnapshot,
} from '../../mutations.ts';

import type { SiyuanKernelClient } from './client.ts';

export interface MutationExecutionResult {
  /** Ops applied successfully (always === ops on return; failures throw instead). */
  appliedOps: MutationOp[];
  /**
   * Kernel-assigned ids captured during execution (doc says createDocWithMd → bare doc id,
   * appendBlock → transaction doOperations[0].id). Anchors for §3.8 rollback + createdRef.
   */
  createdIds: { documentIds: string[]; blockIds: string[] };
  /**
   * Kernel-created id per ORIGINAL op index (createDocument/appendBlock only) — the capture map
   * §3.8 per-index inverse binding keys on (`$insertedBlockId[N]` ⇔ ops[N]).
   */
  createdIdsByOpIndex: Record<number, string>;
}

export interface ExecuteMutationOpsOptions {
  /** Target state captured at propose time (T1 READ); input for derived inverse ops. */
  preState?: PreStateSnapshot;
  /** Precomputed inverse ops (bridge's T3 output); take precedence over derivation. */
  inverseOps?: MutationOp[];
  /** ISO clock for tombstone markers (tests); defaults to new Date().toISOString(). */
  now?: () => string;
}

/** Craft-domain attr name → kernel IAL key (`craft-x` → `custom-craft-x`; already-prefixed kept). */
export function kernelAttrName(name: string): string {
  return name.startsWith('custom-') ? name : `custom-${name}`;
}

export async function executeMutationOps(
  client: SiyuanKernelClient,
  ops: MutationOp[],
  options: ExecuteMutationOpsOptions = {},
): Promise<MutationExecutionResult> {
  const createdIds = { documentIds: [] as string[], blockIds: [] as string[] };
  const createdIdsByOpIndex: Record<number, string> = {};
  const createdByIndex: Record<number, string> = {};
  const appliedOps: MutationOp[] = [];

  for (let index = 0; index < ops.length; index++) {
    const raw = ops[index]!;
    // Bind $insertedBlockId[N] on forward ops so createDocument + setAttribute batches work
    // (placeholders are only known after earlier create/append ops return kernel ids).
    const op = substituteInsertedIds(raw, createdByIndex);
    try {
      const createdId = await applyOne(client, op);
      if (createdId) {
        createdByIndex[index] = createdId;
        createdIdsByOpIndex[index] = createdId;
        if (raw.op === 'createDocument') createdIds.documentIds.push(createdId);
        else if (raw.op === 'appendBlock') createdIds.blockIds.push(createdId);
      }
      appliedOps.push(op);
    } catch (cause) {
      if (index === 0) throw cause;
      const compensatedOps = await compensate(client, ops, index, createdByIndex, options);
      throw new PartialApplyError(index, compensatedOps, { cause });
    }
  }

  return { appliedOps, createdIds, createdIdsByOpIndex };
}

/** Execute one whitelisted op; resolves to the kernel-created id when the op creates a node. */
async function applyOne(client: SiyuanKernelClient, op: MutationOp): Promise<string | undefined> {
  switch (op.op) {
    case 'createDocument':
      // op.title is enforced non-empty by validators; the kernel derives the doc name from path.
      return client.createDocWithMd({ notebook: op.notebook, path: op.path, markdown: op.markdown });
    case 'appendBlock':
      return client.appendBlock({ parentID: op.documentId, data: op.markdown });
    case 'updateBlock':
      await client.updateBlock({ id: op.blockId, data: op.markdown });
      return undefined;
    case 'setAttribute':
      await client.setBlockAttrs({ id: op.blockId, attrs: { [kernelAttrName(op.name)]: op.value } });
      return undefined;
    default: {
      // Exhaustiveness guard: a future op added to the union without executor support must not
      // silently pass — the §3.4.1 whitelist is deliberately closed.
      const never: never = op;
      throw new Error(`Unsupported mutation op: ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Best-effort SOFT compensation for ops 0..failedOpIndex-1 (REVERSE order per §3.2 invariant).
 * Inverse sources, in precedence order:
 *  1. options.inverseOps (bridge's T3 output, may contain $insertedBlockId[N] placeholders) —
 *     sliced by P3-CORE sliceCompensationInverses, placeholders bound to captured kernel ids;
 *  2. derivation via P3-CORE computeInverseOps(preState, appliedOps, {insertedBlockIds}) —
 *     emitted ids are already concrete; reversed to compensation order.
 * Every inverse step is individually try/caught: a failed tombstone must never mask the
 * original apply failure (§3.8).
 */
async function compensate(
  client: SiyuanKernelClient,
  ops: MutationOp[],
  failedOpIndex: number,
  createdByIndex: Record<number, string>,
  options: ExecuteMutationOpsOptions,
): Promise<MutationOp[]> {
  const at = options.now?.() ?? new Date().toISOString();
  let inverses: MutationOp[];
  if (options.inverseOps) {
    inverses = sliceCompensationInverses(options.inverseOps, ops, failedOpIndex);
  } else if (options.preState) {
    try {
      inverses = computeInverseOps(options.preState, ops.slice(0, failedOpIndex), {
        insertedBlockIds: createdByIndex,
        at,
      }).reverse();
    } catch {
      return []; // derivation itself is best-effort; never mask the original failure
    }
  } else {
    return [];
  }

  const compensatedOps: MutationOp[] = [];
  for (const inverse of inverses) {
    try {
      await applyOne(client, substituteInsertedIds(inverse, createdByIndex));
      compensatedOps.push(inverse);
    } catch {
      // best-effort per §3.8
    }
  }
  return compensatedOps;
}

/** Bind `$insertedBlockId[N]` pre-apply placeholders to the real kernel ids captured at apply. */
function substituteInsertedIds(op: MutationOp, createdByIndex: Record<number, string>): MutationOp {
  const resolve = (value: string): string =>
    value.replace(/\$insertedBlockId\[(\d+)\]/g, (match, digits: string) => createdByIndex[Number(digits)] ?? match);
  switch (op.op) {
    case 'updateBlock':
      return { ...op, blockId: resolve(op.blockId) };
    case 'setAttribute':
      return { ...op, blockId: resolve(op.blockId) };
    case 'appendBlock':
      return { ...op, documentId: resolve(op.documentId) };
    default:
      return op;
  }
}
