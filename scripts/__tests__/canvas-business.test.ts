import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeJonworkDelivery } from '../../apps/electron/vendor/infinite-canvas/web/src/lib/canvas/jonwork-delivery'
import { publishCanvasDeliverables } from '../../packages/server-core/src/webui/canvas-deliverables'
import { CanvasStore } from '../../packages/session-tools-core/src/canvas-store'
import { CANVAS_WORKFLOWS, planCanvasWorkflow, validateCanvasMask } from '../../packages/session-tools-core/src/canvas-workflows'
import { assertMaskSupport, requireTextResult, validateMaskPixels } from '../../apps/electron/vendor/infinite-canvas/web/src/services/api/generation-contract'

const roots: string[] = []
const temporary = () => { const root = mkdtempSync(join(tmpdir(), 'jonwork-business-')); roots.push(root); return root }
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })) })
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9gAAAABJRU5ErkJggg=='
const image = { mimeType: 'image/png', base64: png }
const maskDataUrl = `data:image/png;base64,${png}`

function fixture() {
  let snapshot: any = { projectId: 'project', title: 'Test', nodes: [{ id: 'prompt', type: 'text', metadata: { prompt: 'render product' } }], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }
  const success = () => {
    snapshot = { ...snapshot, nodes: [...snapshot.nodes, { id: 'output', type: 'image', metadata: { status: 'success', storageKey: 'new-image' } }], connections: [{ fromNodeId: 'prompt', toNodeId: 'output' }] }
  }
  const options: Parameters<typeof executeJonworkDelivery>[0] = {
    projectId: 'project', ops: [{ type: 'run_generation', nodeId: 'prompt', mode: 'image' }],
    apply: () => {}, snapshot: () => snapshot, generate: async () => success(), flush: async () => {}, image: async () => image, progress: () => {}, active: () => true,
  }
  return { options, success, set: (value: any) => { snapshot = value } }
}

