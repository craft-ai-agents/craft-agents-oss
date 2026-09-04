import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateCanvasReview, type CanvasReview, type CanvasReviewRequest } from './canvas-review'
import { canvasWorkflowFromOps } from './canvas-workflows'

export type CanvasOp = Record<string, unknown> & { type: string }
export type CanvasSnapshot = Record<string, unknown> & { projectId: string; nodes: unknown[] }
export interface CanvasUpdate {
  id: string
  revision: number
  projectId: string
  sessionId: string
  ops: CanvasOp[]
  summary?: string
  status: 'pending' | 'running' | 'failed' | 'uncertain' | 'completed' | 'dismissed'
  createdAt: string
  attempt: number
  deliveryToken?: string
  deadline?: number
  startedAt?: number
  error?: string
  result?: { previewPath: string; files: string[]; nodeIds?: string[]; imageKeys?: string[] }
  reviews?: CanvasReview[]
  upstream?: { revision: number; reviewVersion: number }
  request?: { key: string; fingerprint: string }
  modelTask?: { inputDigest: string; taskId?: string; status: 'submitting' | 'created' }
  providerTasks?: Record<string, { digest: string; status: 'submitting' | 'complete' }>
}
interface CanvasData {
  version: 2
  nextRevision: number
  activeProjectId?: string
  snapshots: Record<string, { snapshot: CanvasSnapshot; updatedAt: string }>
  updates: CanvasUpdate[]
  sessionProjects?: Record<string, string>
}

const MAX_BYTES = 16 * 1024 * 1024
const OPS = new Set(['add_node', 'update_node', 'delete_node', 'delete_connections', 'connect_nodes', 'set_viewport', 'select_nodes', 'run_generation', 'run_model_generation'])
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(value)

export function validateCanvasSnapshot(value: unknown): asserts value is CanvasSnapshot {
  const snapshot = value as CanvasSnapshot | null
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !validId(snapshot.projectId) || !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 10_000) throw new Error('Invalid canvas snapshot')
  if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_BYTES) throw new Error('Canvas snapshot exceeds size limit')
}

function readJson(path: string): any | null {
  try {
    const bytes = readFileSync(path)
    if (bytes.length > MAX_BYTES) throw new Error('Canvas data exceeds size limit')
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error('画布数据损坏或不可读；已停止写入，请从备份恢复。')
  }
}

/** Shared by Electron/Node and the Bun agent subprocess. Never silently reset corrupt data. */
export class CanvasStore {
  private readonly dir: string
  readonly path: string
  constructor(workspacePath: string) {
    this.dir = join(workspacePath, 'canvas')
    this.path = join(this.dir, 'canvas-store-v2.json')
  }

  private read(): CanvasData {
    const value = readJson(this.path)
    if (value) {
      if (value.version !== 2 || !Number.isSafeInteger(value.nextRevision) || value.nextRevision < 1
        || !value.snapshots || Array.isArray(value.snapshots) || typeof value.snapshots !== 'object' || !Array.isArray(value.updates)) throw new Error('Invalid canvas store')
      for (const [id, state] of Object.entries(value.snapshots)) {
        validateCanvasSnapshot((state as any)?.snapshot)
        if (id !== (state as any).snapshot.projectId) throw new Error('Invalid canvas project identity')
      }
      const revisions = new Set<number>()
      for (const entry of value.updates) {
        if (!entry || !validId(entry.projectId) || !validId(entry.id) || !Number.isSafeInteger(entry.revision)
          || entry.revision < 1 || entry.revision >= value.nextRevision || revisions.has(entry.revision)
          || !Array.isArray(entry.ops) || !['pending', 'running', 'failed', 'uncertain', 'completed', 'dismissed'].includes(entry.status)) throw new Error('Invalid canvas queue')
        revisions.add(entry.revision)
      }
      return value
    }
    const data: CanvasData = { version: 2, nextRevision: 1, snapshots: {}, updates: [] }
    const legacy = readJson(join(this.dir, 'infinite-canvas-state.json'))
    if (legacy) {
      validateCanvasSnapshot(legacy.snapshot)
      data.activeProjectId = legacy.snapshot.projectId
      data.snapshots[legacy.snapshot.projectId] = { snapshot: legacy.snapshot, updatedAt: legacy.updatedAt }
    }
    const queue = readJson(join(this.dir, 'infinite-canvas-updates.json'))
    if (queue) {
      if (!Array.isArray(queue.updates)) throw new Error('Invalid legacy canvas queue')
      for (const entry of queue.updates) {
        if (!data.activeProjectId || !validId(entry.id) || !Number.isSafeInteger(entry.revision) || entry.revision < 1 || !Array.isArray(entry.ops)) throw new Error('Invalid legacy canvas update')
        // Legacy entries did not record the target project or delivery outcome. Do not replay automatically.
        data.updates.push({ ...entry, projectId: data.activeProjectId, status: 'uncertain', attempt: 0, error: '旧队列未记录项目与执行结果，请核对画布后处理。' })
        data.nextRevision = Math.max(data.nextRevision, entry.revision + 1)
      }
    }
    return data
  }

