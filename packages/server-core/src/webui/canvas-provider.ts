import { createHash } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertSkillPath } from '@craft-agent/shared/skills'
import type { CanvasStore, CanvasUpdate } from '@craft-agent/session-tools-core/canvas-store'
import { CANVAS_WORKFLOWS, canvasWorkflowFromOps } from '@craft-agent/session-tools-core/canvas-workflows'
import type { CanvasModelBilling } from './canvas-model'

export type CanvasArtifact = { mimeType: string; base64?: string; text?: string }
export type CanvasProviderInput = { nodeId: string; mimeType: string; base64: string }
export type CanvasProviderConfig = { model: string; key: string; baseUrl: string }
const running = new Map<string, Promise<{ artifacts: CanvasArtifact[] }>>()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

// Only administrators configure this fixed HTTP provider. No tools, shell, plugins,
// redirects, client URLs or model-generated URLs are executed by this path.
export function canvasProviderConfig(mode: 'image' | 'text'): CanvasProviderConfig {
  const prefix = mode === 'image' ? 'JONWORK_CANVAS_IMAGE' : 'JONWORK_CANVAS_TEXT'
  const model = process.env[`${prefix}_MODEL`]?.trim()
  const key = process.env[`${prefix}_API_KEY`]?.trim()
  const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim() || 'https://api.openai.com/v1'
  if (!model || !key) throw new Error(`请管理员配置服务端 ${prefix}_MODEL 和 ${prefix}_API_KEY；请勿在画布填写密钥。`)
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('生成服务地址必须为管理员配置的 HTTPS API 地址。')
  return { model, key, baseUrl: baseUrl.replace(/\/$/, '') }
}

export function canvasWorkflowModel(id: string) {
  const workflow = CANVAS_WORKFLOWS.find(item => item.id === id)
  if (!workflow) throw new Error('未知业务流程。')
  return workflow.mode === 'model' ? 'meshy/image-to-3d' : canvasProviderConfig(workflow.mode).model
}

