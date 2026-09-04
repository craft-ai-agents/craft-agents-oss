import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { CanvasStore, validateCanvasSnapshot } from '@craft-agent/session-tools-core/canvas-store'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { publishCanvasDeliverables, inspectCanvasDeliverables, publishCanvasReview } from '../../webui/canvas-deliverables'
import { planCanvasWorkflow, canvasWorkflowFromOps } from '@craft-agent/session-tools-core/canvas-workflows'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { canvasBusinessArtifacts } from '../../webui/canvas-business-result'
import { advanceCanvasModel, canvasModelConfigured } from '../../webui/canvas-model'

export function registerCanvasHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.canvas.CALL_TOOL, async (_ctx, workspaceId: string, toolName: string, rawArgs?: Record<string, any>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const args = rawArgs || {}
    const store = new CanvasStore(workspace.rootPath)

    const result = async (): Promise<any> => {
      switch (toolName) {
        case 'get_infinite_canvas_capabilities': return { managed: false }
        case 'run_infinite_canvas_workflow': {
          if (args.workflow?.briefConfirmed !== true) throw new Error('请核对材料、业务要求与输出数量，并确认本次需求。')
          if (args.workflow?.id === 'image-to-3d' && !canvasModelConfigured()) throw new Error('图片转3D尚未配置。请管理员在服务端设置 JONWORK_MESHY_API_KEY 并重启；不要将密钥写入任务。')
          const session = await deps.sessionManager.getSession(String(args.sessionId || ''))
          if (!session || session.workspaceId !== workspace.id) throw new Error('原任务不属于当前工作区。')
          const projectId = String(args.projectId || '')
          if (store.sessionProject(session.id) !== projectId) throw new Error('业务任务未绑定当前画布。')
          const snapshot = store.state(projectId).state?.snapshot
          if (!snapshot) throw new Error('请先打开并同步当前画布。')
          let upstreamText = ''
          let upstream
          if (args.upstreamRevision !== undefined) {
            const source = store.completedResult(Number(args.upstreamRevision), projectId)
            const review = source.reviews?.at(-1)
            const path = deps.sessionManager.getSessionPath(source.sessionId)
            if (source.sessionId !== session.id || !path || review?.decision !== 'approved') throw new Error('请选择原任务中已批准的上游成果。')
            const inspected = inspectCanvasDeliverables(path, source.revision)
            if (inspected.digest !== review.artifactDigest) throw new Error('上游成果已变化，请重新审查。')
            if (source.result?.imageKeys?.length && (!Array.isArray(args.workflow.inputIds) || !args.workflow.inputIds.some((id: string) => source.result?.imageKeys?.includes((snapshot.nodes.find((node: any) => node.id === id) as any)?.metadata?.storageKey)))) throw new Error('请选择至少一张未被替换的上游成果图片作为本次输入；图片组请先展开。')
            upstreamText = inspected.files.filter(file => file.endsWith('.md')).map(file => readFileSync(file, 'utf8')).join('\n\n')
            if (upstreamText.length > 48000) throw new Error('上游报告超过48000字符，请先在原任务形成已审查的精简版本。')
            upstream = { revision: source.revision, reviewVersion: review.version }
          }
          const plan = planCanvasWorkflow(snapshot, args.workflow, String(args.requestId || ''), upstreamText)
          const fingerprint = createHash('sha256').update(JSON.stringify({ projectId, workflow: args.workflow, upstreamRevision: args.upstreamRevision })).digest('hex')
          const entry = await store.enqueue(session.id, plan.ops, plan.summary, projectId, { key: args.requestId, fingerprint }, upstream)
          return { queued: true, revision: entry.revision, sessionId: session.id }
        }
        case 'advance_infinite_canvas_model': {
          const entry = store.delivery(Number(args.revision), String(args.deliveryToken || ''), String(args.projectId || ''))
          const session = await deps.sessionManager.getSession(entry.sessionId)
          if (!session || session.workspaceId !== workspace.id) throw new Error('3D原任务不属于当前工作区。')
          return advanceCanvasModel(store, { revision: entry.revision, deliveryToken: entry.deliveryToken!, projectId: entry.projectId, image: args.image })
        }
        case 'bind_infinite_canvas_session': {
          const session = await deps.sessionManager.getSession(String(args.sessionId || ''))
          if (!session || session.workspaceId !== workspace.id) throw new Error('原任务不属于当前工作区。')
          return store.bindSession(session.id, String(args.projectId || ''))
        }
        case 'review_infinite_canvas_result': {
          const entry = store.completedResult(Number(args.revision), String(args.projectId || ''))
          const session = await deps.sessionManager.getSession(entry.sessionId)
          const path = deps.sessionManager.getSessionPath(entry.sessionId)
          if (!session || session.workspaceId !== workspace.id || !path) throw new Error('原任务不属于当前工作区。')
          const { digest } = inspectCanvasDeliverables(path, entry.revision)
          const review = await store.reviewResult(entry.revision, entry.projectId, args.review, digest)
          const reviewPath = publishCanvasReview(path, entry.revision, review)
          return { review, reviewPath, revision: entry.revision, sessionId: entry.sessionId }
        }
        case 'get_infinite_canvas_state': {
          return store.state(typeof args.projectId === 'string' ? args.projectId : undefined)
        }
        case 'save_infinite_canvas_state': {
          return store.save(args.snapshot)
        }
        case 'get_infinite_canvas_updates': {
          const claimed = await store.claim(String(args.projectId || ''))
          return { updates: claimed.update ? [claimed.update] : [], blocked: claimed.blocked ? { ...claimed.blocked, workflow: canvasWorkflowFromOps(claimed.blocked.ops) } : null, results: store.state(String(args.projectId || '')).results }
        }
        case 'ack_infinite_canvas_update': {
          const entry = store.delivery(Number(args.revision), String(args.deliveryToken || ''), String(args.projectId || ''))
          if (entry.status === 'completed') return { ok: true, result: entry.result, sessionId: entry.sessionId }
          let result
          if (args.error === undefined && entry.ops.some(op => ['run_generation', 'run_model_generation'].includes(op.type))) {
            validateCanvasSnapshot(args.snapshot)
            if (args.snapshot.projectId !== entry.projectId) throw new Error('生成结果与原画布项目不匹配。')
            const session = await deps.sessionManager.getSession(entry.sessionId)
            const path = deps.sessionManager.getSessionPath(entry.sessionId)
            if (!session || session.workspaceId !== workspace.id || !path) throw new Error('原始任务不存在或不属于当前工作区，无法保存成果。')
            const nodeIds = Array.isArray(args.nodeIds) ? args.nodeIds : []
            if (nodeIds.length > 20 || nodeIds.some((id: unknown) => typeof id !== 'string' || !args.snapshot.nodes.some((node: any) => node.id === id && ['image', 'text'].includes(node.type) && node.metadata?.status === 'success'))) throw new Error('成果节点引用无效。')
            const imageKeys = args.snapshot.nodes.filter((node: any) => nodeIds.includes(node.id) && node.type === 'image').flatMap((node: any) => node.metadata?.images?.length ? node.metadata.images.map((image: any) => image.storageKey) : [node.metadata?.storageKey]).filter((key: unknown) => typeof key === 'string' && key)
            const output = publishCanvasDeliverables(path, entry.revision, canvasBusinessArtifacts(entry, args.artifacts))
            result = { ...output, nodeIds: [...new Set<string>(nodeIds)], imageKeys: [...new Set<string>(imageKeys)] }
          }
          return { ...await store.settle(entry.revision, entry.deliveryToken!, entry.projectId, args.snapshot, args.error, result), sessionId: entry.sessionId }
        }
        case 'heartbeat_infinite_canvas_update': {
          return store.heartbeat(Number(args.revision), String(args.deliveryToken || ''), String(args.projectId || ''))
        }
        case 'retry_infinite_canvas_update': {
          return store.retry(Number(args.revision), String(args.projectId || ''))
        }
        case 'dismiss_infinite_canvas_update': {
          return store.dismiss(Number(args.revision), String(args.projectId || ''))
        }
        default:
          throw new Error(`Unsupported infinite-canvas tool: ${toolName}`)
      }
    }

    try {
      return { content: [], structuredContent: await result(), isError: false }
    } catch (error) {
      deps.platform.logger.error(`Infinite canvas tool ${toolName} failed`, error)
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true }
    }
  })
}
