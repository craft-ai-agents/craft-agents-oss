/**
 * P3 mutation tests for the SiYuan slice (spec 05-mutation-safety.md §3.4/§3.8).
 *
 * Conventions mirror adapter.test.ts: the REAL SiyuanKernelClient runs over an injected
 * fetchImpl (constructor seam) — no mock.module, no globalThis.fetch overrides, so these
 * files stay safe in bun's single-process multi-file runs.
 */

import { describe, expect, test } from 'bun:test';

import { KnowledgeError, type KnowledgeErrorCode } from '../../../errors.ts';
import { INSERTED_BLOCK_ID_REF, PartialApplyError } from '../../../mutations.ts';
import type { MutationOp } from '../../../provider.ts';
import { SiyuanKernelClient } from '../client.ts';
import { executeMutationOps, kernelAttrName } from '../mutation-adapter.ts';

// ---------------------------------------------------------------------------
// Injected fetch harness (verbatim convention from adapter.test.ts)

type HandlerResult = { data?: unknown; code?: number; msg?: string; httpStatus?: number };
type Handler = (body: Record<string, unknown>) => HandlerResult;

interface FetchCall {
  endpoint: string;
  body: Record<string, unknown>;
  init: RequestInit;
}

function makeClient(handlers: Record<string, Handler>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ endpoint, body, init: init as RequestInit });
    const handler = handlers[endpoint];
    if (!handler) throw new Error(`unmocked kernel endpoint: ${endpoint}`);
    const result = handler(body);
    if (result.httpStatus !== undefined) {
      return new Response('', { status: result.httpStatus });
    }
    return new Response(JSON.stringify({ code: result.code ?? 0, msg: result.msg ?? '', data: result.data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new SiyuanKernelClient({ baseUrl: 'http://127.0.0.1:6806', token: 'tok', fetchImpl });
  return { client, calls };
}

const callsFor = (calls: FetchCall[], endpoint: string) => calls.filter((call) => call.endpoint === endpoint);

// ---------------------------------------------------------------------------
// Kernel response fixtures (verbatim docs/API.zh-CN.md @ eef1056838 response shapes)

const APPEND_TX = [
  {
    doOperations: [
      {
        action: 'insert',
        data: '<div data-node-id="blk-new-1" data-type="NodeParagraph" class="p">…</div>',
        id: 'blk-new-1',
        parentID: 'doc-1',
        previousID: 'blk-prev-1',
        retData: null,
      },
    ],
    undoOperations: null,
  },
];

const UPDATE_TX = [
  {
    doOperations: [
      {
        action: 'update',
        data: '<div data-node-id="blk-1" data-type="NodeParagraph" class="p">…</div>',
        id: 'blk-1',
        parentID: '',
        previousID: '',
        retData: null,
      },
    ],
    undoOperations: null,
  },
];

const CREATE_OP: MutationOp = { op: 'createDocument', notebook: 'nb-1', path: '/Inbox/Note', title: 'Note', markdown: '# Hi' };
const APPEND_OP: MutationOp = { op: 'appendBlock', documentId: 'doc-1', markdown: 'appended paragraph' };
const UPDATE_OP: MutationOp = { op: 'updateBlock', blockId: 'blk-1', markdown: 'replacement' };
const SET_ATTR_OP: MutationOp = { op: 'setAttribute', blockId: 'blk-1', name: 'craft-domain', value: 'knowledge' };

// ---------------------------------------------------------------------------

describe('executeMutationOps — happy path per op (endpoint + payload parity with docs/API.zh-CN.md)', () => {
  test('createDocument → /api/filetree/createDocWithMd {notebook,path,markdown} → doc id', async () => {
    const { client, calls } = makeClient({ '/api/filetree/createDocWithMd': () => ({ data: 'doc-created-1' }) });
    const result = await executeMutationOps(client, [CREATE_OP]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.endpoint).toBe('/api/filetree/createDocWithMd');
    expect(calls[0]!.body).toEqual({ notebook: 'nb-1', path: '/Inbox/Note', markdown: '# Hi' });
    expect(result.appliedOps).toEqual([CREATE_OP]);
    expect(result.createdIds).toEqual({ documentIds: ['doc-created-1'], blockIds: [] });
  });

  test('appendBlock → /api/block/appendBlock {dataType:"markdown",data,parentID} → created block id', async () => {
    const { client, calls } = makeClient({ '/api/block/appendBlock': () => ({ data: APPEND_TX }) });
    const result = await executeMutationOps(client, [APPEND_OP]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.endpoint).toBe('/api/block/appendBlock');
    expect(calls[0]!.body).toEqual({ dataType: 'markdown', data: 'appended paragraph', parentID: 'doc-1' });
    expect(result.createdIds).toEqual({ documentIds: [], blockIds: ['blk-new-1'] });
  });

  test('updateBlock → /api/block/updateBlock {dataType:"markdown",data,id}', async () => {
    const { client, calls } = makeClient({ '/api/block/updateBlock': () => ({ data: UPDATE_TX }) });
    const result = await executeMutationOps(client, [UPDATE_OP]);

    expect(calls[0]!.body).toEqual({ dataType: 'markdown', data: 'replacement', id: 'blk-1' });
    expect(result.createdIds).toEqual({ documentIds: [], blockIds: [] });
  });

  test('setAttribute → /api/attr/setBlockAttrs {id,attrs} with custom- kernel key mapping', async () => {
    const { client, calls } = makeClient({ '/api/attr/setBlockAttrs': () => ({ data: null }) });
    await executeMutationOps(client, [SET_ATTR_OP]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.endpoint).toBe('/api/attr/setBlockAttrs');
    // Craft-domain 'craft-domain' → kernel IAL 'custom-craft-domain' (read-side strips custom-).
    expect(calls[0]!.body).toEqual({ id: 'blk-1', attrs: { 'custom-craft-domain': 'knowledge' } });
  });

  test('kernelAttrName keeps an already custom- prefixed name (idempotent)', () => {
    expect(kernelAttrName('craft-x')).toBe('custom-craft-x');
    expect(kernelAttrName('custom-craft-x')).toBe('custom-craft-x');
  });

  test('ops execute strictly sequentially in input order', async () => {
    const { client, calls } = makeClient({
      '/api/filetree/createDocWithMd': () => ({ data: 'doc-created-1' }),
      '/api/block/appendBlock': () => ({ data: APPEND_TX }),
      '/api/block/updateBlock': () => ({ data: UPDATE_TX }),
    });
    const ops = [CREATE_OP, APPEND_OP, UPDATE_OP];
    const result = await executeMutationOps(client, ops);

    expect(calls.map((call) => call.endpoint)).toEqual([
      '/api/filetree/createDocWithMd',
      '/api/block/appendBlock',
      '/api/block/updateBlock',
    ]);
    expect(result.appliedOps).toEqual(ops);
    expect(result.createdIds).toEqual({ documentIds: ['doc-created-1'], blockIds: ['blk-new-1'] });
    // §3.8 per-index capture map: $insertedBlockId[N] placeholders key on the ORIGINAL op index.
    expect(result.createdIdsByOpIndex).toEqual({ 0: 'doc-created-1', 1: 'blk-new-1' });
  });

  test('createdIdsByOpIndex keys TWO creation ops to their own indices (not one shared id)', async () => {
    const { client } = makeClient({
      '/api/filetree/createDocWithMd': (() => {
        let n = 0;
        return () => ({ data: `doc-created-${++n}` });
      })(),
      '/api/block/appendBlock': () => ({ data: APPEND_TX }),
    });
    const result = await executeMutationOps(client, [CREATE_OP, APPEND_OP, { ...CREATE_OP, path: '/Inbox/Second', title: 'Second' }]);
    expect(result.createdIds.documentIds).toEqual(['doc-created-1', 'doc-created-2']);
    expect(result.createdIdsByOpIndex).toEqual({ 0: 'doc-created-1', 1: 'blk-new-1', 2: 'doc-created-2' });
  });
});

// ---------------------------------------------------------------------------

describe('executeMutationOps — partial apply compensation (§3.8 soft rollback)', () => {
  const failSecondUpdate: Handler = (() => {
    let updateCalls = 0;
    return () => {
      updateCalls += 1;
      return updateCalls === 1 ? { httpStatus: 500 } : { data: UPDATE_TX };
    };
  })();

  test('op 2 of 3 fails → op 1 compensated best-effort, PartialApplyError carries audit fields', async () => {
    const { client, calls } = makeClient({
      '/api/block/appendBlock': () => ({ data: APPEND_TX }),
      '/api/block/updateBlock': failSecondUpdate,
      '/api/attr/setBlockAttrs': () => ({ data: null }),
    });
    const ops = [APPEND_OP, UPDATE_OP, SET_ATTR_OP];
    // Bridge-T3-style inverse: tombstone the appended block (placeholder id substituted at runtime).
    const inverseOps: MutationOp[] = [
      { op: 'updateBlock', blockId: `${INSERTED_BLOCK_ID_REF}[0]`, markdown: '> _откачено Craft 2026-08-07T00:00:00Z_' },
      { op: 'setAttribute', blockId: `${INSERTED_BLOCK_ID_REF}[0]`, name: 'craft-rolled-back', value: 'true' },
    ];

    let caught: unknown;
    try {
      await executeMutationOps(client, ops, { inverseOps });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PartialApplyError);
    const error = caught as PartialApplyError;
    expect(error.failedOpIndex).toBe(1);
    expect(Array.isArray(error.compensatedOps)).toBe(true);

    const updates = callsFor(calls, '/api/block/updateBlock');
    // call 1 = failed forward op on blk-1; afterwards compensation ran on the REAL created id.
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates[0]!.body).toMatchObject({ id: 'blk-1' });
    const tombstone = updates.find((call) => call.body['id'] === 'blk-new-1');
    expect(tombstone?.body['data']).toContain('откачено Craft');
    const rollbackAttr = callsFor(calls, '/api/attr/setBlockAttrs').find((call) => call.body['id'] === 'blk-new-1');
    expect(rollbackAttr?.body['attrs']).toEqual({ 'custom-craft-rolled-back': 'true' });
  });

  test('failed compensation never masks the original failure (best-effort)', async () => {
    const { client } = makeClient({
      '/api/block/appendBlock': () => ({ data: APPEND_TX }),
      '/api/block/updateBlock': () => ({ httpStatus: 500 }), // forward op 2 AND tombstone both fail
    });
    const ops = [APPEND_OP, UPDATE_OP];

    let caught: unknown;
    try {
      await executeMutationOps(client, ops, {
        inverseOps: [{ op: 'updateBlock', blockId: 'blk-new-1', markdown: 'tombstone' }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PartialApplyError);
    expect((caught as PartialApplyError).failedOpIndex).toBe(1);
    expect((caught as PartialApplyError).compensatedOps).toEqual([]);
    expect((caught as PartialApplyError).cause).toBeInstanceOf(KnowledgeError);
  });

  test('op 1 (first) failing is rethrown untouched — nothing applied, no compensation', async () => {
    const { client, calls } = makeClient({
      '/api/block/appendBlock': () => ({ code: -1, msg: 'parent not found' }),
      '/api/block/updateBlock': () => ({ data: UPDATE_TX }),
    });

    let caught: unknown;
    try {
      await executeMutationOps(client, [APPEND_OP, UPDATE_OP], {
        inverseOps: [{ op: 'updateBlock', blockId: 'blk-new-1', markdown: 'tombstone' }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(KnowledgeError);
    expect(caught).not.toBeInstanceOf(PartialApplyError);
    expect((caught as KnowledgeError).code).toBe('PROVIDER_ERROR');
    expect(calls).toHaveLength(1); // zero compensation traffic
  });
});

// ---------------------------------------------------------------------------

describe('client write endpoints — error mapping matches read methods', () => {
  test('HTTP 401 on a write endpoint → PROVIDER_ERROR naming the token (needs_auth surface)', async () => {
    const { client } = makeClient({ '/api/block/updateBlock': () => ({ httpStatus: 401 }) });
    let caught: unknown;
    try {
      await executeMutationOps(client, [UPDATE_OP]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(KnowledgeError);
    const error = caught as KnowledgeError;
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.message).toContain('token');
    expect((error.details as { httpStatus: number }).httpStatus).toBe(401);
  });

  test('appendBlock without a created id in the envelope → typed PROVIDER_ERROR', async () => {
    for (const data of [[], [{ doOperations: [] }], null]) {
      const { client, calls } = makeClient({ '/api/block/appendBlock': () => ({ data }) });
      let caught: unknown;
      try {
        await client.appendBlock({ parentID: 'doc-1', data: 'x' });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(KnowledgeError);
      expect((caught as KnowledgeError).message).toContain('no created block id');
      expect(callsFor(calls, '/api/block/appendBlock')).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------

describe('read-only invariant (§3.4.2)', () => {
  test('client exposes exactly the §3.4.1 write methods and NOTHING destructive', () => {
    const methods = Object.getOwnPropertyNames(SiyuanKernelClient.prototype).filter((name) => name !== 'constructor');

    // The complete P3 write surface (client header documents the deliberate absence of the rest).
    for (const writeMethod of ['createDocWithMd', 'appendBlock', 'updateBlock', 'setBlockAttrs']) {
      expect(methods).toContain(writeMethod);
    }
    // No delete/remove/rename/move methods may ever appear (soft-rollback-only design §3.8).
    const destructive = methods.filter((name) => /delete|remove|rename|move/i.test(name));
    expect(destructive).toEqual([]);
    expect(methods).not.toContain('deleteBlock');
    expect(methods).not.toContain('removeDoc');
    expect(methods).not.toContain('createNotebook');
  });
});

// ---------------------------------------------------------------------------

describe('sql() SELECT-only guard (§3.4.2 — throw before any network I/O)', () => {
  const SELECT_ENDPOINT = '/api/query/sql';

  test('SELECT passes through with mode: readonly', async () => {
    const { client, calls } = makeClient({ [SELECT_ENDPOINT]: () => ({ data: [{ id: 'blk-1' }] }) });
    const rows = await client.sql('SELECT * FROM blocks WHERE id = \'blk-1\'');
    expect(rows).toEqual([{ id: 'blk-1' }]);
    const sqlCalls = callsFor(calls, SELECT_ENDPOINT);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]!.body).toEqual({ stmt: 'SELECT * FROM blocks WHERE id = \'blk-1\'', mode: 'readonly' });
  });

  test('lowercase select with leading whitespace passes', async () => {
    const { client, calls } = makeClient({ [SELECT_ENDPOINT]: () => ({ data: [] }) });
    await client.sql('  select id from blocks');
    expect(callsFor(calls, SELECT_ENDPOINT)).toHaveLength(1);
  });

  test.each([
    "UPDATE blocks SET content = 'x'",
    "INSERT INTO blocks (id) VALUES ('x')",
    'DELETE FROM blocks',
    'DROP TABLE blocks',
    "WITH x AS (SELECT 1) SELECT * FROM x",
  ])('non-SELECT %s throws reason sql-not-select before the network', async (stmt) => {
    const { client, calls } = makeClient({ [SELECT_ENDPOINT]: () => ({ data: [] }) });
    let caught: unknown;
    try {
      await client.sql(stmt);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { reason?: string }).reason).toBe('sql-not-select');
    expect(callsFor(calls, SELECT_ENDPOINT)).toHaveLength(0); // threw BEFORE any fetch
  });
});

// ---------------------------------------------------------------------------

describe('plugin/petal soft endpoints (bridge feed)', () => {
  test('getInstalledPlugin normalizes array and packages wrapper', async () => {
    {
      const { client, calls } = makeClient({
        '/api/bazaar/getInstalledPlugin': () => ({
          data: [{ name: 'p1', version: '1.0.0' }, { nope: true }, null],
        }),
      });
      const pkgs = await client.getInstalledPlugin('desktop');
      expect(pkgs).toEqual([{ name: 'p1', version: '1.0.0' }]);
      expect(callsFor(calls, '/api/bazaar/getInstalledPlugin')[0]!.body).toEqual({ frontend: 'desktop' });
    }
    {
      const { client } = makeClient({
        '/api/bazaar/getInstalledPlugin': () => ({
          data: { packages: [{ name: 'wrapped', version: '2' }] },
        }),
      });
      await expect(client.getInstalledPlugin()).resolves.toEqual([{ name: 'wrapped', version: '2' }]);
    }
  });

  test('loadPetals normalizes array and map forms', async () => {
    {
      const { client, calls } = makeClient({
        '/api/petal/loadPetals': () => ({
          data: [
            { name: 'a', enabled: false, version: '1' },
            { name: 'b' },
          ],
        }),
      });
      const petals = await client.loadPetals('desktop');
      expect(petals).toEqual([
        { name: 'a', enabled: false, version: '1' },
        { name: 'b', enabled: true },
      ]);
      expect(callsFor(calls, '/api/petal/loadPetals')[0]!.body).toEqual({ frontend: 'desktop' });
    }
    {
      const { client } = makeClient({
        '/api/petal/loadPetals': () => ({
          data: { x: true, y: { enabled: false } },
        }),
      });
      await expect(client.loadPetals()).resolves.toEqual([
        { name: 'x', enabled: true },
        { name: 'y', enabled: false },
      ]);
    }
  });

  test('setPetalEnabled posts packageName + enabled', async () => {
    const { client, calls } = makeClient({
      '/api/petal/setPetalEnabled': () => ({ data: null }),
    });
    await client.setPetalEnabled('my-plugin', false);
    expect(callsFor(calls, '/api/petal/setPetalEnabled')[0]!.body).toEqual({
      packageName: 'my-plugin',
      enabled: false,
    });
  });

  test('soft petal methods are present and still no destructive knowledge writes', () => {
    const methods = Object.getOwnPropertyNames(SiyuanKernelClient.prototype).filter((name) => name !== 'constructor');
    expect(methods).toContain('getInstalledPlugin');
    expect(methods).toContain('getBazaarPlugin');
    expect(methods).toContain('installBazaarPlugin');
    expect(methods).toContain('uninstallBazaarPlugin');
    expect(methods).toContain('loadPetals');
    expect(methods).toContain('setPetalEnabled');
    const destructive = methods.filter((name) => /delete|remove|rename|move/i.test(name));
    expect(destructive).toEqual([]);
  });

  test('getBazaarPlugin normalizes array and packages wrapper', async () => {
    {
      const { client, calls } = makeClient({
        '/api/bazaar/getBazaarPlugin': () => ({
          data: {
            packages: [
              { name: 'remote-a', version: '1.2.3', author: 'alice', installed: false },
              { nope: true },
              null,
            ],
          },
        }),
      });
      const pkgs = await client.getBazaarPlugin('desktop', 'note');
      expect(pkgs).toEqual([
        { name: 'remote-a', version: '1.2.3', author: 'alice', installed: false },
      ]);
      expect(callsFor(calls, '/api/bazaar/getBazaarPlugin')[0]!.body).toEqual({
        frontend: 'desktop',
        keyword: 'note',
      });
    }
    {
      const { client } = makeClient({
        '/api/bazaar/getBazaarPlugin': () => ({
          data: [{ name: 'bare', version: '9' }],
        }),
      });
      await expect(client.getBazaarPlugin()).resolves.toEqual([{ name: 'bare', version: '9' }]);
    }
  });

  test('installBazaarPlugin posts kernel install body (no Craft-side download)', async () => {
    const { client, calls } = makeClient({
      '/api/bazaar/installBazaarPlugin': () => ({ data: null }),
    });
    await client.installBazaarPlugin({
      packageName: 'siyuan-plugin-sample',
      repoURL: 'https://github.com/siyuan-note/plugin-sample',
      repoHash: 'abc123def456',
    });
    expect(callsFor(calls, '/api/bazaar/installBazaarPlugin')[0]!.body).toEqual({
      frontend: 'desktop',
      repoURL: 'https://github.com/siyuan-note/plugin-sample',
      repoHash: 'abc123def456',
      packageName: 'siyuan-plugin-sample',
    });
  });

  test('uninstallBazaarPlugin posts packageName', async () => {
    const { client, calls } = makeClient({
      '/api/bazaar/uninstallBazaarPlugin': () => ({ data: null }),
    });
    await client.uninstallBazaarPlugin({ packageName: 'siyuan-plugin-sample' });
    expect(callsFor(calls, '/api/bazaar/uninstallBazaarPlugin')[0]!.body).toEqual({
      packageName: 'siyuan-plugin-sample',
    });
  });
});
