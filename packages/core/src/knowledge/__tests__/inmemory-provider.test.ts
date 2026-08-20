import { describe, expect, test } from 'bun:test';

import { KnowledgeError } from '../errors.ts';
import {
  createKnowledgeRegistry,
  hashKnowledgeContent,
  type KnowledgeConnection,
  type KnowledgeNode,
  type KnowledgeProviderFactory,
} from '../provider.ts';
import { InMemoryKnowledgeProvider } from '../providers/inmemory.ts';
import type { KnowledgeKind, KnowledgeRef } from '../refs.ts';

async function mkNode(kind: KnowledgeKind, id: string, overrides: Partial<KnowledgeNode> = {}): Promise<KnowledgeNode> {
  const node: KnowledgeNode = {
    ref: { scheme: 'siyuan', kind, id },
    title: id,
    markdown: '',
    path: `/${id}`,
    attributes: [],
    createdAt: 1,
    updatedAt: 1,
    contentHash: '',
    ...overrides,
  };
  if (!overrides.contentHash) node.contentHash = await hashKnowledgeContent(node.markdown ?? '');
  return node;
}

async function seededProvider(): Promise<InMemoryKnowledgeProvider> {
  const nb1 = await mkNode('notebook', 'nb-1', { title: 'Research', path: '/' });
  const nb2 = await mkNode('notebook', 'nb-2', { title: 'Archive', path: '/archive' });
  const doc1 = await mkNode('document', 'doc-1', {
    title: 'Craft × SiYuan',
    markdown: '# Craft × SiYuan\n\nIntegrating Craft with SiYuan engine.',
    parentRef: nb1.ref,
    path: '/Research/Craft × SiYuan',
    updatedAt: 100,
  });
  const doc2 = await mkNode('document', 'doc-2', {
    title: 'Roadmap',
    markdown: 'P1 read-only provider',
    parentRef: nb1.ref,
    path: '/Research/Roadmap',
    attributes: [{ key: 'status', value: 'draft' }],
    updatedAt: 200,
  });
  const block1 = await mkNode('block', 'block-1', {
    title: 'Intro paragraph',
    markdown: 'Integrating Craft with SiYuan brings backlinks.',
    parentRef: doc1.ref,
    path: '/Research/Craft × SiYuan/block-1',
    updatedAt: 300,
  });
  const docA = await mkNode('document', 'doc-a', {
    title: 'Old notes',
    markdown: 'legacy content',
    parentRef: nb2.ref,
    path: '/archive/Old notes',
    updatedAt: 50,
  });
  const db1 = await mkNode('database', 'db-1', { title: 'Tasks DB', attributes: [{ key: 'type', value: 'tasks' }] });
  return new InMemoryKnowledgeProvider({
    connectionId: 'test-connection',
    seed: {
      nodes: [nb1, nb2, doc1, doc2, block1, docA, db1],
      links: [
        { sourceId: 'doc-2', targetId: 'doc-1' },
        { sourceId: 'block-1', targetId: 'doc-2' },
      ],
    },
  });
}

async function catchKnowledgeError(run: () => Promise<unknown>): Promise<KnowledgeError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(KnowledgeError);
    return error as KnowledgeError;
  }
  throw new Error('expected KnowledgeError');
}

describe('hashKnowledgeContent', () => {
  test('is stable, 64-char sha256 hex, and normalizes line endings', async () => {
    const hash = await hashKnowledgeContent('# Title');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashKnowledgeContent('# Title')).toBe(hash);
    expect(await hashKnowledgeContent('a\r\nb\r\n')).toBe(await hashKnowledgeContent('a\nb\n'));
    expect(await hashKnowledgeContent('a')).not.toBe(await hashKnowledgeContent('b'));
  });
});

