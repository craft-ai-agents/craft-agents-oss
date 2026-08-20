/**
 * Bridge-integration tests for the SiYuan write path: the REAL SiyuanKnowledgeProvider +
 * SiyuanKernelClient run the exact call sequence bridge-service.ts executeViaProvider issues
 * (packages/server-core/src/knowledge/bridge-service.ts):
 *
 *     const registered = await provider.proposeMutation({
 *       targetRef: proposal.targetRef,
 *       ops,
 *       selectionProofs: proposal.selectionProofs,
 *       sessionId: proposal.sessionId,
 *       actor: proposal.actor,
 *     })
 *     return provider.applyMutation(registered.id)
 *
 * against a stateful in-memory kernel behind the injected fetch seam (constructor injection —
 * globalThis.fetch is never touched, so this file composes safely in bun's single-process runs).
 * Scenario coverage mirrors InMemoryKnowledgeProvider's mutation suite ("InMemory-equivalent"
 * fixture) plus the rollback-pass contract the bridge's T10 fix drives per-op.
 */

import { describe, expect, test } from 'bun:test';

import {
  INSERTED_BLOCK_ID_REF,
  computeInverseOps,
  type MutationOp,
  type SelectionProof,
} from '../../../mutations.ts';
import { PROVENANCE_ATTR } from '../../../publications.ts';
import { hashKnowledgeContent, type ApplyResult, type MutationInput, type MutationProposal } from '../../../provider.ts';
import type { KnowledgeRef } from '../../../refs.ts';
import { SiyuanKnowledgeProvider } from '../adapter.ts';
import { SiyuanKernelClient } from '../client.ts';

// ---------------------------------------------------------------------------
// Injected fetch harness (verbatim convention from adapter.test.ts)

type HandlerResult = { data?: unknown; code?: number; msg?: string; httpStatus?: number };
type Handler = (body: Record<string, unknown>) => HandlerResult;

interface FetchCall {
  endpoint: string;
  body: Record<string, unknown>;
}

