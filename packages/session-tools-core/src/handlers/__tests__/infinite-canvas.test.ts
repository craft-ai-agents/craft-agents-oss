import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleApplyCanvasOps, handleGetCanvasContext } from '../infinite-canvas.ts';
import { CanvasStore } from '../../canvas-store.ts';

describe('infinite canvas session tools', () => {
  let workspacePath: string;
  const context = () => ({ workspacePath, sessionId: 'session-test' }) as any;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'jonwork-infinite-canvas-'));
    mkdirSync(join(workspacePath, 'canvas'));
    writeFileSync(join(workspacePath, 'canvas', 'infinite-canvas-state.json'), JSON.stringify({
      version: 1,
      snapshot: { projectId: 'classic', title: '经典测试画布', nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } },
      updatedAt: '2026-08-28T00:00:00.000Z',
    }));
    new CanvasStore(workspacePath).bindSession('session-test','classic');
  });

  afterEach(() => rmSync(workspacePath, { recursive: true, force: true }));

  test('reads the synchronized snapshot', async () => {
    const result = await handleGetCanvasContext(context(), {});
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content[0] as any).text).snapshot.title).toBe('经典测试画布');
  });

  test('queues native infinite-canvas operations with revisions', async () => {
    const result = await handleApplyCanvasOps(context(), {
      projectId: 'classic',
      summary: '加入经典三节点数据',
      ops: [{ type: 'add_node', id: 'brief', nodeType: 'text', metadata: { content: '品牌简报' } }],
    });
    expect(result.isError).toBeFalsy();
    const queue = JSON.parse(readFileSync(join(workspacePath, 'canvas', 'canvas-store-v2.json'), 'utf8'));
    expect(queue.nextRevision).toBe(2);
    expect(queue.updates[0].ops[0].type).toBe('add_node');
    expect(queue.updates[0].sessionId).toBe('session-test');
  });

  test('unbound sessions never inherit the most recently opened project',async()=>{
    const unbound={workspacePath,sessionId:'unbound-session'} as any;
    expect((await handleGetCanvasContext(unbound,{})).isError).toBe(true);
    expect((await handleApplyCanvasOps(unbound,{projectId:'classic',ops:[]})).isError).toBe(true);
  });

  test('opening another canvas cannot change the bound session context',async()=>{
    new CanvasStore(workspacePath).save({projectId:'other-project',nodes:[],title:'Other secret'});
    const result=await handleGetCanvasContext(context(),{});
    expect(JSON.parse((result.content[0] as any).text).snapshot.projectId).toBe('classic');
    expect((await handleApplyCanvasOps(context(),{projectId:'other-project',ops:[]})).isError).toBe(true);
  });
});