describe('InMemoryKnowledgeProvider.search', () => {
  test('defaults to document+block kinds and sorts by updatedAt desc', async () => {
    const provider = await seededProvider();
    const page = await provider.search({ query: '' });
    expect(page.items.map((hit) => hit.ref.id)).toEqual(['block-1', 'doc-2', 'doc-1', 'doc-a']);
    expect(page.totalEstimate).toBe(4);
    expect(page.nextCursor).toBeUndefined();
  });

  test('query filters on title+markdown and snippet carries the match context', async () => {
    const provider = await seededProvider();
    const page = await provider.search({ query: 'backlinks' });
    expect(page.items.map((hit) => hit.ref.id)).toEqual(['block-1']);
    expect(page.items[0]?.snippet).toContain('backlinks');
    expect(page.items[0]?.notebookPath).toBe('/');
  });

  test('kinds filter includes notebooks on request', async () => {
    const provider = await seededProvider();
    const page = await provider.search({ query: '', kinds: ['notebook'] });
    expect(page.items.map((hit) => hit.ref.id).sort()).toEqual(['nb-1', 'nb-2']);
  });

  test('notebookId filter scopes to a single notebook tree', async () => {
    const provider = await seededProvider();
    expect((await provider.search({ query: '', notebookId: 'nb-1' })).items.map((hit) => hit.ref.id)).toEqual([
      'block-1',
      'doc-2',
      'doc-1',
    ]);
    expect((await provider.search({ query: '', notebookId: 'nb-2' })).items.map((hit) => hit.ref.id)).toEqual(['doc-a']);
  });

  test('pathPrefix filter scopes by path', async () => {
    const provider = await seededProvider();
    expect((await provider.search({ query: '', pathPrefix: '/archive' })).items.map((hit) => hit.ref.id)).toEqual([
      'doc-a',
    ]);
  });

  test('attributes filter requires every key/value to match', async () => {
    const provider = await seededProvider();
    expect((await provider.search({ query: '', attributes: { status: 'draft' } })).items.map((h) => h.ref.id)).toEqual([
      'doc-2',
    ]);
    expect(
      (await provider.search({ query: '', attributes: { status: 'draft', missing: 'x' } })).items,
    ).toHaveLength(0);
  });

  test('limit + cursor paginate through the full ordered result set', async () => {
    const provider = await seededProvider();
    const first = await provider.search({ query: '', limit: 2 });
    expect(first.items.map((hit) => hit.ref.id)).toEqual(['block-1', 'doc-2']);
    expect(first.nextCursor).toBeDefined();
    const second = await provider.search({ query: '', limit: 2, cursor: first.nextCursor });
    expect(second.items.map((hit) => hit.ref.id)).toEqual(['doc-1', 'doc-a']);
    expect(second.nextCursor).toBeUndefined();
    expect([...first.items, ...second.items].map((hit) => hit.ref.id)).toEqual(
      (await provider.search({ query: '' })).items.map((hit) => hit.ref.id),
    );
  });
});

describe('InMemoryKnowledgeProvider.get', () => {
  test('returns the node with a computed blockCount for documents', async () => {
    const provider = await seededProvider();
    const node = await provider.get({ scheme: 'siyuan', kind: 'document', id: 'doc-1' });
    expect(node.title).toBe('Craft × SiYuan');
    expect(node.blockCount).toBe(1);
  });

  test('unknown node → typed NOT_FOUND', async () => {
    const provider = await seededProvider();
    const error = await catchKnowledgeError(() => provider.get({ scheme: 'siyuan', kind: 'document', id: 'nope' }));
    expect(error.code).toBe('NOT_FOUND');
  });

  test('invalid ref → typed INVALID_REF', async () => {
    const provider = await seededProvider();
    const wrongScheme = await catchKnowledgeError(() =>
      provider.get({ scheme: 'craft', kind: 'session', id: 's1' } as unknown as KnowledgeRef),
    );
    expect(wrongScheme.code).toBe('INVALID_REF');
    const wrongKind = await catchKnowledgeError(() =>
      provider.get({ scheme: 'siyuan', kind: 'flow', id: 'f1' } as unknown as KnowledgeRef),
    );
    expect(wrongKind.code).toBe('INVALID_REF');
  });
});

