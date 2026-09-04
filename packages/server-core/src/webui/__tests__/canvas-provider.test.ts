import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { CanvasStore } from '@craft-agent/session-tools-core/canvas-store'
import { CANVAS_WORKFLOWS, planCanvasWorkflow } from '@craft-agent/session-tools-core/canvas-workflows'
import { advanceCanvasProvider, readCanvasProviderArtifacts, type CanvasProviderConfig } from '../canvas-provider'
import { ControlLedger } from '../control-ledger'
import { publishCanvasDeliverables } from '../canvas-deliverables'
import { canvasBusinessArtifacts } from '../canvas-business-result'
import type { CanvasModelBilling } from '../canvas-model'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1cAAAAASUVORK5CYII='
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw Error('Unsafe test cleanup')
  rmSync(root, { recursive: true, force: true })
} })
async function fixture(id: string, credits = 100) {
  const root = mkdtempSync(join(tmpdir(), 'canvas-provider-audit-')); roots.push(root)
  const store = new CanvasStore(root), ledger = new ControlLedger(join(root, 'ledger'))
  ledger.ensure('a', 'member'); if (credits) ledger.grant('a', 'grant', credits)
  const workflow = CANVAS_WORKFLOWS.find(item => item.id === id)!
  const images = Array.from({ length: workflow.min }, (_, i) => ({ nodeId: `input-${i}`, mimeType: 'image/png', base64: png }))
  const snapshot = { projectId: 'new-business-project', nodes: images.map(image => ({ id: image.nodeId, type: 'image', metadata: { storageKey: image.nodeId, content: 'uploaded', status: 'success', naturalWidth: 1, naturalHeight: 1 } })) }
  const plan = planCanvasWorkflow(snapshot, { id, inputIds: images.map(image => image.nodeId), requirements: '合成验收材料，验证服务端业务执行协议，不代表设计质量通过', count: workflow.series ? 10 : 1, briefConfirmed: true, materialsNote: '合成材料；没有真实访谈和市场资料，只允许待验证假设', identityRules: '相同的圆角与白色外壳', seriesPlan: Array.from({ length: 10 }, (_, i) => `不同用途产品${i + 1}`), ...(workflow.mask ? { maskDataUrl: `data:image/png;base64,${png}` } : {}) }, 'provider-audit-request')
  await store.save(snapshot); await store.bindSession('session', snapshot.projectId)
  await store.enqueue('session', plan.ops, plan.summary, snapshot.projectId)
  const entry = (await store.claim(snapshot.projectId)).update!
  const billing = (nodeId: string): CanvasModelBilling => ({ authorize: async () => {}, reserve: async () => { ledger.reserve('a', nodeId, 'test-model', 2, 1) }, check: async () => { if (!ledger.task('a', nodeId)) throw Error('missing reserve') }, finish: async status => { ledger.finish('a', nodeId, status === 'unknown' ? 0 : 2, status) } })
  const args = (nodeId: string) => ({ revision: entry.revision, deliveryToken: entry.deliveryToken!, projectId: entry.projectId, nodeId, images })
  return { root, store, ledger, entry, args, billing, snapshot }
}
const config: CanvasProviderConfig = { model: 'test-model', key: 'synthetic-test-key', baseUrl: 'https://provider.invalid/v1' }

// An actual loopback HTTP server validates multipart/JSON and ledger ordering.
// This explicitly is not a live paid provider or a visual business acceptance.
for (const workflow of CANVAS_WORKFLOWS.filter(item => item.mode !== 'model')) test(`${workflow.name}: HTTP provider → durable result → exactly-once ledger → artifacts`, async () => {
  const f = await fixture(workflow.id); let posts = 0
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    posts++
    expect(f.ledger.balance('a').reserved).toBe(2)
    expect(request.headers.get('authorization')).toBe('Bearer synthetic-test-key')
    if (workflow.mode === 'text') {
      expect(new URL(request.url).pathname).toBe('/v1/chat/completions')
      const body = await request.json() as { tools?: unknown; model: string; messages: Array<{ content: Array<{ type: string; text?: string }> }> }; expect(body.tools).toBeUndefined(); expect(body.model).toBe('test-model')
      expect(body.messages[0].content[0].text).toContain(workflow.name)
      expect(body.messages[0].content.filter((item: { type: string }) => item.type === 'image_url')).toHaveLength(workflow.min)
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: `# ${workflow.name} 待审查草稿\n合成供应商响应，不属于真实业务验收。` } }] })
    }
    expect(new URL(request.url).pathname).toBe('/v1/images/edits')
    const form = await request.formData(); expect(form.getAll('image[]')).toHaveLength(workflow.min)
    expect(form.get('prompt')).toContain(workflow.name)
    expect(Boolean(form.get('mask'))).toBe(Boolean(workflow.mask))
    return Response.json({ data: Array.from({ length: Number(form.get('n')) }, () => ({ b64_json: png })) })
  } })
  try {
    for (const op of f.entry.ops.filter(op => op.type === 'run_generation')) {
      const nodeId = String(op.nodeId), options = { ...config, baseUrl: `http://127.0.0.1:${server.port}/v1` }
      const first = await advanceCanvasProvider(f.store, f.args(nodeId), f.billing(nodeId), fetch, options)
      const replay = await advanceCanvasProvider(new CanvasStore(f.root), f.args(nodeId), f.billing(nodeId), fetch, options)
      expect(replay).toEqual(first)
    }
    const count = workflow.series ? 10 : 1
    expect(posts).toBe(count)
    expect(f.ledger.balance('a')).toMatchObject({ available: 100 - count * 2, reserved: 0, sequence: 1 + count * 2 })
    const current = f.store.delivery(f.entry.revision, f.entry.deliveryToken!, f.entry.projectId)
    const artifacts = readCanvasProviderArtifacts(f.store, current); expect(artifacts).toHaveLength(count)
    const output = publishCanvasDeliverables(f.root, current.revision, canvasBusinessArtifacts(current, artifacts))
    expect(JSON.parse(readFileSync(output.files.at(-1)!, 'utf8'))).toMatchObject({ outputCount: count, validation: { businessQualityPassed: false } })
    await f.store.settle(current.revision, current.deliveryToken!, current.projectId, f.snapshot, undefined, output)
  } finally { await server.stop(true) }
})

