import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANVAS_WORKFLOWS, planCanvasWorkflow, canvasWorkflowFromOps } from '../../packages/session-tools-core/src/canvas-workflows'
import { CanvasStore } from '../../packages/session-tools-core/src/canvas-store'
import { CANVAS_REVIEW_CHECKS } from '../../packages/session-tools-core/src/canvas-review'
import { executeJonworkDelivery } from '../../apps/electron/vendor/infinite-canvas/web/src/lib/canvas/jonwork-delivery'
import { canvasBusinessArtifacts } from '../../packages/server-core/src/webui/canvas-business-result'
import { inspectCanvasDeliverables, publishCanvasDeliverables, publishCanvasReview } from '../../packages/server-core/src/webui/canvas-deliverables'
import { validateCanvasGlb } from '../../packages/server-core/src/webui/canvas-glb'
import { advanceCanvasModel } from '../../packages/server-core/src/webui/canvas-model'

const roots: string[] = []
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'jonwork-fourteen-')); roots.push(root); return root }
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9gAAAABJRU5ErkJggg=='
const image = { mimeType: 'image/png', base64: png }
const requestId = 'request-1234567890'
const seriesPlan = ['水壶', '烤箱', '咖啡机', '烤面包机', '料理机', '电饭煲', '洗碗机', '冰箱', '净水器', '微波炉']
function glb(external = false) {
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: 36, ...(external ? { uri: 'https://untrusted.invalid/model.bin' } : {}) }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }] }
  const json = Buffer.from(JSON.stringify(document)), length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(12 + 8 + length + 8 + 36)
  bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.fill(32, 20, 20 + length); json.copy(bytes, 20)
  bytes.writeUInt32LE(36, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length)
  bytes.writeFloatLE(1, 28 + length + 12); bytes.writeFloatLE(1, 28 + length + 28)
  return bytes
}