describe('InMemoryKnowledgeProvider.getContext', () => {
  test('snapshot payload carries content, children, backlinks, attributes, and hash', async () => {
    const provider = await seededProvider();
    const payload = await provider.getContext({ scheme: 'siyuan', kind: 'document', id: 'doc-1' }, 'snapshot');
    expect(payload.ref.id).toBe('doc-1');
    expect(payload.mode).toBe('snapshot');
    expect(payload.blockId).toBe('doc-1');
    expect(payload.content).toContain('Integrating Craft with SiYuan engine.');
    expect(payload.children).toEqual([
      { blockId: 'block-1', content: 'Integrating Craft with SiYuan brings backlinks.' },
    ]);
    expect(payload.backlinks).toEqual([{ ref: { scheme: 'siyuan', kind: 'document', id: 'doc-2' }, title: 'Roadmap' }]);
    expect(payload.contentHash).toBe(await hashKnowledgeContent(payload.content));
    expect(typeof payload.capturedAt).toBe('number');
  });

  test('backlinks relation: a node referenced by a block lists that block', async () => {
    const provider = await seededProvider();
    const payload = await provider.getContext({ scheme: 'siyuan', kind: 'document', id: 'doc-2' }, 'snapshot');
    expect(payload.backlinks).toEqual([
      { ref: { scheme: 'siyuan', kind: 'block', id: 'block-1' }, title: 'Intro paragraph' },
    ]);
  });

  test('live-reference mode is honored when the capability is on, rejected when off', async () => {
    const provider = await seededProvider();
    const ref: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' };
    expect((await provider.getContext(ref, 'live-reference')).mode).toBe('live-reference');

    const caps = await provider.capabilities();
    caps.features.liveReference = false;
    const noLive = new InMemoryKnowledgeProvider({ capabilities: caps, seed: { nodes: [await mkNode('document', 'doc-1')] } });
    const error = await catchKnowledgeError(() => noLive.getContext(ref, 'live-reference'));
    expect(error.code).toBe('UNSUPPORTED_OPERATION');
  });
});