test('insufficient credit, revoked access, wrong delivery and wrong image order never call provider', async () => {
  const f = await fixture('form-fusion', 0); let calls = 0
  const fetcher = (async () => { calls++; throw Error('must not call') }) as unknown as typeof fetch
  const nodeId = String(f.entry.ops.find(op => op.type === 'run_generation')!.nodeId), args = f.args(nodeId)
  await expect(advanceCanvasProvider(f.store, { ...args, images: [...args.images].reverse() }, f.billing(nodeId), fetcher, config)).rejects.toThrow('顺序')
  await expect(advanceCanvasProvider(f.store, { ...args, deliveryToken: 'forged' }, f.billing(nodeId), fetcher, config)).rejects.toThrow()
  await expect(advanceCanvasProvider(f.store, args, { ...f.billing(nodeId), authorize: async () => { throw Error('revoked') } }, fetcher, config)).rejects.toThrow('revoked')
  await expect(advanceCanvasProvider(f.store, args, f.billing(nodeId), fetcher, config)).rejects.toThrow()
  expect(calls).toBe(0); expect(f.ledger.balance('a').reserved).toBe(0)
})

test('a credit rejection before dispatch can resume after recharge without a duplicate POST', async () => {
  const f = await fixture('sketch-render', 0); let posts = 0
  const nodeId = String(f.entry.ops.find(op => op.type === 'run_generation')!.nodeId)
  const fetcher = (async () => { posts++; return Response.json({ data: [{ b64_json: png }] }) }) as unknown as typeof fetch
  await expect(advanceCanvasProvider(f.store, f.args(nodeId), f.billing(nodeId), fetcher, config)).rejects.toThrow()
  expect(posts).toBe(0)
  f.ledger.grant('a', 'approved-test-recharge', 10)
  const result = await advanceCanvasProvider(new CanvasStore(f.root), f.args(nodeId), f.billing(nodeId), fetcher, config)
  expect(result.artifacts).toHaveLength(1)
  await advanceCanvasProvider(f.store, f.args(nodeId), f.billing(nodeId), fetcher, config)
  expect(posts).toBe(1)
  expect(f.ledger.balance('a')).toMatchObject({ available: 8, reserved: 0 })
})

test('network uncertainty retains reservation and restart never repeats the paid POST', async () => {
  const f = await fixture('sketch-render'); let calls = 0
  const fetcher = (async () => { calls++; throw Error('provider secret synthetic-test-key') }) as unknown as typeof fetch
  const nodeId = String(f.entry.ops.find(op => op.type === 'run_generation')!.nodeId)
  await expect(advanceCanvasProvider(f.store, f.args(nodeId), f.billing(nodeId), fetcher, config)).rejects.toThrow('未知')
  await expect(advanceCanvasProvider(new CanvasStore(f.root), f.args(nodeId), f.billing(nodeId), fetcher, config)).rejects.toThrow('不会重复')
  expect(calls).toBe(1); expect(f.ledger.balance('a')).toMatchObject({ available: 98, reserved: 2 })
  expect(() => readCanvasProviderArtifacts(f.store, f.store.delivery(f.entry.revision, f.entry.deliveryToken!, f.entry.projectId))).toThrow('不能由客户端')
})

test('concurrent submissions and changed inputs cannot create a second provider request', async () => {
  const f = await fixture('sketch-render'); let calls = 0
  const fetcher = (async () => { calls++; await new Promise(resolve => setTimeout(resolve, 40)); return Response.json({ data: [{ b64_json: png }] }) }) as unknown as typeof fetch
  const nodeId = String(f.entry.ops.find(op => op.type === 'run_generation')!.nodeId), args = f.args(nodeId)
  const attempts = await Promise.allSettled([advanceCanvasProvider(f.store, args, f.billing(nodeId), fetcher, config), advanceCanvasProvider(f.store, args, f.billing(nodeId), fetcher, config)])
  expect(attempts.some(result => result.status === 'fulfilled')).toBe(true); expect(calls).toBe(1)
  await expect(advanceCanvasProvider(f.store, args, f.billing(nodeId), fetcher, { ...config, model: 'changed-model' })).rejects.toThrow('已变化')
  expect(calls).toBe(1); expect(f.ledger.balance('a')).toMatchObject({ available: 98, reserved: 0 })
})

test('partial image results and truncated reports never publish success', async () => {
  for (const id of ['scene-edit', 'user-insight']) {
    const f = await fixture(id), nodeId = String(f.entry.ops.find(op => op.type === 'run_generation')!.nodeId)
    const fetcher = (async () => Response.json(id === 'scene-edit' ? { data: [] } : { choices: [{ finish_reason: 'length', message: { content: 'truncated' } }] })) as unknown as typeof fetch
    await expect(advanceCanvasProvider(f.store, f.args(nodeId), f.billing(nodeId), fetcher, config)).rejects.toThrow('未知')
    expect(f.ledger.balance('a').reserved).toBe(2)
  }
})