function makeKernel() {
  const state = {
    docs: new Map<string, { markdown: string; notebook: string; hPath: string }>([
      ['doc-1', { markdown: 'BASE LINE', notebook: 'nb-1', hPath: '/Inbox/Doc 1' }],
    ]),
    blocks: new Map<string, { markdown: string; docId: string }>([
      ['blk-1', { markdown: 'ORIGINAL BLOCK', docId: 'doc-1' }],
    ]),
    attrs: new Map<string, Record<string, string>>(),
    created: 0,
  };
  const calls: FetchCall[] = [];

  const handlers: Record<string, Handler> = {
    '/api/block/checkBlockExist': (body) => ({
      data: state.docs.has(String(body.id)) || state.blocks.has(String(body.id)) || String(body.id) === 'nb-1',
    }),
    '/api/export/exportMdContent': (body) => {
      const doc = state.docs.get(String(body.id));
      return { data: { hPath: doc?.hPath ?? '', content: doc?.markdown ?? '' } };
    },
    '/api/block/getDocInfo': (body) => ({
      data: {
        id: String(body.id),
        rootID: String(body.id),
        name: state.docs.get(String(body.id))?.hPath.split('/').pop() ?? 'doc',
        refCount: 0,
        subFileCount: 0,
        refIDs: [],
        ial: {},
        icon: '',
        attrViews: [],
      },
    }),
    '/api/attr/getBlockAttrs': (body) => ({
      data: state.attrs.get(String(body.id)) ?? { id: String(body.id), updated: '20260807120000' },
    }),
    '/api/block/getBlockKramdown': (body) => ({
      data: {
        id: String(body.id),
        kramdown: state.blocks.get(String(body.id))?.markdown ?? state.docs.get(String(body.id))?.markdown ?? '',
      },
    }),
    '/api/block/getBlockInfo': (body) => ({
      data: {
        box: 'nb-1',
        path: '/20260807120000-a1.sy',
        rootID: state.blocks.get(String(body.id))?.docId ?? String(body.id),
        rootTitle: 'Doc 1',
        rootTitleEmpty: false,
        rootChildID: '',
        rootIcon: '',
      },
    }),
    '/api/filetree/getHPathByID': () => ({ data: '/Inbox/Doc 1' }),
    '/api/notebook/lsNotebooks': () => ({
      data: {
        notebooks: [{ id: 'nb-1', name: 'Inbox', icon: '', sort: 0, sortMode: 0, closed: false, subFileCount: 2 }],
        boxDocEnabled: false,
      },
    }),
    '/api/filetree/createDocWithMd': (body) => {
      const id = `doc-new-${++state.created}`;
      state.docs.set(id, { markdown: String(body.markdown), notebook: String(body.notebook), hPath: String(body.path) });
      return { data: id };
    },
    '/api/block/appendBlock': (body) => {
      const id = `blk-new-${++state.created}`;
      const parentID = String(body.parentID);
      const data = String(body.data);
      state.blocks.set(id, { markdown: data, docId: parentID });
      const doc = state.docs.get(parentID);
      if (doc) doc.markdown = doc.markdown === '' ? data : `${doc.markdown}\n${data}`;
      return { data: [{ doOperations: [{ action: 'insert', data: null, id, parentID, retData: null }] }] };
    },
    '/api/block/updateBlock': (body) => {
      const id = String(body.id);
      const data = String(body.data);
      const block = state.blocks.get(id);
      if (block) block.markdown = data;
      else {
        const doc = state.docs.get(id);
        if (doc) doc.markdown = data;
      }
      return { data: [{ doOperations: [{ action: 'update', data: null, id, parentID: '', retData: null }] }] };
    },
    '/api/attr/setBlockAttrs': (body) => {
      const id = String(body.id);
      state.attrs.set(id, { ...(state.attrs.get(id) ?? { id }), ...(body.attrs as Record<string, string>) });
      return { data: null };
    },
  };

  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ endpoint, body });
    const handler = handlers[endpoint];
    if (!handler) throw new Error(`unmocked kernel endpoint: ${endpoint}`);
    const result = handler(body);
    if (result.httpStatus !== undefined) return new Response('', { status: result.httpStatus });
    return new Response(JSON.stringify({ code: result.code ?? 0, msg: result.msg ?? '', data: result.data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const provider = new SiyuanKnowledgeProvider({
    connection: { id: 'conn-1', provider: 'siyuan', label: 'Local SiYuan', baseUrl: 'http://127.0.0.1:6806', status: 'connected' },
    client: new SiyuanKernelClient({ baseUrl: 'http://127.0.0.1:6806', token: 'tok', fetchImpl }),
  });
  return { provider, state, calls };
}

/**
 * Verbatim mirror of bridge-service executeViaProvider: the bridge has already run its
 * proof/permission gates and hash checks; this is the provider pass it drives.
 */
async function executeViaProvider(
  provider: SiyuanKnowledgeProvider,
  ops: MutationOp[],
  proposal: { targetRef: KnowledgeRef; selectionProofs?: SelectionProof[]; sessionId?: string; actor?: MutationInput['actor'] },
): Promise<ApplyResult> {
  const registered = await provider.proposeMutation({
    targetRef: proposal.targetRef,
    ops,
    selectionProofs: proposal.selectionProofs,
    sessionId: proposal.sessionId,
    actor: proposal.actor,
  });
  return provider.applyMutation(registered.id);
}

/**
 * The bridge's T10 rollback contract (per FixB): inverse ops execute one op per pass, each
 * pass targeting the op's own node (block kind for updateBlock/setAttribute, document kind
 * for appendBlock) — no selection proofs exist for kernel-created ids, and none are needed.
 */
async function rollbackPerOp(provider: SiyuanKnowledgeProvider, inverseOps: MutationOp[]): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const op of inverseOps) {
    let targetRef: KnowledgeRef;
    if (op.op === 'appendBlock') {
      targetRef = { scheme: 'siyuan', kind: 'document', id: op.documentId };
    } else if (op.op === 'updateBlock' || op.op === 'setAttribute') {
      targetRef = { scheme: 'siyuan', kind: 'block', id: op.blockId };
    } else {
      throw new Error(`rollback pass received un-routable inverse op: ${op.op}`);
    }
    results.push(await executeViaProvider(provider, [op], { targetRef }));
  }
  return results;
}