describe('14 module business contracts', () => {
  test('catalog covers exactly the fourteen product modules', () => {
    expect(new Set(CANVAS_WORKFLOWS.map(item => item.id)).size).toBe(14)
  })
  for (const workflow of CANVAS_WORKFLOWS) test(`${workflow.name}: confirmed input → queued execution → files → review → handoff`, async () => {
    const root = temporary(), store = new CanvasStore(root)
    let snapshot: any = { projectId: 'project', title: 'Business test', nodes: Array.from({ length: workflow.min }, (_, index) => ({ id: `ref-${index}`, type: 'image', metadata: { storageKey: `image-${index}`, content: 'blob:test' } })), connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }
    const count = workflow.series ? 10 : workflow.mode === 'image' && !workflow.mask ? 2 : 1
    const request = { id: workflow.id, inputIds: snapshot.nodes.map((node: any) => node.id), requirements: '针对小厨房，保留家族比例与操作方式。', count, briefConfirmed: true, materialsNote: '测试资料：观察记录U1；无外部市场验证。', identityRules: '圆角矩形与白色哑光机身，保持相同控制界面。', seriesPlan, ...(workflow.mask ? { maskDataUrl: `data:image/png;base64,${png}` } : {}) }
    const plan = planCanvasWorkflow(snapshot, request, requestId)
    await store.save(snapshot); await store.bindSession('session', 'project')
    await store.enqueue('session', plan.ops as any, plan.summary, 'project', { key: requestId, fingerprint: 'a'.repeat(64) })
    const entry = (await store.claim('project')).update!
    let generated = 0
    const outcome = await executeJonworkDelivery({
      projectId: 'project', ops: entry.ops as any, active: () => true, snapshot: () => snapshot, flush: async () => {}, progress: () => {},
      apply: ops => { for (const op of ops as any[]) {
        if (op.type === 'add_node') snapshot.nodes.push({ ...op, type: op.nodeType })
        if (op.type === 'connect_nodes') snapshot.connections.push(op)
      } },
      generate: async (id, mode) => {
        generated++
        snapshot = { ...snapshot, nodes: [...snapshot.nodes], connections: [...snapshot.connections] }
        const source = snapshot.nodes.find((node: any) => node.id === id), outputCount = mode === 'text' ? 1 : source.metadata.count
        for (let index = 0; index < outputCount; index++) {
          const output = `result-${generated}-${index}`
          snapshot.nodes.push({ id: output, type: mode, metadata: { status: 'success', ...(mode === 'text' ? { content: '# 测试报告\nU1：证据需核对。' } : { storageKey: output }) } })
          snapshot.connections.push({ fromNodeId: id, toNodeId: output })
        }
      }, image: async () => image, model: async () => ({ mimeType: 'model/gltf-binary', base64: glb().toString('base64') }),
    })
    expect(outcome.artifacts).toHaveLength(count)
    const artifacts = canvasBusinessArtifacts(entry, outcome.artifacts)
    expect(artifacts).toHaveLength(count + 2)
    const output = publishCanvasDeliverables(root, entry.revision, artifacts)
    expect(JSON.parse(readFileSync(output.files.at(-1)!, 'utf8'))).toMatchObject({ module: workflow.id, status: 'pending_review', approval: { approved: false }, outputCount: count })
    await store.settle(entry.revision, entry.deliveryToken!, 'project', outcome.snapshot, undefined, output)
    const digest = inspectCanvasDeliverables(root, entry.revision).digest
    const checks = CANVAS_REVIEW_CHECKS.map(check => check.id)
    const review = await store.reviewResult(entry.revision, 'project', { requestId, expectedVersion: 0, decision: 'approved', comment: '测试夹具批准，不是设计质量验收', checks }, digest)
    expect(readFileSync(publishCanvasReview(root, entry.revision, review), 'utf8')).toContain(digest)
    await store.enqueue('session', [{ type: 'select_nodes', ids: [] }], 'next', 'project', undefined, { revision: entry.revision, reviewVersion: review.version })
    expect(store.state('project').results[0]?.review?.decision).toBe('approved')
    if (workflow.series) {
      expect(generated).toBe(10)
      const prompts = entry.ops.filter(op => op.type === 'run_generation').map(op => String(op.prompt))
      seriesPlan.forEach((item, index) => expect(prompts[index]).toContain(`本次仅输出第${index + 1}款：${item}`))
      expect(readFileSync(output.files.at(-2)!, 'utf8')).toContain('10款对应成果顺序')
    }
    writeFileSync(output.files[0]!, 'tampered')
    expect(() => inspectCanvasDeliverables(root, entry.revision)).toThrow('修改')
  })
  test('research accepts no image but requires explicit material evidence/gaps and carries upstream content', () => {
    const request = { id: 'competitor-insight', inputIds: [], count: 1, requirements: '比较小厨房用户需求' }
    expect(() => planCanvasWorkflow({ projectId: 'p', nodes: [] }, request, requestId)).toThrow('材料')
    const plan = planCanvasWorkflow({ projectId: 'p', nodes: [] }, { ...request, materialsNote: '缺少外部市场资料，先做假设。' }, requestId, 'U17：收纳困难。')
    expect((plan.ops[0] as any).metadata.prompt).toContain('U17：收纳困难')
  })
  test('PI rejects repeated products or absent identity rules instead of requesting random variants', () => {
    for (const patch of [{ seriesPlan: Array(10).fill('水壶') }, { seriesPlan: seriesPlan.slice(1) }, { identityRules: '' }]) expect(() => planCanvasWorkflow({ projectId: 'p', nodes: [] }, { id: 'pi-series', inputIds: [], count: 10, requirements: '系列设计', identityRules: '共享比例', seriesPlan, ...patch }, requestId)).toThrow('10款不同')
  })
  test('server does not publish fewer outputs or the wrong output type', () => {
    const plan = planCanvasWorkflow({ projectId: 'p', nodes: [] }, { id: 'user-insight', inputIds: [], count: 1, requirements: '用户需求', materialsNote: '暂无材料' }, requestId)
    const entry: any = { ops: plan.ops, revision: 1, createdAt: new Date().toISOString() }
    expect(() => canvasBusinessArtifacts(entry, [])).toThrow('数量')
    expect(() => canvasBusinessArtifacts(entry, [image])).toThrow('类型')
  })
  test('restoring a report request preserves requirements and evidence without inheriting confirmation', () => {
    const request = { id: 'user-insight', inputIds: [], count: 1, requirements: 'U17：小厨房收纳需求', materialsNote: '访谈摘录U17，真实性待核实', briefConfirmed: true }
    const plan = planCanvasWorkflow({ projectId: 'p', nodes: [] }, request, requestId)
    expect(canvasWorkflowFromOps(plan.ops as any)).toMatchObject({ id: request.id, requirements: request.requirements, materialsNote: request.materialsNote })
    expect(canvasWorkflowFromOps(plan.ops as any)?.briefConfirmed).toBeUndefined()
  })
  test('incomplete review, stale approval and withdrawn upstream cannot be used for handoff', async () => {
    const store = new CanvasStore(temporary())
    await store.save({ projectId: 'p', nodes: [] }); await store.enqueue('session', [{ type: 'select_nodes', ids: [] }], 'test', 'p')
    const entry = (await store.claim('p')).update!
    await store.settle(entry.revision, entry.deliveryToken!, 'p', { projectId: 'p', nodes: [] }, undefined, { previewPath: 'test-fixture', files: ['test-fixture'] })
    const review = { requestId, expectedVersion: 0, decision: 'approved' as const, comment: '', checks: [] as string[] }
    expect(() => store.reviewResult(entry.revision, 'p', review, 'a'.repeat(64))).toThrow('全部验收项')
    await expect(store.enqueue('session', [{ type: 'select_nodes', ids: [] }], 'next', 'p', undefined, { revision: entry.revision, reviewVersion: 1 })).rejects.toThrow('尚未批准')
    await store.reviewResult(entry.revision, 'p', { ...review, checks: CANVAS_REVIEW_CHECKS.map(check => check.id) }, 'a'.repeat(64))
    await expect(store.reviewResult(entry.revision, 'p', { ...review, requestId: 'different-request-0001', checks: CANVAS_REVIEW_CHECKS.map(check => check.id) }, 'a'.repeat(64))).rejects.toThrow('重新审查')
    await store.reviewResult(entry.revision, 'p', { requestId: 'request-changes-0001', expectedVersion: 1, decision: 'changes_requested', comment: '需要核对证据', checks: [] }, 'a'.repeat(64))
    await expect(store.enqueue('session', [{ type: 'select_nodes', ids: [] }], 'next', 'p', undefined, { revision: entry.revision, reviewVersion: 1 })).rejects.toThrow('尚未批准')
  })
})