function imageBytes(input: CanvasArtifact, limit = 6 * 1024 * 1024) {
  if (!input || typeof input.base64 !== 'string' || input.base64.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('图片编码无效或超出大小限制。')
  const bytes = Buffer.from(input.base64, 'base64')
  if (bytes.toString('base64') !== input.base64 || bytes.length > limit) throw new Error('图片编码无效或超限。')
  const png = bytes.length > 32 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a' && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  const jpg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  const webp = bytes.length > 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
  if (!(input.mimeType === 'image/png' && png || input.mimeType === 'image/jpeg' && jpg || input.mimeType === 'image/webp' && webp)) throw new Error('图片格式与内容不一致。')
  return bytes
}

function resultPath(store: CanvasStore, entry: CanvasUpdate, nodeId: string) {
  const root = dirname(store.path)
  const path = join(root, 'provider-results', hash(`${entry.projectId}:${entry.revision}:${nodeId}`) + '.json')
  assertSkillPath(root, path)
  return path
}

export function readCanvasProviderArtifacts(store: CanvasStore, entry: CanvasUpdate): CanvasArtifact[] {
  return entry.ops.filter(op => op.type === 'run_generation').flatMap(op => {
    const nodeId = String(op.nodeId), task = entry.providerTasks?.[nodeId]
    if (!task || task.status !== 'complete') throw new Error('服务端尚未完成全部生成，不能由客户端声明成功。')
    const saved = JSON.parse(readFileSync(resultPath(store, entry, nodeId), 'utf8'))
    if (saved.digest !== task.digest || !Array.isArray(saved.artifacts)) throw new Error('服务端成果记录不匹配。')
    return saved.artifacts as CanvasArtifact[]
  })
}

/** Keep provider requests alive across bounded RPC polls, never across a process crash. */
export async function stepCanvasProvider(store: CanvasStore, args: Parameters<typeof advanceCanvasProvider>[1], billing: CanvasModelBilling) {
  await billing.authorize()
  const key = hash(JSON.stringify([store.path, args]))
  let job = running.get(key)
  if (!job) {
    if (running.size >= 1000) throw new Error('生成服务繁忙，请稍后重试。')
    job = advanceCanvasProvider(store, args, billing)
    running.set(key, job)
    const remove = () => { running.delete(key) }
    void job.then(remove, remove)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([job.then(result => ({ status: 'completed' as const, ...result })), new Promise<{ status: 'pending' }>(resolve => { timer = setTimeout(() => resolve({ status: 'pending' }), 250) })])
  } finally { clearTimeout(timer) }
}

async function responseJson(response: Response) {
  if (!response.body) throw new Error('生成服务响应为空。')
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.length
      if (size > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('生成服务响应超过32MB。') }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

/** One paid provider POST per immutable operation. Reconnection reuses saved bytes. */
export async function advanceCanvasProvider(store: CanvasStore, args: { revision: number; deliveryToken: string; projectId: string; nodeId: string; images: CanvasProviderInput[] }, billing: CanvasModelBilling, fetcher: typeof fetch = fetch, config?: CanvasProviderConfig) {
  await billing.authorize()
  const entry = store.delivery(args.revision, args.deliveryToken, args.projectId)
  const op = entry.ops.find(item => item.type === 'run_generation' && item.nodeId === args.nodeId)
  const brief = canvasWorkflowFromOps(entry.ops)
  if (!op || !brief || !['image', 'text'].includes(String(op.mode)) || typeof op.prompt !== 'string') throw new Error('生成节点不是已确认的业务任务。')
  const mode = op.mode as 'image' | 'text', provider = config ?? canvasProviderConfig(mode)
  if (!Array.isArray(args.images) || args.images.length !== brief.inputIds.length || args.images.some((image, index) => image.nodeId !== brief.inputIds[index])) throw new Error('输入图片必须与原需求的图号及顺序一致。')
  const bytes = args.images.map(image => imageBytes(image))
  if (bytes.reduce((sum, value) => sum + value.length, 0) > 12 * 1024 * 1024) throw new Error('单次输入图片合计不能超过12MB。')
  const digest = hash(JSON.stringify([op, provider.model, provider.baseUrl, args.images]))
  const path = resultPath(store, entry, args.nodeId)
  const count = Number(op.expectedOutputCount)
  if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('业务输出数量无效。')
  let body: string | FormData, endpoint: string, contentType: string | undefined
  // Prompt and mask are taken only from the durable server plan, never the RPC.
  const prompt = op.prompt.replace(/@\[node:[^\]]+\]/g, '[按随请求上传的图号顺序]')
  if (mode === 'text') {
    endpoint = '/chat/completions'; contentType = 'application/json'
    body = JSON.stringify({ model: provider.model, stream: false, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...args.images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }))] }] })
  } else {
    if (!bytes.length) throw new Error('图像业务必须提供原图。')
    endpoint = '/images/edits'
    const form = new FormData(); form.set('model', provider.model); form.set('prompt', prompt); form.set('n', String(count)); form.set('output_format', 'png')
    bytes.forEach((value, index) => form.append('image[]', new Blob([new Uint8Array(value)], { type: args.images[index]!.mimeType }), `input-${index + 1}.${args.images[index]!.mimeType.split('/')[1]}`))
    if (typeof op.maskDataUrl === 'string') {
      const mask = imageBytes({ mimeType: 'image/png', base64: op.maskDataUrl.split(',')[1] })
      form.set('mask', new Blob([new Uint8Array(mask)], { type: 'image/png' }), 'mask.png')
    }
    body = form
  }
  // Validate and build the request before claiming it. Invalid local inputs have
  // not reached the supplier and must not leave an ambiguous dispatch marker.
  const claim = await store.reserveProviderTask(entry.revision, args.deliveryToken, entry.projectId, args.nodeId, digest)
  if (!claim.created) {
    await billing.check()
    if (!existsSync(path)) throw new Error('原生成结果尚未确认；请核对原任务，不会重复提交收费请求。')
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    if (saved.digest !== digest) throw new Error('服务端成果与原请求不一致。')
    await store.completeProviderTask(entry.revision, entry.projectId, args.nodeId, digest)
    await billing.finish('complete')
    return { artifacts: saved.artifacts as CanvasArtifact[] }
  }
  try { await billing.reserve() }
  catch (error) {
    // This catch is intentionally BEFORE fetch. A timeout/unknown POST must
    // retain its marker; a rejected credit reservation can safely be retried.
    await store.releaseUndispatchedProviderTask(entry.revision, args.deliveryToken, entry.projectId, args.nodeId, digest)
    throw error
  }
  let knownFailure = false
  try {
    const response = await fetcher(provider.baseUrl + endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${provider.key}`, ...(contentType ? { 'Content-Type': contentType } : {}) }, body })
    if (!response.ok) { await response.body?.cancel(); knownFailure = response.status >= 400 && response.status < 500; throw new Error(`生成服务请求失败（HTTP ${response.status}）。`) }
    const payload = await responseJson(response)
    let artifacts: CanvasArtifact[]
    if (mode === 'text') {
      const text = payload.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim() || text.length > 512_000 || payload.choices?.[0]?.finish_reason !== 'stop') throw new Error('服务端未收到完整报告。')
      artifacts = [{ mimeType: 'text/markdown', text }]
    } else {
      if (!Array.isArray(payload.data) || payload.data.length !== count) throw new Error('供应商返回的图片数量不符。')
      artifacts = payload.data.map((item: { b64_json?: string }) => ({ mimeType: 'image/png', base64: item.b64_json }))
      artifacts.forEach(artifact => imageBytes(artifact, 16 * 1024 * 1024))
    }
    // Persist provider evidence before settling or returning it to any renderer.
    mkdirSync(dirname(path), { recursive: true })
    const temporary = path + '.tmp'
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify({ digest, artifacts })); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, path)
    await store.completeProviderTask(entry.revision, entry.projectId, args.nodeId, digest)
    await billing.finish('complete')
    return { artifacts }
  } catch {
    await billing.finish(knownFailure ? 'failed' : 'unknown')
    throw new Error(knownFailure ? '供应商拒绝生成；已按固定派发任务计费，请检查配置或材料。' : '生成结果或保存状态未知，已保留预占；请核对原任务，系统不会重复生成。')
  }
}