const DOC_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' };
const BLK_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: 'blk-1' };
const NB_REF: KnowledgeRef = { scheme: 'siyuan', kind: 'notebook', id: 'nb-1' };

describe('executeViaProvider bridge pass — InMemory-equivalent scenarios over the real adapter', () => {
  test('updateBlock pass: apply mutates the node; per-op rollback pass restores the original', async () => {
    const { provider, state } = makeKernel();
    const op: MutationOp = { op: 'updateBlock', blockId: 'blk-1', markdown: 'REPLACED BLOCK' };
    const proof: SelectionProof = {
      kind: 'surface-selection',
      selectionId: 'sel-1',
      ref: BLK_REF,
      selectedAt: new Date().toISOString(),
    };

    const applied = await executeViaProvider(provider, [op], { targetRef: BLK_REF, selectionProofs: [proof] });
    expect(applied).toMatchObject({ applied: true, conflicted: false, status: 'applied' });
    expect(applied.appliedAt).toBeDefined();
    expect(applied.currentHash).toBe(await hashKnowledgeContent('REPLACED BLOCK'));
    expect(state.blocks.get('blk-1')!.markdown).toBe('REPLACED BLOCK');

    // Rollback: the bridge's inverse flow — the engine's per-index inverse ops (here: restore).
    const inverseOps = computeInverseOps(
      { content: 'ORIGINAL BLOCK' },
      [op],
      { at: '2026-08-07T00:00:00.000Z' },
    );
    const rolled = await rollbackPerOp(provider, inverseOps);
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toMatchObject({ applied: true, status: 'applied' });
    expect(state.blocks.get('blk-1')!.markdown).toBe('ORIGINAL BLOCK');
  });

  test('appendBlock pass: createdRef is the kernel-assigned child id; rollback tombstones it', async () => {
    const { provider, state } = makeKernel();
    const op: MutationOp = { op: 'appendBlock', documentId: 'doc-1', markdown: 'APPENDED LINE' };

    const applied = await executeViaProvider(provider, [op], { targetRef: DOC_REF });
    expect(applied).toMatchObject({ applied: true, status: 'applied' });
    expect(applied.createdRef).toEqual({ scheme: 'siyuan', kind: 'block', id: 'blk-new-1' });
    expect(state.docs.get('doc-1')!.markdown).toBe('BASE LINE\nAPPENDED LINE');

    // Engine-derived inverses, $insertedBlockId bound to the created id by the bridge; each
    // inverse op is its own pass keyed to the op target (kernel-created ids carry no proofs).
    const inverseOps = computeInverseOps({ content: 'BASE LINE' }, [op], {
      insertedBlockIds: { 0: 'blk-new-1' },
      at: '2026-08-07T00:00:00.000Z',
    });
    const rolled = await rollbackPerOp(provider, inverseOps);
    expect(rolled).toHaveLength(2);
    for (const result of rolled) expect(result.applied).toBe(true);
    expect(state.blocks.get('blk-new-1')!.markdown).toContain('откачено Craft');
    expect(state.attrs.get('blk-new-1')).toMatchObject({ 'custom-craft-rolled-back': 'true' });
  });

  test('createDocument pass: createdRef is the new document; verify hash covers its content', async () => {
    const { provider, state } = makeKernel();
    const op: MutationOp = { op: 'createDocument', notebook: 'nb-1', path: '/Inbox/New Doc', title: 'New Doc', markdown: '# New\n' };

    const applied = await executeViaProvider(provider, [op], { targetRef: NB_REF });
    expect(applied).toMatchObject({ applied: true, status: 'applied' });
    expect(applied.createdRef).toEqual({ scheme: 'siyuan', kind: 'document', id: 'doc-new-1' });
    expect(applied.currentHash).toBe(await hashKnowledgeContent('# New\n'));
    expect(state.docs.get('doc-new-1')!.markdown).toBe('# New\n');
  });

  test('setAttribute pass: writes custom-* IAL through the kernel mapping', async () => {
    const { provider, state } = makeKernel();
    const op: MutationOp = { op: 'setAttribute', blockId: 'blk-1', name: 'craft-status', value: 'reviewed' };
    const proof: SelectionProof = {
      kind: 'surface-selection',
      selectionId: 'sel-2',
      ref: BLK_REF,
      selectedAt: new Date().toISOString(),
    };

    const applied = await executeViaProvider(provider, [op], { targetRef: BLK_REF, selectionProofs: [proof] });
    expect(applied.applied).toBe(true);
    expect(state.attrs.get('blk-1')).toMatchObject({ 'custom-craft-status': 'reviewed' });
  });

  test('provider-side RE-READ+HASH CHECK: drift between propose and apply conflicts the pass', async () => {
    const { provider, state, calls } = makeKernel();
    // Split the pass manually to inject drift in the window the defense-in-depth covers.
    const registered: MutationProposal = await provider.proposeMutation({
      targetRef: DOC_REF,
      ops: [{ op: 'appendBlock', documentId: 'doc-1', markdown: 'APPENDED LINE' }],
    });
    state.docs.get('doc-1')!.markdown = 'CONCURRENT EDIT';

    const result = await provider.applyMutation(registered.id);
    expect(result).toMatchObject({
      applied: false,
      conflicted: true,
      status: 'conflict',
      reason: 'hash-mismatch',
      currentHash: await hashKnowledgeContent('CONCURRENT EDIT'),
    });
    expect(calls.every((call) => call.endpoint !== '/api/block/appendBlock')).toBe(true);
  });

  test('publish batch: createDocument + setAttribute($insertedBlockId[0]) multi-op applies attrs on created doc', async () => {
    // Mirrors production buildPublishOps create path: one proposeMutation with create +
    // provenance setAttribute ops targeting $insertedBlockId[0], then a single applyMutation.
    const { provider, state, calls } = makeKernel();
    const body = '# Published\n\nSession distill body.\n';
    const ops: MutationOp[] = [
      {
        op: 'createDocument',
        notebook: 'nb-1',
        path: '/Inbox/Publish Batch',
        title: 'Publish Batch',
        markdown: body,
      },
      {
        op: 'setAttribute',
        blockId: `${INSERTED_BLOCK_ID_REF}[0]`,
        name: PROVENANCE_ATTR.sourceSessionId,
        value: 'sess-publish-1',
      },
      {
        op: 'setAttribute',
        blockId: `${INSERTED_BLOCK_ID_REF}[0]`,
        name: PROVENANCE_ATTR.contentHash,
        value: 'a'.repeat(64),
      },
    ];

    const applied = await executeViaProvider(provider, ops, { targetRef: NB_REF });
    expect(applied).toMatchObject({ applied: true, conflicted: false, status: 'applied' });
    expect(applied.createdRef).toEqual({ scheme: 'siyuan', kind: 'document', id: 'doc-new-1' });
    expect(state.docs.get('doc-new-1')).toEqual({
      markdown: body,
      notebook: 'nb-1',
      hPath: '/Inbox/Publish Batch',
    });
    // custom-* IAL mapping: craft-* → custom-craft-*
    expect(state.attrs.get('doc-new-1')).toMatchObject({
      'custom-craft-source-session-id': 'sess-publish-1',
      'custom-craft-content-hash': 'a'.repeat(64),
    });
    // create once, then two setBlockAttrs against the kernel-assigned id (not the placeholder)
    expect(calls.filter((c) => c.endpoint === '/api/filetree/createDocWithMd')).toHaveLength(1);
    const attrCalls = calls.filter((c) => c.endpoint === '/api/attr/setBlockAttrs');
    expect(attrCalls).toHaveLength(2);
    for (const call of attrCalls) {
      expect(call.body.id).toBe('doc-new-1');
    }
  });
});