describe('InMemoryKnowledgeProvider mutations (documented choice: full in-memory P3 semantics)', () => {
  test('updateBlock: propose → pending_review with diff, apply mutates the node', async () => {
    const provider = await seededProvider();
    const targetRef: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-1' };
    const proposal = await provider.proposeMutation({
      targetRef,
      ops: [{ op: 'updateBlock', blockId: 'doc-1', markdown: '# Rewritten' }],
      summary: 'rewrite doc-1',
    });
    expect(proposal.status).toBe('pending_review');
    expect(proposal.connectionId).toBe('test-connection');
    expect(proposal.diffDocument?.base).toContain('Integrating Craft with SiYuan engine.');
    expect(proposal.diffDocument?.patched).toBe('# Rewritten');
    expect(proposal.hashAlgorithm).toBe('sha256-canonical-v1');
    expect(proposal.baseHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proposal.statusHistory.map((entry) => `${entry.from}->${entry.to}`)).toEqual(['draft->pending_review']);

    const result = await provider.applyMutation(proposal.id);
    expect(result).toMatchObject({ proposalId: proposal.id, applied: true, conflicted: false, status: 'applied' });
    expect((await provider.get(targetRef)).markdown).toBe('# Rewritten');
  });

  test('hash race: second proposal apply reports conflicted with the current hash', async () => {
    const provider = await seededProvider();
    const targetRef: KnowledgeRef = { scheme: 'siyuan', kind: 'document', id: 'doc-2' };
    const first = await provider.proposeMutation({
      targetRef,
      ops: [{ op: 'updateBlock', blockId: 'doc-2', markdown: 'v2' }],
      summary: 'first',
    });
    const second = await provider.proposeMutation({
      targetRef,
      ops: [{ op: 'updateBlock', blockId: 'doc-2', markdown: 'v3' }],
      summary: 'second',
    });
    expect((await provider.applyMutation(first.id)).applied).toBe(true);
    const conflicted = await provider.applyMutation(second.id);
    expect(conflicted.applied).toBe(false);
    expect(conflicted.conflicted).toBe(true);
    expect(conflicted.status).toBe('conflict');
    expect(conflicted.reason).toBe('hash-mismatch');
    expect(conflicted.currentHash).toBe(await hashKnowledgeContent('v2'));
  });

  test('appendBlock creates a child under the target document', async () => {
    const provider = await seededProvider();
    const proposal = await provider.proposeMutation({
      targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
      ops: [{ op: 'appendBlock', documentId: 'doc-1', markdown: 'Appended paragraph.' }],
      summary: 'append to doc-1',
    });
    expect(proposal.diffDocument?.patched).toContain('Appended paragraph.');
    const result = await provider.applyMutation(proposal.id);
    expect(result.applied).toBe(true);
    expect(result.createdRef?.kind).toBe('block');

    const context = await provider.getContext({ scheme: 'siyuan', kind: 'document', id: 'doc-1' }, 'snapshot');
    expect(context.children).toHaveLength(2);
    expect(context.children.map((child) => child.blockId)).toContain(result.createdRef!.id);
  });

  test('createDocument targets the notebook (wire contract); apply returns createdRef and the doc is searchable', async () => {
    const provider = await seededProvider();
    const proposal = await provider.proposeMutation({
      targetRef: { scheme: 'siyuan', kind: 'notebook', id: 'nb-1' },
      ops: [{ op: 'createDocument', notebook: 'nb-1', path: '/Research/New Doc', title: 'New Doc', markdown: 'hello kernel' }],
      summary: 'new doc',
    });
    expect(proposal.targetRef.kind).toBe('document');
    const { createdRef, applied } = await provider.applyMutation(proposal.id);
    expect(applied).toBe(true);
    expect(createdRef).toBeDefined();
    expect((await provider.get(createdRef!)).title).toBe('New Doc');
    expect((await provider.search({ query: 'hello kernel' })).items.map((hit) => hit.ref.id)).toContain(createdRef!.id);
  });

  test('createDocument against a missing notebook → typed NOT_FOUND', async () => {
    const provider = await seededProvider();
    const error = await catchKnowledgeError(() =>
      provider.proposeMutation({
        targetRef: { scheme: 'siyuan', kind: 'notebook', id: 'ghost' },
        ops: [{ op: 'createDocument', notebook: 'ghost', path: '/x', title: 'x', markdown: '' }],
        summary: 'x',
      }),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  test('setAttribute updates the node attribute', async () => {
    const provider = await seededProvider();
    const proposal = await provider.proposeMutation({
      targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-2' },
      ops: [{ op: 'setAttribute', blockId: 'doc-2', name: 'status', value: 'final' }],
      summary: 'finalize doc-2',
    });
    await provider.applyMutation(proposal.id);
    const node = await provider.get({ scheme: 'siyuan', kind: 'document', id: 'doc-2' });
    expect(node.attributes).toContainEqual({ key: 'status', value: 'final' });
  });

  test('missing targetRef → INVALID_REF; op/target mismatch → INVALID_REF', async () => {
    const provider = await seededProvider();
    const noTarget = await catchKnowledgeError(() =>
      // targetRef is wire-REQUIRED (canonical contract); cast probes the provider's defense-in-depth guard.
      provider.proposeMutation({ ops: [{ op: 'updateBlock', blockId: 'doc-1', markdown: 'x' }], summary: 'x' } as Parameters<typeof provider.proposeMutation>[0]),
    );
    expect(noTarget.code).toBe('INVALID_REF');

    const mismatch = await catchKnowledgeError(() =>
      provider.proposeMutation({
        targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
        ops: [{ op: 'updateBlock', blockId: 'doc-2', markdown: 'x' }],
        summary: 'x',
      }),
    );
    expect(mismatch.code).toBe('INVALID_REF');
  });

  test('applying an unknown or already-applied proposal → typed error', async () => {
    const provider = await seededProvider();
    const unknown = await catchKnowledgeError(() => provider.applyMutation('nope'));
    expect(unknown.code).toBe('NOT_FOUND');

    const proposal = await provider.proposeMutation({
      targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
      ops: [{ op: 'updateBlock', blockId: 'doc-1', markdown: 'once' }],
      summary: 'once',
    });
    expect((await provider.applyMutation(proposal.id)).applied).toBe(true);
    const twice = await catchKnowledgeError(() => provider.applyMutation(proposal.id));
    expect(twice.code).toBe('PROVIDER_ERROR');
  });

  test('multi-op proposal rejected when transactions capability is off', async () => {
    const provider = await seededProvider();
    const error = await catchKnowledgeError(() =>
      provider.proposeMutation({
        targetRef: { scheme: 'siyuan', kind: 'document', id: 'doc-1' },
        ops: [
          { op: 'updateBlock', blockId: 'doc-1', markdown: 'a' },
          { op: 'appendBlock', documentId: 'doc-1', markdown: 'b' },
        ],
        summary: 'two ops',
      }),
    );
    expect(error.code).toBe('UNSUPPORTED_OPERATION');
  });
});

describe('InMemoryKnowledgeProvider.open', () => {
  test('records the siyuan:// deep link for existing refs', async () => {
    const provider = await seededProvider();
    await provider.open({ scheme: 'siyuan', kind: 'document', id: 'doc-1' });
    expect(provider.openedDeepLinks).toEqual(['siyuan://blocks/doc-1']);
  });

  test('unknown ref → NOT_FOUND; invalid ref → INVALID_REF', async () => {
    const provider = await seededProvider();
    expect((await catchKnowledgeError(() => provider.open({ scheme: 'siyuan', kind: 'document', id: 'ghost' }))).code).toBe(
      'NOT_FOUND',
    );
    expect(
      (await catchKnowledgeError(() => provider.open({ scheme: 'other', kind: 'document', id: 'd' } as unknown as KnowledgeRef)))
        .code,
    ).toBe('INVALID_REF');
  });
});

describe('createKnowledgeRegistry with InMemoryKnowledgeProvider', () => {
  const connection = (id: string): KnowledgeConnection => ({
    id,
    provider: 'memory',
    label: `Test ${id}`,
    status: 'connected',
  });

  test('empty registry: no default, resolve throws CONNECTION_UNAVAILABLE', () => {
    const registry = createKnowledgeRegistry();
    expect(registry.defaultProvider()).toBeNull();
    expect(registry.list()).toEqual([]);
    const error = (() => {
      try {
        registry.resolve({ scheme: 'siyuan', kind: 'document', id: 'doc-1' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(KnowledgeError);
    expect((error as KnowledgeError).code).toBe('CONNECTION_UNAVAILABLE');
  });

  test('connect caches by connectionId; resolve honors connectionId, provider, then default', async () => {
    const registry = createKnowledgeRegistry();
    const factory: KnowledgeProviderFactory = (conn) => new InMemoryKnowledgeProvider({ connectionId: conn.id });
    registry.registerProvider('memory', factory);

    const first = await registry.connect(connection('c1'));
    const second = await registry.connect(connection('c2'));

    expect(registry.defaultProvider()).toBe(first); // MVP: first connection is the default
    expect(registry.list().map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(registry.resolve({ scheme: 'siyuan', kind: 'document', id: 'd', connectionId: 'c2' })).toBe(second);
    expect(registry.resolve({ scheme: 'siyuan', kind: 'document', id: 'd', provider: 'memory' })).toBe(first);
    expect(registry.resolve({ scheme: 'siyuan', kind: 'document', id: 'd' })).toBe(first); // falls back to default
  });

  test('connecting an unregistered scheme → typed UNSUPPORTED_OPERATION', async () => {
    const registry = createKnowledgeRegistry();
    const error = await catchKnowledgeError(() => registry.connect({ ...connection('c1'), provider: 'ghost' }));
    expect(error.code).toBe('UNSUPPORTED_OPERATION');
  });
});
