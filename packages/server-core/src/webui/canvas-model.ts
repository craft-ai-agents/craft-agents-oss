import { createHash } from 'node:crypto'
import type { CanvasStore } from '@craft-agent/session-tools-core/canvas-store'
import { validateCanvasGlb } from './canvas-glb'

const API = 'https://api.meshy.ai/openapi/v1/image-to-3d'
export interface CanvasModelBilling {
  authorize(): Promise<void>
  reserve(): Promise<void>
  check(): Promise<void>
  finish(status: 'complete' | 'failed' | 'interrupted' | 'unknown'): Promise<void>
}
export function canvasModelConfigured() { return Boolean(process.env.JONWORK_MESHY_API_KEY?.trim()) }

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body || Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('3D服务响应为空或超过大小限制。') }
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break
      size += value.length; if (size > limit) { await reader.cancel(); throw new Error('3D服务响应超过大小限制。') }
      parts.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(parts)
}

/** One bounded step per RPC; creation is reserved durably BEFORE the billable POST. */
export async function advanceCanvasModel(store: CanvasStore, args: { revision: number; deliveryToken: string; projectId: string; image: { mimeType: string; base64: string } }, fetcher: typeof fetch = fetch, apiKey = process.env.JONWORK_MESHY_API_KEY, billing?: CanvasModelBilling) {
  await billing?.authorize()
  if (!apiKey?.trim()) throw new Error('图片转3D尚未配置。请管理员在服务端设置 JONWORK_MESHY_API_KEY 并重启服务；密钥不要填入任务或画布。')
  const entry = store.delivery(args.revision, args.deliveryToken, args.projectId)
  if (entry.ops.length !== 1 || entry.ops[0]?.type !== 'run_model_generation') throw new Error('不是图片转3D任务。')
  const input = args.image
  if (!input || !['image/png', 'image/jpeg'].includes(input.mimeType) || typeof input.base64 !== 'string' || input.base64.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('3D输入必须为小于6MB的PNG或JPEG。')
  const bytes = Buffer.from(input.base64, 'base64')
  if (bytes.toString('base64') !== input.base64 || (input.mimeType === 'image/png' ? bytes.length < 33 || bytes.toString('hex', 0, 8) !== '89504e470d0a1a0a' : bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217)) throw new Error('3D输入图片格式无效。')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const reserved = await store.reserveModelTask(args.revision, args.deliveryToken, args.projectId, digest)
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const request = async (url: string, init: RequestInit, limit: number) => {
    let response: Response
    try { response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(25_000) }) }
    catch { throw new Error('3D服务连接失败或超时。创建阶段结果可能未知，请核对供应商任务，勿重复提交。') }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`3D服务请求失败（HTTP ${response.status}），请检查账户配置或配额；不会自动重建任务。`) }
    try { return await boundedBody(response, limit) } catch { throw new Error('3D服务响应中断、超时或超限，请核对原任务后继续获取。') }
  }
  if (reserved.created) {
    // Only a failure BEFORE dispatch releases the marker. Unknown provider
    // requests retain it and are never recreated after reconnect/restart.
    try { await billing?.reserve() }
    catch (error) {
      await store.releaseUndispatchedModelTask(args.revision, args.deliveryToken, args.projectId, digest)
      throw error
    }
    try {
    const body = await request(API, { method: 'POST', headers, body: JSON.stringify({ image_url: `data:${input.mimeType};base64,${input.base64}`, target_formats: ['glb'], should_texture: true }) }, 64_000)
    let taskId: unknown
    try { taskId = JSON.parse(body.toString('utf8')).result } catch { /* kept uncertain */ }
    if (typeof taskId !== 'string' || !/^[\w-]{1,128}$/.test(taskId)) throw new Error('3D服务未返回任务编号，创建结果未知；请核对供应商，禁止自动重建。')
    await store.recordModelTask(args.revision, args.projectId, digest, taskId)
    return { status: 'pending', progress: 0 }
    } catch (error) {
      // POST may have incurred a cost even without a response. Do not refund or resubmit.
      await billing?.finish('unknown')
      throw error
    }
  }
  await billing?.check()
  const taskId = reserved.task.taskId
  if (!taskId) throw new Error('3D创建结果尚未确认。请核对供应商任务，系统不会重复创建收费任务。')
  const body = await request(`${API}/${encodeURIComponent(taskId)}`, { headers }, 128_000)
  let task: any
  try { task = JSON.parse(body.toString('utf8')) } catch { throw new Error('3D任务状态无效，请稍后继续获取原任务。') }
  if (['FAILED', 'CANCELED', 'CANCELLED'].includes(task.status)) {
    await billing?.finish(task.status === 'FAILED' ? 'failed' : 'interrupted')
    throw new Error('3D供应商任务失败或取消；请检查原图与账户后另建任务。')
  }
  if (task.status !== 'SUCCEEDED') {
    if (!['PENDING', 'IN_PROGRESS'].includes(task.status)) throw new Error('3D任务状态未知，请核对供应商。')
    return { status: 'pending', progress: Number.isFinite(task.progress) ? Math.min(100, Math.max(0, task.progress)) : 0 }
  }
  let url: URL
  try { url = new URL(task.model_urls?.glb) } catch { throw new Error('3D任务没有返回GLB下载地址。') }
  if (url.protocol !== 'https:' || url.hostname !== 'assets.meshy.ai' || url.port || url.username || url.password) throw new Error('3D成果下载域名不在可信范围内，已停止下载。')
  // Never forward provider credentials to an asset URL and never follow redirects.
  const model = await request(url.href, {}, 16 * 1024 * 1024)
  validateCanvasGlb(model)
  await billing?.finish('complete')
  return { status: 'completed', progress: 100, artifact: { mimeType: 'model/gltf-binary', base64: model.toString('base64') } }
}