describe('canvas business delivery', () => {
  for (const workflow of CANVAS_WORKFLOWS.filter(item => !item.series && item.mode !== 'model')) test(`${workflow.name}: selected references become explicit image inputs without modifying originals`, () => {
    const nodes = Array.from({ length: Math.max(1, workflow.min) }, (_, index) => ({ id: `ref-${index}`, type: 'image', metadata: { storageKey: `image-${index}`, content: `blob:example-${index}` } }))
    const snapshot = { projectId: 'project', nodes }
    const before = JSON.stringify(snapshot)
    const count = workflow.mode === 'text' || workflow.mask ? 1 : 2
    const plan = planCanvasWorkflow(snapshot, { id: workflow.id, inputIds: nodes.map(node => node.id).reverse(), requirements: '保留主体轮廓，哑光白色', materialsNote: '暂无访谈材料，仅形成待验证假设。', count, ...(workflow.mask ? { maskDataUrl } : {}) }, 'request-1234567890')
    expect(plan.ops.filter(op => op.type === 'connect_nodes').map(op => (op as any).fromNodeId)).toEqual(nodes.map(node => node.id).reverse())
    expect((plan.ops[0] as any).metadata.composerContent).toContain(`图1：@[node:ref-${nodes.length - 1}]`)
    expect(plan.ops.at(-1)).toMatchObject({ type: 'run_generation', mode: workflow.mode, expectedOutputCount: count })
    if (workflow.mode === 'text') {
      expect((plan.ops[0] as any).metadata.textCount).toBe(1)
      expect((plan.ops[0] as any).metadata.prompt).toContain('逐图可见证据')
      expect(plan.summary).toContain('1份报告')
    }
    if (workflow.mask) {
      expect(plan.ops.at(-1)).toMatchObject({ maskDataUrl })
      expect((plan.ops[0] as any).metadata.editMaskDataUrl).toBe(maskDataUrl)
    }
    expect(JSON.stringify(snapshot)).toBe(before)
  })
  test('local remodeling rejects missing, malformed, oversized and wrong-sized masks', () => {
    const snapshot = { projectId: 'project', nodes: [{ id: 'source', type: 'image', metadata: { storageKey: 'stored', content: 'blob:example', naturalWidth: 2, naturalHeight: 2 } }] }
    const request = { id: 'local-remodel', inputIds: ['source'], requirements: '只修改把手', count: 1 }
    for (const invalid of [undefined, 'data:image/jpeg;base64,aaaa', 'data:image/png;base64,bm90LWEtcG5n', `data:image/png;base64,${'a'.repeat(1_400_000)}`]) {
      expect(() => planCanvasWorkflow(snapshot, { ...request, maskDataUrl: invalid }, 'request-1234567890')).toThrow()
    }
    expect(validateCanvasMask(maskDataUrl)).toEqual({ width: 1, height: 1 })
    expect(() => planCanvasWorkflow(snapshot, { ...request, maskDataUrl }, 'request-1234567890')).toThrow('尺寸不一致')
    expect(() => planCanvasWorkflow(snapshot, { ...request, maskDataUrl, id: 'scene-edit' }, 'request-1234567890')).toThrow('不接受局部掩膜')
  })
  test('reports and masked edits require exactly one output', () => {
    for (const workflow of CANVAS_WORKFLOWS.filter(item => item.mask || item.mode === 'text')) {
      expect(() => planCanvasWorkflow({ projectId: 'project', nodes: [] }, { id: workflow.id, inputIds: [], requirements: 'test', count: 2 }, 'request-1234567890')).toThrow('每次输出1份')
    }
  })
  test('mask is passed intact to the actual generator', async () => {
    const { options, success } = fixture()
    options.ops = [{ type: 'run_generation', nodeId: 'prompt', mode: 'image', expectedOutputCount: 1, maskDataUrl }]
    let passed: unknown
    options.generate = async (_id, _mode, _prompt, args) => { passed = args; success() }
    await executeJonworkDelivery(options)
    expect(passed).toEqual({ maskDataUrl })
  })
  test('invalid mask delivery fails before mutations or generation', async () => {
    const { options } = fixture()
    let called = false
    options.apply = () => { called = true }
    options.generate = async () => { called = true }
    options.ops = [{ type: 'select_nodes', ids: [] }, { type: 'run_generation', nodeId: 'prompt', mode: 'image', expectedOutputCount: 1, maskDataUrl: 'invalid' }]
    await expect(executeJonworkDelivery(options)).rejects.toThrow('掩膜')
    expect(called).toBe(false)
  })
  test('unsupported mask interfaces never silently fall back to whole-image generation', () => {
    expect(() => assertMaskSupport('openai', true, 1, 1)).toThrow('插件未接入掩膜')
    expect(() => assertMaskSupport('gemini', false, 1, 1)).toThrow('不支持掩膜')
    expect(() => assertMaskSupport('openai', false, 2, 1)).toThrow('一张原图')
    expect(() => assertMaskSupport('openai', false, 1, 2)).toThrow('一张结果')
    expect(() => assertMaskSupport('openai', false, 1, 1)).not.toThrow()
  })
  test('mask pixels require both an edited and a protected region at original dimensions', () => {
    const pixels = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 255])
    expect(() => validateMaskPixels(2, 1, 2, 1, pixels)).not.toThrow()
    expect(() => validateMaskPixels(2, 1, 1, 1, pixels)).toThrow('尺寸不一致')
    expect(() => validateMaskPixels(1, 1, 1, 1, pixels.slice(0, 4))).toThrow('保留未圈选区域')
    expect(() => validateMaskPixels(1, 1, 1, 1, pixels.slice(4))).toThrow('尚未圈选')
  })
  test('empty provider responses are errors, not completed placeholder reports', () => {
    for (const value of [undefined, null, '', '   ', { content: 'fake' }]) expect(() => requireTextResult(value)).toThrow('未返回文本成果')
    expect(requireTextResult('  # 评估草稿\n证据  ')).toBe('# 评估草稿\n证据')
  })
  test('report delivery requires the requested count and publishes a Markdown file', async () => {
    const { options, set } = fixture()
    options.ops = [{ type: 'run_generation', nodeId: 'prompt', mode: 'text', expectedOutputCount: 1 }]
    options.generate = async () => set({ ...options.snapshot(), nodes: [...options.snapshot().nodes, { id: 'report', type: 'text', metadata: { status: 'success', content: '# 待审查草稿\n\n图1：可见把手' } }], connections: [{ fromNodeId: 'prompt', toNodeId: 'report' }] })
    const outcome = await executeJonworkDelivery(options)
    const output = publishCanvasDeliverables(temporary(), 1, outcome.artifacts)
    expect(readFileSync(output.files[0]!, 'utf8')).toContain('图1：可见把手')
    options.ops = [{ type: 'run_generation', nodeId: 'prompt', mode: 'text', expectedOutputCount: 2 }]
    set({ ...options.snapshot(), nodes: [{ id: 'prompt', type: 'text', metadata: { prompt: 'evaluate' } }], connections: [] })
    await expect(executeJonworkDelivery(options)).rejects.toThrow('要求2份报告，实际成功1份')
  })
  test('invalid business inputs fail before queueing or provider calls', () => {
    const snapshot = { projectId: 'project', nodes: [{ id: 'image', type: 'image', metadata: { storageKey: 'stored', content: 'blob:example' } }] }
    const request = { id: 'sketch-render', inputIds: ['image'], requirements: '保留轮廓', count: 1 }
    for (const patch of [{ id: 'nonexistent-workflow' }, { inputIds: [] }, { inputIds: ['missing'] }, { inputIds: ['image', 'image'] }, { count: 0 }, { count: 5 }, { requirements: '' }]) {
      expect(() => planCanvasWorkflow(snapshot, { ...request, ...patch }, 'request-1234567890')).toThrow()
    }
    expect(() => planCanvasWorkflow({ ...snapshot, nodes: [{ ...snapshot.nodes[0], metadata: { ...snapshot.nodes[0]!.metadata, images: [{}, {}] } }] }, request, 'request-1234567890')).toThrow('展开图片组')
  })
  test('business retries reuse the queued request and reject conflicting changes', async () => {
    const store = new CanvasStore(temporary()); await store.save({ projectId: 'project', nodes: [] })
    const request = { key: 'request-1234567890', fingerprint: 'a'.repeat(64) }
    const first = await store.enqueue('session', [{ type: 'run_generation' }], 'business', 'project', request)
    const replay = await store.enqueue('session', [{ type: 'run_generation' }], 'business', 'project', request)
    expect(replay.revision).toBe(first.revision)
    expect(store.state().pendingUpdates).toHaveLength(1)
    await expect(store.enqueue('session', [{ type: 'run_generation' }], 'business', 'project', { ...request, fingerprint: 'b'.repeat(64) })).rejects.toThrow('不同要求')
  })
  test('generation runs before later edits, rather than applying all edits upfront', async () => {
    const { options, success } = fixture()
    const order: string[] = []
    options.ops = [{ type: 'select_nodes', ids: ['prompt'] }, ...options.ops, { type: 'delete_node', id: 'prompt' }]
    options.apply = ops => order.push(ops[0]!.type)
    options.generate = async () => { order.push('generate'); success() }
    await executeJonworkDelivery(options)
    expect(order).toEqual(['select_nodes', 'generate', 'delete_node'])
  })
  test('fewer outputs than requested cannot be acknowledged as a complete business result', async () => {
    const { options } = fixture()
    options.ops = [{ type: 'run_generation', nodeId: 'prompt', mode: 'image', expectedOutputCount: 2 }]
    await expect(executeJonworkDelivery(options)).rejects.toThrow('实际成功1张')
  })
  test('a task stays bound to its original canvas after switching the active project', async () => {
    const store = new CanvasStore(temporary())
    await store.save({ projectId: 'original', nodes: [] })
    await store.bindSession('session', 'original')
    await store.save({ projectId: 'other', nodes: [] })
    expect(store.state(store.sessionProject('session')).state?.snapshot.projectId).toBe('original')
    await expect(store.enqueue('session', [{ type: 'select_nodes', ids: [] }], undefined, 'other')).rejects.toThrow('不匹配')
    await expect(store.bindSession('session', 'other')).rejects.toThrow('绑定其他')
  })
  test('awaits generation, publishes real files into the original session, exposes them to subsequent context', async () => {
    const { options, success } = fixture()
    let complete!: () => void
    options.generate = () => new Promise<void>(resolve => { complete = () => { success(); resolve() } })
    let finished = false
    const task = executeJonworkDelivery(options).then(result => { finished = true; return result })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(finished).toBe(false)
    complete()
    const outcome = await task
    const root = temporary(), session = join(root, 'session')
    mkdirSync(session)
    const store = new CanvasStore(root)
    await store.save(options.snapshot())
    const update = await store.enqueue('original-session', options.ops, 'render', 'project')
    const claimed = (await store.claim('project')).update!
    const output = publishCanvasDeliverables(session, update.revision, outcome.artifacts)
    await store.settle(update.revision, claimed.deliveryToken!, 'project', outcome.snapshot, undefined, output)
    expect(readFileSync(output.files[0]!).toString('base64')).toBe(png)
    expect(readFileSync(output.previewPath, 'utf8')).toContain('待用户审查')
    expect(store.state('project').results[0]?.sessionId).toBe('original-session')
  })
  test('missing configuration/no output cannot produce a success receipt', async () => {
    const { options } = fixture(); options.generate = async () => {}
    await expect(executeJonworkDelivery(options)).rejects.toThrow('没有生成新的图片')
  })
  test('partial batch failure is not a completed business result', async () => {
    const { options, success, set } = fixture()
    options.generate = async () => { success(); const state = options.snapshot(); state.nodes[1]!.metadata!.images = [{ id: 'bad', status: 'error' } as any]; set(state) }
    await expect(executeJonworkDelivery(options)).rejects.toThrow('部分图片')
  })
  test('a switched project cannot receive an old generation result', async () => {
    const { options, set } = fixture(); options.generate = async () => set({ ...options.snapshot(), projectId: 'other' })
    await expect(executeJonworkDelivery(options)).rejects.toThrow('项目已切换')
  })
  test('missing targets and prompts fail before calling a provider', async () => {
    const { options, set } = fixture(); options.generate = async () => { throw new Error('provider must not be called') }
    set({ ...options.snapshot(), nodes: [] })
    await expect(executeJonworkDelivery(options)).rejects.toThrow('目标节点不存在')
    set({ ...options.snapshot(), nodes: [{ id: 'prompt', type: 'text', metadata: {} }] })
    await expect(executeJonworkDelivery(options)).rejects.toThrow('生成要求为空')
  })
  test('text generation produces a readable deliverable', async () => {
    const { options, set } = fixture(); options.ops = [{ type: 'run_generation', nodeId: 'prompt', mode: 'text' }]
    options.generate = async () => set({ ...options.snapshot(), nodes: [{ id: 'prompt', type: 'text', metadata: { status: 'success', content: '# Report' } }] })
    expect((await executeJonworkDelivery(options)).artifacts).toEqual([{ mimeType: 'text/markdown', text: '# Report' }])
  })
  test('save retry is idempotent and conflicting output never overwrites a version', () => {
    const root = temporary()
    const first = publishCanvasDeliverables(root, 1, [image])
    expect(publishCanvasDeliverables(root, 1, [image])).toEqual(first)
    expect(() => publishCanvasDeliverables(root, 1, [{ mimeType: 'text/markdown', text: 'different' }])).toThrow()
    writeFileSync(first.files[0]!, 'changed')
    expect(() => publishCanvasDeliverables(root, 1, [image])).toThrow('冲突')
  })
  test('rejects fake files and linked output paths', () => {
    const root = temporary(), outside = temporary()
    expect(() => publishCanvasDeliverables(root, 1, [{ mimeType: 'image/png', base64: Buffer.from('not an image').toString('base64') }])).toThrow('格式')
    symlinkSync(outside, join(root, 'data'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => publishCanvasDeliverables(root, 1, [image])).toThrow('Unsafe')
  })
  test('heartbeats retain the same delivery without starting generation twice', async () => {
    const store = new CanvasStore(temporary()); await store.save({ projectId: 'project', nodes: [] })
    await store.enqueue('session', [{ type: 'run_generation' }], undefined, 'project')
    const first = (await store.claim('project', 1000)).update!
    await store.heartbeat(first.revision, first.deliveryToken!, 'project', 29000)
    const next = await store.claim('project', 32000)
    expect(next.update).toBeNull(); expect(next.blocked?.status).toBe('running')
    await expect(store.heartbeat(first.revision, 'wrong', 'project')).rejects.toThrow()
  })
})