describe('3D provider execution and safe resume', () => {
  async function setup() {
    const store = new CanvasStore(temporary())
    await store.save({ projectId: 'p', nodes: [] }); await store.enqueue('session', [{ type: 'run_model_generation', nodeId: 'source' }], '3D', 'p')
    const entry = (await store.claim('p')).update!
    return { store, args: { revision: entry.revision, deliveryToken: entry.deliveryToken!, projectId: 'p', image } }
  }
  test('GLB validator rejects placeholders, truncated models and external resources', () => {
    expect(validateCanvasGlb(glb())).toMatchObject({ meshes: 1, positions: 3 })
    for (const bytes of [Buffer.from('fake.glb'), glb().subarray(0, 30), glb(true)]) expect(() => validateCanvasGlb(bytes)).toThrow('GLB')
  })
  test('one creation survives concurrent queries and app restart; downloading never forwards credentials', async () => {
    const { store, args } = await setup(); let posts = 0, gets = 0
    const fetcher = (async (url: any, options: any) => {
      if (options.method === 'POST') { posts++; return Response.json({ result: 'provider-task-1' }) }
      if (String(url).startsWith('https://assets.meshy.ai')) { expect(options.headers).toBeUndefined(); expect(options.redirect).toBe('error'); return new Response(glb()) }
      gets++; return Response.json({ status: 'SUCCEEDED', model_urls: { glb: 'https://assets.meshy.ai/test/model.glb' } })
    }) as typeof fetch
    const attempts = await Promise.allSettled([advanceCanvasModel(store, args, fetcher, 'test-key'), advanceCanvasModel(store, args, fetcher, 'test-key')])
    expect(attempts.some(result => result.status === 'fulfilled')).toBe(true); expect(posts).toBe(1)
    await store.settle(args.revision, args.deliveryToken, 'p', undefined, 'connection lost')
    const restored = new CanvasStore(roots.at(-1)!)
    await restored.retry(args.revision, 'p')
    const entry = (await restored.claim('p')).update!
    const result = await advanceCanvasModel(restored, { ...args, deliveryToken: entry.deliveryToken! }, fetcher, 'test-key')
    expect(result.status).toBe('completed'); expect(posts).toBe(1); expect(gets).toBeGreaterThan(0)
    expect(result.artifact?.mimeType).toBe('model/gltf-binary')
  })
  test('uncertain creation is never retried and errors do not expose credentials or response bodies', async () => {
    const { store, args } = await setup(); let calls = 0
    const fetcher = (async () => { calls++; throw new Error('secret-token at private-host') }) as unknown as typeof fetch
    await expect(advanceCanvasModel(store, args, fetcher, 'secret-token')).rejects.toThrow('超时')
    await expect(advanceCanvasModel(store, args, fetcher, 'secret-token')).rejects.toThrow('不会重复')
    expect(calls).toBe(1)
  })
  test('missing configuration, changed images and untrusted download hosts are rejected', async () => {
    const { store, args } = await setup(); let calls = 0
    const fetcher = (async (_url: any, options: any) => { calls++; return Response.json(options.method === 'POST' ? { result: 'provider-task-1' } : { status: 'SUCCEEDED', model_urls: { glb: 'https://127.0.0.1/private' } }) }) as typeof fetch
    await expect(advanceCanvasModel(store, args, fetcher, '')).rejects.toThrow('尚未配置'); expect(calls).toBe(0)
    await advanceCanvasModel(store, args, fetcher, 'test-key')
    await expect(advanceCanvasModel(store, args, fetcher, 'test-key')).rejects.toThrow('可信范围')
    expect(calls).toBe(2)
    await expect(store.reserveModelTask(args.revision, args.deliveryToken, 'p', 'f'.repeat(64))).rejects.toThrow('输入已变化')
  })
})