  private async transaction<T>(mutate: (data: CanvasData) => T): Promise<T> {
    mkdirSync(this.dir, { recursive: true })
    const lockPath = join(this.dir, 'canvas-store.lock')
    const until = Date.now() + 3_000
    let lock!: number
    for (;;) {
      try { lock = openSync(lockPath, 'wx', 0o600); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now() >= until) throw new Error('画布存储正忙；若应用曾异常退出，请关闭所有 Jonwork 进程并备份后检查 canvas-store.lock。')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    const temp = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
      const data = this.read()
      const before = JSON.stringify(data)
      const result = mutate(data)
      const encoded = JSON.stringify(data)
      if (encoded === before && existsSync(this.path)) return result
      if (Buffer.byteLength(encoded) > MAX_BYTES) throw new Error('画布存储已达大小限制，请先导出并归档历史。')
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, encoded); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, this.path)
      return result
    } finally {
      if (existsSync(temp)) unlinkSync(temp)
      closeSync(lock)
      unlinkSync(lockPath)
    }
  }

  state(projectId?: string) {
    if (projectId !== undefined && !validId(projectId)) throw new Error('Invalid canvas project')
    const data = this.read()
    const id = projectId ?? data.activeProjectId
    return { state: id && Object.hasOwn(data.snapshots, id) ? data.snapshots[id] : null, pendingUpdates: data.updates.filter(entry => !['completed', 'dismissed'].includes(entry.status) && (!id || entry.projectId === id)), results: data.updates.filter(entry => entry.result && (!id || entry.projectId === id)).map(entry => ({ revision: entry.revision, projectId: entry.projectId, sessionId: entry.sessionId, summary: entry.summary, workflow: canvasWorkflowFromOps(entry.ops), review: entry.reviews?.at(-1), upstream: entry.upstream, ...entry.result })), stateFile: this.path }
  }

  sessionProject(sessionId: string): string | undefined {
    const bindings = this.read().sessionProjects
    return bindings && Object.hasOwn(bindings, sessionId) ? bindings[sessionId] : undefined
  }

  bindSession(sessionId: string, projectId: string) {
    if (!validId(sessionId) || !validId(projectId)) throw new Error('Invalid canvas session binding')
    return this.transaction(data => {
      if (!Object.hasOwn(data.snapshots, projectId)) throw new Error('画布项目尚未同步。')
      data.sessionProjects ??= {}
      const previous = Object.hasOwn(data.sessionProjects, sessionId) ? data.sessionProjects[sessionId] : undefined
      if (previous && previous !== projectId) throw new Error('该任务已绑定其他画布，请在原画布继续修改。')
      data.sessionProjects[sessionId] = projectId
      return { ok: true }
    })
  }

  save(snapshot: unknown) {
    validateCanvasSnapshot(snapshot)
    return this.transaction(data => {
      const value = { snapshot, updatedAt: new Date().toISOString() }
      data.snapshots[snapshot.projectId] = value
      data.activeProjectId = snapshot.projectId
      return { ok: true, ...value, stateFile: this.path }
    })
  }

  enqueue(sessionId: string, ops: CanvasOp[], summary?: string, projectId?: string, request?: { key: string; fingerprint: string }, upstream?: { revision: number; reviewVersion: number }) {
    if (!Array.isArray(ops) || !ops.length || ops.length > 100 || ops.some(op => !op || !OPS.has(op.type))) throw new Error('ops 需要 1–100 个受支持的画布操作。')
    if (summary !== undefined && (typeof summary !== 'string' || summary.length > 2000)) throw new Error('Invalid canvas summary')
    if (request && (!/^[\w-]{16,128}$/.test(request.key) || !/^[a-f0-9]{64}$/.test(request.fingerprint))) throw new Error('Invalid workflow request')
    return this.transaction(data => {
      const id = projectId ?? data.activeProjectId
      if (request) {
        const previous = data.updates.find(entry => entry.sessionId === sessionId && entry.request?.key === request.key)
        if (previous) {
          if (previous.projectId !== id || previous.request?.fingerprint !== request.fingerprint) throw new Error('同一业务请求标识不能用于不同要求。')
          return previous
        }
      }
      if (data.sessionProjects && Object.hasOwn(data.sessionProjects, sessionId) && data.sessionProjects[sessionId] !== id) throw new Error('任务与目标画布不匹配，请读取原任务的画布上下文。')
      if (!validId(id) || !Object.hasOwn(data.snapshots, id)) throw new Error('画布尚未同步。请先打开“无限画布”并进入一个画布项目。')
      if (upstream) {
        const source = data.updates.find(entry => entry.revision === upstream.revision && entry.projectId === id && entry.sessionId === sessionId && entry.status === 'completed' && entry.result)
        const review = source?.reviews?.at(-1)
        if (!review || review.decision !== 'approved' || review.version !== upstream.reviewVersion) throw new Error('上游成果尚未批准或审查状态已变化，请重新选择成果。')
      }
      if (data.updates.filter(entry => !['completed', 'dismissed'].includes(entry.status)).length >= 500) throw new Error('画布待处理操作过多，请先处理失败任务。')
      if (!Number.isSafeInteger(data.nextRevision + 1)) throw new Error('Canvas revision limit reached')
      const entry: CanvasUpdate = { id: randomUUID(), revision: data.nextRevision++, projectId: id, sessionId, ops, summary, status: 'pending', attempt: 0, createdAt: new Date().toISOString(), ...(request ? { request } : {}), ...(upstream ? { upstream } : {}) }
      data.updates.push(entry)
      return entry
    })
  }

  claim(projectId: string, now = Date.now()) {
    if (!validId(projectId)) throw new Error('Invalid canvas project')
    return this.transaction(data => {
      for (const entry of data.updates) {
        if (entry.status === 'running' && (entry.deadline ?? 0) <= now) {
          entry.status = 'uncertain'; entry.error = '画布未确认执行结果；请核对后处理，不会自动重复执行。'
        }
      }
      const next = data.updates.find(entry => entry.projectId === projectId && !['completed', 'dismissed'].includes(entry.status))
      if (!next || next.status !== 'pending') return { update: null, blocked: next ?? null }
      next.status = 'running'; next.attempt++; next.deliveryToken = randomUUID(); next.deadline = now + 30_000; next.startedAt = now
      return { update: next, blocked: null }
    })
  }

  delivery(revision: number, token: string, projectId: string) {
    const entry = this.read().updates.find(item => item.revision === revision)
    if (!entry || !token || entry.deliveryToken !== token || entry.projectId !== projectId || !['running', 'uncertain', 'completed'].includes(entry.status)) throw new Error('画布确认与当前投递不匹配。')
    return entry
  }

  completedResult(revision: number, projectId: string) {
    const entry = this.read().updates.find(item => item.revision === revision && item.projectId === projectId)
    if (!entry || entry.status !== 'completed' || !entry.result) throw new Error('该版本尚无已保存成果，不能审查或用于下一步。')
    return entry
  }

  reserveProviderTask(revision: number, token: string, projectId: string, nodeId: string, digest: string) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision)
      if (!entry || entry.projectId !== projectId || entry.deliveryToken !== token || entry.status !== 'running') throw new Error('生成请求与当前投递不匹配。')
      if (!/^[\w-]{1,160}$/.test(nodeId) || !entry.ops.some(op => op.type === 'run_generation' && op.nodeId === nodeId)) throw new Error('生成节点不属于原任务。')
      const tasks = entry.providerTasks ??= {}
      const previous = tasks[nodeId]
      if (previous) {
        if (previous.digest !== digest) throw new Error('原任务输入或模型已变化，禁止重复生成。')
        return { created: false, task: previous }
      }
      const task = tasks[nodeId] = { digest, status: 'submitting' as const }
      return { created: true, task }
    })
  }

  completeProviderTask(revision: number, projectId: string, nodeId: string, digest: string) {
    return this.transaction(data => {
      const task = data.updates.find(item => item.revision === revision && item.projectId === projectId)?.providerTasks?.[nodeId]
      if (!task || task.digest !== digest) throw new Error('服务端生成记录不匹配。')
      task.status = 'complete'
    })
  }

  /** Server-only: release a claim ONLY when no provider request was attempted. */
  releaseUndispatchedProviderTask(revision: number, token: string, projectId: string, nodeId: string, digest: string) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId && item.deliveryToken === token)
      const task = entry?.providerTasks?.[nodeId]
      if (!task || task.digest !== digest || task.status !== 'submitting') throw new Error('未派发生成记录不匹配。')
      delete entry!.providerTasks![nodeId]
    })
  }

  reserveModelTask(revision: number, token: string, projectId: string, inputDigest: string) {
    if (!/^[a-f0-9]{64}$/.test(inputDigest)) throw new Error('3D输入校验无效。')
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId && item.deliveryToken === token && item.status === 'running')
      if (!entry || entry.ops.length !== 1 || entry.ops[0]?.type !== 'run_model_generation') throw new Error('3D任务与投递不匹配。')
      if (entry.modelTask) {
        if (entry.modelTask.inputDigest !== inputDigest) throw new Error('3D输入已变化，不能替换原任务材料。')
        return { created: false, task: entry.modelTask }
      }
      entry.modelTask = { inputDigest, status: 'submitting' }
      return { created: true, task: entry.modelTask }
    })
  }

  recordModelTask(revision: number, projectId: string, inputDigest: string, taskId: string) {
    if (!/^[\w-]{1,128}$/.test(taskId)) throw new Error('3D提供商任务编号无效。')
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId)
      if (!entry?.modelTask || entry.modelTask.inputDigest !== inputDigest || (entry.modelTask.taskId && entry.modelTask.taskId !== taskId)) throw new Error('3D任务记录发生冲突。')
      entry.modelTask = { inputDigest, taskId, status: 'created' }
      return entry.modelTask
    })
  }

  /** Never call this after entering the billable provider POST. */
  releaseUndispatchedModelTask(revision: number, token: string, projectId: string, inputDigest: string) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId && item.deliveryToken === token)
      const task = entry?.modelTask
      if (!task || task.inputDigest !== inputDigest || task.status !== 'submitting' || task.taskId) throw new Error('未派发3D记录不匹配。')
      delete entry!.modelTask
    })
  }

  reviewResult(revision: number, projectId: string, request: CanvasReviewRequest, artifactDigest: string) {
    validateCanvasReview(request)
    if (!/^[a-f0-9]{64}$/.test(artifactDigest)) throw new Error('成果校验信息无效。')
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId)
      if (!entry || entry.status !== 'completed' || !entry.result) throw new Error('该版本尚无已保存成果，不能审查。')
      const reviews = entry.reviews ??= []
      const previous = reviews.find(review => review.requestId === request.requestId)
      if (previous) {
        if (previous.decision !== request.decision || previous.comment !== request.comment || previous.expectedVersion !== request.expectedVersion || JSON.stringify(previous.checks) !== JSON.stringify(request.checks) || previous.artifactDigest !== artifactDigest) throw new Error('同一审查请求不能修改内容，请刷新后重新提交。')
        return previous
      }
      if ((reviews.at(-1)?.version ?? 0) !== request.expectedVersion) throw new Error('该版本已被重新审查，请刷新后核对最新状态。')
      if (reviews.length >= 200) throw new Error('本版本审查记录过多，请创建新的成果版本。')
      const review: CanvasReview = { ...request, checks: [...request.checks], artifactDigest, version: request.expectedVersion + 1, reviewedAt: new Date().toISOString() }
      reviews.push(review)
      return review
    })
  }

  heartbeat(revision: number, token: string, projectId: string, now = Date.now()) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision)
      if (!entry || !token || entry.deliveryToken !== token || entry.projectId !== projectId || entry.status !== 'running') throw new Error('画布任务不再运行。')
      if (now - (entry.startedAt ?? Date.parse(entry.createdAt)) > 30 * 60_000) throw new Error('任务执行时间过长，请检查画布。')
      entry.deadline = now + 30_000
      return { deadline: entry.deadline }
    })
  }

  settle(revision: number, deliveryToken: string, projectId: string, snapshot?: unknown, error?: string, result?: CanvasUpdate['result']) {
    if (snapshot !== undefined) validateCanvasSnapshot(snapshot)
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision)
      if (!entry || entry.projectId !== projectId || entry.deliveryToken !== deliveryToken || !deliveryToken) throw new Error('画布确认与当前投递不匹配。')
      if (entry.status === 'completed') return { ok: true, result: entry.result }
      if (!['running', 'uncertain'].includes(entry.status)) throw new Error('画布操作已结束。')
      if (error !== undefined) {
        entry.status = 'failed'; entry.error = String(error).slice(0, 1000)
      } else {
        if (!snapshot || (snapshot as CanvasSnapshot).projectId !== entry.projectId) throw new Error('完成画布操作必须提供同一项目的快照。')
        data.snapshots[entry.projectId] = { snapshot: snapshot as CanvasSnapshot, updatedAt: new Date().toISOString() }
        entry.status = 'completed'; delete entry.error
        if (result) entry.result = result
      }
      return { ok: true, result: entry.result }
    })
  }

  retry(revision: number, projectId: string) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId)
      if (!entry || !['failed', 'uncertain'].includes(entry.status)) throw new Error('只有失败或结果未知的操作可重试。')
      // Generation may incur charges and partially-applied mutations may not be idempotent.
      const resumableModel = entry.ops.length === 1 && entry.ops[0]?.type === 'run_model_generation' && entry.modelTask?.taskId
      if (!resumableModel && entry.ops.some(op => !['set_viewport', 'select_nodes'].includes(op.type))) throw new Error('此操作可能已部分执行，不能直接重试；请检查画布并创建修正任务。')
      entry.status = 'pending'; delete entry.deliveryToken; delete entry.deadline; delete entry.error
      return { ok: true }
    })
  }

  dismiss(revision: number, projectId: string) {
    return this.transaction(data => {
      const entry = data.updates.find(item => item.revision === revision && item.projectId === projectId)
      if (!entry || !['failed', 'uncertain'].includes(entry.status)) throw new Error('只有失败或结果未知的操作可人工跳过。')
      entry.status = 'dismissed'
      entry.error = '用户已核对并跳过；不代表执行成功，也不撤销操作或费用。'
      return { ok: true }
    })
  }
}
