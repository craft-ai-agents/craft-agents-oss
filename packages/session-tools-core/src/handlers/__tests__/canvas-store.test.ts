import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CanvasStore } from '../../canvas-store'

describe('durable canvas delivery', () => {
  let root: string
  let store: CanvasStore
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'jonwork-canvas-delivery-'))
    store = new CanvasStore(root)
    await store.save({ projectId: 'p1', nodes: [] })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const op = () => [{ type: 'select_nodes', ids: [] }]

  test('preserves project snapshots and never claims another project', async () => {
    await store.enqueue('s', op(), undefined, 'p1')
    await store.save({ projectId: 'p2', nodes: [{ id: 'n2' }] })
    expect((await store.claim('p2')).update).toBeNull()
    expect(store.state('p1').state?.snapshot.nodes).toEqual([])
    expect((await store.claim('p1')).update?.projectId).toBe('p1')
  })

  test('atomically records successful output, validates tokens, and acknowledges idempotently', async () => {
    const job = await store.enqueue('s', op())
    const { update } = await store.claim('p1')
    await expect(store.settle(job.revision, 'wrong', 'p1', { projectId: 'p1', nodes: [] })).rejects.toThrow('不匹配')
    await expect(store.settle(job.revision, update!.deliveryToken!, 'p2', { projectId: 'p2', nodes: [] })).rejects.toThrow('不匹配')
    await expect(store.settle(job.revision, update!.deliveryToken!, 'p1')).rejects.toThrow('快照')
    await store.settle(job.revision, update!.deliveryToken!, 'p1', { projectId: 'p1', nodes: [{ id: 'done' }] })
    const reopened = new CanvasStore(root)
    expect(reopened.state('p1').state?.snapshot.nodes).toEqual([{ id: 'done' }])
    expect(reopened.state().pendingUpdates).toHaveLength(0)
    await reopened.settle(job.revision, update!.deliveryToken!, 'p1')
  })

  test('retains failures and only permits safe explicit retries', async () => {
    const job = await store.enqueue('s', [{ type: 'run_generation', id: 'n' }])
    const { update } = await store.claim('p1')
    await store.settle(job.revision, update!.deliveryToken!, 'p1', undefined, 'provider failed')
    expect((await store.claim('p1')).blocked?.status).toBe('failed')
    await expect(store.retry(job.revision, 'p1')).rejects.toThrow('不能直接重试')
    await store.dismiss(job.revision, 'p1')
    expect(JSON.parse(readFileSync(store.path, 'utf8')).updates[0].status).toBe('dismissed')
    const safe = await store.enqueue('s', op())
    const claimed = (await store.claim('p1')).update!
    await store.settle(safe.revision, claimed.deliveryToken!, 'p1', undefined, 'failed')
    await store.retry(safe.revision, 'p1')
    expect((await store.claim('p1')).update?.attempt).toBe(2)
  })

  test('restart/timeout becomes uncertain, never redelivers generation, accepts late valid ack', async () => {
    await store.enqueue('s', [{ type: 'run_generation' }])
    const first = (await store.claim('p1', 1000)).update!
    const reopened = new CanvasStore(root)
    expect((await reopened.claim('p1', 32_000)).blocked?.status).toBe('uncertain')
    expect((await reopened.claim('p1', 100_000)).update).toBeNull()
    await reopened.settle(first.revision, first.deliveryToken!, 'p1', { projectId: 'p1', nodes: [] })
    expect(reopened.state().pendingUpdates).toHaveLength(0)
  })

  test('concurrent producers preserve every revision and claims are exclusive', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => new CanvasStore(root).enqueue(`s${i}`, op())))
    expect(new Set(store.state().pendingUpdates.map(entry => entry.revision)).size).toBe(20)
    const claims = await Promise.all([new CanvasStore(root).claim('p1'), new CanvasStore(root).claim('p1')])
    expect(claims.filter(result => result.update)).toHaveLength(1)
  })

  test('corrupt data is not overwritten or reset', async () => {
    writeFileSync(store.path, '{corrupt')
    await expect(store.save({ projectId: 'p1', nodes: [] })).rejects.toThrow('损坏')
    expect(readFileSync(store.path, 'utf8')).toBe('{corrupt')
  })

  test('independent agent processes do not lose queued operations', async () => {
    const workers = Array.from({ length: 4 }, (_, i) => Bun.spawn([process.execPath, join(import.meta.dir, 'canvas-store-worker.fixture.ts'), root, `worker-${i}`], { stdout: 'pipe', stderr: 'pipe' }))
    const exits = await Promise.all(workers.map(worker => worker.exited))
    expect(exits).toEqual([0, 0, 0, 0])
    const updates = new CanvasStore(root).state().pendingUpdates
    expect(updates).toHaveLength(4)
    expect(new Set(updates.map(entry => entry.sessionId)).size).toBe(4)
  })

  test('legacy input is retained and ambiguous jobs require review', async () => {
    const oldRoot = join(root, 'legacy')
    mkdirSync(join(oldRoot, 'canvas'), { recursive: true })
    const legacyState = join(oldRoot, 'canvas', 'infinite-canvas-state.json')
    writeFileSync(legacyState, JSON.stringify({ version: 1, snapshot: { projectId: 'old', nodes: [] } }))
    writeFileSync(join(oldRoot, 'canvas', 'infinite-canvas-updates.json'), JSON.stringify({ updates: [{ id: 'legacy', revision: 5, ops: op() }] }))
    const migrated = new CanvasStore(oldRoot)
    expect((await migrated.claim('old')).blocked?.status).toBe('uncertain')
    expect(JSON.parse(readFileSync(legacyState, 'utf8')).version).toBe(1)
  })

  test('rejects unsafe identities and oversized operation batches', async () => {
    expect(() => store.save({ projectId: '__proto__', nodes: [] })).toThrow()
    expect(store.state('toString').state).toBeNull()
    await expect(store.enqueue('s', op(), undefined, 'toString')).rejects.toThrow('尚未同步')
    expect(() => store.enqueue('s', Array.from({ length: 101 }, () => op()[0]!))).toThrow()
  })
})
