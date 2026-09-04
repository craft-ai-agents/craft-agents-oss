import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { CanvasStore } from '@craft-agent/session-tools-core/canvas-store'
import { advanceCanvasModel, type CanvasModelBilling } from '../canvas-model'
import { ControlLedger } from '../control-ledger'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe test cleanup')
  rmSync(root, { recursive: true, force: true })
} })
async function fixture(credits = 10) {
  const root = mkdtempSync(join(tmpdir(), 'canvas-billing-')); roots.push(root)
  const store = new CanvasStore(root), ledger = new ControlLedger(join(root, 'ledger'))
  ledger.ensure('account', 'member'); if (credits) ledger.grant('account', 'grant', credits)
  await store.save({ projectId: 'project', nodes: [] })
  await store.enqueue('session', [{ type: 'run_model_generation', inputIds: ['image'] }], '3D test', 'project')
  const entry = (await store.claim('project')).update!
  const billing: CanvasModelBilling = {
    authorize: async () => {},
    reserve: async () => { ledger.reserve('account', 'canvas-task', 'meshy/image-to-3d', 2, 1) },
    check: async () => { if (!ledger.task('account', 'canvas-task')) throw Error('Missing reservation') },
    finish: async status => { ledger.finish('account', 'canvas-task', status === 'unknown' ? 0 : 2, status) },
  }
  const args = { revision: entry.revision, deliveryToken: entry.deliveryToken!, projectId: 'project',
    image: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1cAAAAASUVORK5CYII=' } }
  return { store, ledger, billing, args }
}
function triangle() {
  const json = JSON.stringify({ asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteLength:36}],
    accessors:[{bufferView:0,type:'VEC3',componentType:5126,count:3}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}] })
  const length = Math.ceil(Buffer.byteLength(json) / 4) * 4
  const buffer = Buffer.alloc(12 + 8 + length + 8 + 36)
  buffer.write('glTF');buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(buffer.length,8)
  buffer.writeUInt32LE(length,12);buffer.writeUInt32LE(0x4e4f534a,16)
  buffer.fill(32,20,20+length);buffer.write(json,20)
  buffer.writeUInt32LE(36,20+length);buffer.writeUInt32LE(0x004e4942,24+length)
  buffer.writeFloatLE(1,28+length+12);buffer.writeFloatLE(1,28+length+28)
  return buffer
}

test('3D reserves before provider POST, polls without another debit, settles and downloads without provider credentials', async () => {
  const f = await fixture(); let posts=0, polls=0
  const fetcher = (async (url: any, init: RequestInit) => {
    if (init.method === 'POST') {
      posts++;expect(f.ledger.balance('account').reserved).toBe(2)
      return Response.json({result:'provider-task'})
    }
    if (String(url).startsWith('https://assets.meshy.ai/')) {
      expect(init.headers).toBeUndefined();return new Response(triangle())
    }
    return ++polls === 1 ? Response.json({status:'IN_PROGRESS',progress:30})
      : Response.json({status:'SUCCEEDED',model_urls:{glb:'https://assets.meshy.ai/model.glb'}})
  }) as typeof fetch
  const step = () => advanceCanvasModel(f.store,f.args,fetcher,'test-key',f.billing)
  expect((await step()).status).toBe('pending')
  expect((await step()).status).toBe('pending')
  expect((await step()).status).toBe('completed')
  expect((await step()).status).toBe('completed')
  expect(posts).toBe(1)
  expect(f.ledger.balance('account')).toMatchObject({available:8,reserved:0,sequence:3})
})

test('ambiguous provider creation retains credits and cannot submit a second POST', async () => {
  const f=await fixture();let posts=0
  const fetcher=(async()=>{posts++;throw Error('network loss')}) as unknown as typeof fetch
  await expect(advanceCanvasModel(f.store,f.args,fetcher,'test-key',f.billing)).rejects.toThrow('未知')
  await expect(advanceCanvasModel(f.store,f.args,fetcher,'test-key',f.billing)).rejects.toThrow('不会重复')
  expect(posts).toBe(1)
  expect(f.ledger.task('account','canvas-task')?.status).toBe('unknown')
  expect(f.ledger.balance('account')).toMatchObject({available:8,reserved:2})
})

test('insufficient credit and revoked policy never reach the provider', async () => {
  for (const revoked of [false,true]) {
    const f=await fixture(0);let calls=0
    if(revoked) f.billing.authorize=async()=>{throw Error('disabled')}
    await expect(advanceCanvasModel(f.store,f.args,(async()=>{calls++;return Response.json({})}) as unknown as typeof fetch,'test-key',f.billing)).rejects.toThrow()
    expect(calls).toBe(0);expect(f.ledger.balance('account').reserved).toBe(0)
  }
})

test('3D credit rejection before dispatch can resume the same task after recharge', async () => {
  const f = await fixture(0); let posts = 0
  const fetcher = (async (_url: unknown, init: RequestInit) => {
    if (init.method === 'POST') { posts++; return Response.json({ result: 'recharged-task' }) }
    return Response.json({ status: 'IN_PROGRESS', progress: 10 })
  }) as typeof fetch
  await expect(advanceCanvasModel(f.store, f.args, fetcher, 'test-key', f.billing)).rejects.toThrow()
  expect(posts).toBe(0)
  f.ledger.grant('account', 'approved-test-recharge', 10)
  expect((await advanceCanvasModel(f.store, f.args, fetcher, 'test-key', f.billing)).status).toBe('pending')
  expect((await advanceCanvasModel(f.store, f.args, fetcher, 'test-key', f.billing)).status).toBe('pending')
  expect(posts).toBe(1)
  expect(f.ledger.balance('account')).toMatchObject({ available: 8, reserved: 2 })
})
