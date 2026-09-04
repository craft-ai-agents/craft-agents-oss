import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAppShellContext } from '@/context/AppShellContext'
import { useTheme } from '@/context/ThemeContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { CanvasResultReview, type CanvasResult } from '@/components/canvas/CanvasResultReview'
import { takeCanvasWorkflow } from '@/components/canvas/canvas-launch'
import type { CanvasWorkflowRequest } from '@craft-agent/session-tools-core/canvas-workflows'

const SOURCE = 'jonwork-infinite-canvas'
const CanvasModelPreview = lazy(() => import('@/components/canvas/CanvasModelPreview'))

type CanvasMessage = {
  source: typeof SOURCE
  type: 'ready' | 'snapshot' | 'projects' | 'create-session' | 'ops-applied' | 'ops-failed' | 'ops-progress' | 'open-session' | 'model-generation' | 'provider-generation' | 'managed-ready' | 'managed-new-project'
  nodeId?: string
  providerRequestId?: string
  images?: Array<{ nodeId: string; mimeType: string; base64: string }>
  modelRequestId?: string
  image?: { mimeType: string; base64: string }
  requestId?: string
  revision?: number
  prompt?: string
  snapshot?: any
  projects?: Array<{ id: string; title: string; updatedAt: string }>
  activeProjectId?: string
  error?: string
  progress?: string
  artifacts?: unknown[]
  nodeIds?: string[]
  upstreamRevision?: number
  sessionId?: string
  workflow?: { id: string; inputIds: string[]; requirements: string; count: number; maskDataUrl?: string }
}

function structured(result: any) {
  if (result?.isError) throw new Error(result.content?.[0]?.text || '画布服务调用失败')
  return result?.structuredContent || {}
}

export default function CanvasPage() {
  const { activeWorkspaceId, onOpenFile } = useAppShellContext()
  const { resolvedMode } = useTheme()
  const { navigateToSession } = useNavigation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const inFlightRevision = useRef<number | null>(null)
  const delivery = useRef<{ revision: number; token: string; projectId: string; deadline: number } | null>(null)
  const activeProjectId = useRef('')
  const blockedRevision = useRef<number | null>(null)
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [loaded, setLoaded] = useState(false)
  const [blocked, setBlocked] = useState<{ revision: number; projectId: string; error?: string; sessionId?: string; workflow?: CanvasWorkflowRequest } | null>(null)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<CanvasResult[]>([])
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null)
  const result = results.find(item => item.revision === selectedRevision) || results.at(-1)
  const [retryReceipt, setRetryReceipt] = useState<{ workspaceId: string; revision: number; deliveryToken: string; projectId: string; snapshot: unknown; artifacts?: unknown[]; nodeIds?: string[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [modelPreview, setModelPreview] = useState<string | null>(null)
  const [managed, setManaged] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState('')
  const [businessProjects, setBusinessProjects] = useState<Array<{ id: string; name: string }>>([])
  const [businessProjectId, setBusinessProjectId] = useState('')
  const bootstrap = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    let disposed = false
    setManaged(null); setSetupError(''); setBusinessProjectId(''); bootstrap.current = null
    if (activeWorkspaceId) void (async () => {
      const capabilities = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'get_infinite_canvas_capabilities', {}))
      if (disposed) return
      setManaged(capabilities.managed === true)
      if (capabilities.managed) {
        const projects = await window.electronAPI.getProjects(activeWorkspaceId) as Array<{ config: { id: string; name: string; archivedAt?: string } }>
        if (!disposed) setBusinessProjects(projects.filter(p => !p.config.archivedAt).map(p => ({ id: p.config.id, name: p.config.name })))
      }
    })().catch(error => { if (!disposed) setSetupError(error instanceof Error ? error.message : '无法读取企业画布配置') })
    return () => { disposed = true }
  }, [activeWorkspaceId])

  const openBusinessProject = async (id: string) => {
    if (!activeWorkspaceId || delivery.current || retryReceipt) return
    await saveQueue.current
    const state = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'get_infinite_canvas_state', { projectId: id }))
    bootstrap.current = state.state?.snapshot || { projectId: id, title: businessProjects.find(p => p.id === id)?.name || '业务画布', nodes: [], connections: [], viewport: { x: 0, y: 0, k: 1 } }
    activeProjectId.current = id; setResults([]); setBlocked(null); setBusinessProjectId(id); setLoaded(false)
  }

  useEffect(() => {
    activeProjectId.current = ''
    inFlightRevision.current = null
    delivery.current = null
    blockedRevision.current = null
    setBlocked(null)
    setLoaded(false)
    setResults([]); setSelectedRevision(null)
    setProgress('')
    setRetryReceipt(null)
    setModelPreview(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data as CanvasMessage
      if (!message || message.source !== SOURCE) return

      try {
        if (!activeWorkspaceId) throw new Error('当前没有活动工作区')
        if (message.type === 'managed-ready') {
          if (managed && bootstrap.current) (event.source as Window).postMessage({ source: SOURCE, type: 'managed-open', snapshot: bootstrap.current }, '*')
          return
        }
        if (message.type === 'managed-new-project') { toast.info('请使用画布上方的新建业务项目按钮。'); return }
        if (message.type === 'provider-generation') {
          const current = delivery.current, target = event.source as Window
          try {
            if (!managed || !current || current.token !== message.requestId || current.revision !== message.revision || current.projectId !== activeProjectId.current) throw new Error('生成请求与当前业务投递不匹配。')
            const until = Date.now() + 140_000
            while (Date.now() < until) {
              if (delivery.current?.token !== current.token || target !== iframeRef.current?.contentWindow) throw new Error('原画布已关闭，请核对服务端结果。')
              const receipt = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'advance_infinite_canvas_provider', { revision: current.revision, deliveryToken: current.token, projectId: current.projectId, nodeId: message.nodeId, images: message.images }))
              if (receipt.status === 'completed') { target.postMessage({ source: SOURCE, type: 'provider-result', providerRequestId: message.providerRequestId, artifacts: receipt.artifacts }, '*'); return }
              await new Promise(resolve => setTimeout(resolve, 2000))
            }
            throw new Error('生成等待超时；请核对原任务，不要重新生成。')
          } catch (cause) { target.postMessage({ source: SOURCE, type: 'provider-result', providerRequestId: message.providerRequestId, error: cause instanceof Error ? cause.message : '服务端生成失败' }, '*') }
          return
        }
        if (message.type === 'model-generation') {
          const current = delivery.current, target = event.source as Window
          if (!current || current.token !== message.requestId || current.revision !== message.revision || current.projectId !== activeProjectId.current) throw new Error('3D请求与当前投递不匹配。')
          try {
            const until = Date.now() + 24 * 60_000
            while (Date.now() < until) {
              if (delivery.current?.token !== current.token || activeProjectId.current !== current.projectId || target !== iframeRef.current?.contentWindow) throw new Error('原画布已关闭或切换，请回原画布继续获取3D结果。')
              const step = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'advance_infinite_canvas_model', { revision: current.revision, deliveryToken: current.token, projectId: current.projectId, image: message.image }))
              if (step.status === 'completed') { target.postMessage({ source: SOURCE, type: 'model-result', modelRequestId: message.modelRequestId, artifact: step.artifact }, '*'); return }
              setProgress(`3D供应商任务执行中：${step.progress || 0}%；不会重复创建。`)
              await new Promise(resolve => setTimeout(resolve, 5000))
            }
            throw new Error('3D等待超时，请稍后继续获取原任务结果。')
          } catch (cause) {
            target.postMessage({ source: SOURCE, type: 'model-result', modelRequestId: message.modelRequestId, error: cause instanceof Error ? cause.message : '3D生成失败' }, '*')
          }
          return
        }
        if (message.type === 'ready') {
          setLoaded(true)
          iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'set-theme', theme: resolvedMode }, '*')
        }

        if (message.type === 'projects') {
          if (activeProjectId.current !== message.activeProjectId) { setResults([]); setSelectedRevision(null) }
          activeProjectId.current = message.activeProjectId || ''
          window.dispatchEvent(new CustomEvent('jonwork:canvas-projects', {
            detail: { projects: message.projects || [], activeProjectId: message.activeProjectId || '' },
          }))
        }

        if (message.type === 'snapshot' && message.snapshot) {
          const projectId = String(message.snapshot.projectId || '')
          if (!projectId) throw new Error('画布快照缺少项目标识')
          if (managed && projectId !== businessProjectId) throw new Error('请从服务器业务项目入口打开画布，旧画布不迁移。')
          activeProjectId.current = projectId
          const workflowId = takeCanvasWorkflow(activeWorkspaceId)
          if (workflowId) iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'select-workflow', workflowId }, '*')
          // Serialize writes; a failed save is visible and does not poison subsequent saves.
          saveQueue.current = saveQueue.current.then(async () => {
            structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'save_infinite_canvas_state', { snapshot: message.snapshot }))
          }).catch(() => toast.error('画布保存失败，请勿关闭窗口并检查存储状态。'))
        }

        if (message.type === 'create-session') {
          const prompt = String(message.prompt || '').trim()
          if (!prompt) throw new Error('请输入画布任务')
          if (!message.snapshot?.projectId || message.snapshot.projectId !== activeProjectId.current) throw new Error('当前画布尚未同步，请稍后重试。')
          await saveQueue.current
          structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'save_infinite_canvas_state', { snapshot: message.snapshot }))
          const existing = message.sessionId ? await window.electronAPI.getSessionMessages(message.sessionId) : null
          if (message.sessionId && (!existing || existing.workspaceId !== activeWorkspaceId)) throw new Error('原任务不存在或工作区已切换，请重新打开画布。')
          const session = existing || await window.electronAPI.createSession(activeWorkspaceId, {
            name: `无限画布：${prompt.slice(0, 24)}`,
            ...(managed ? { projectId: message.snapshot.projectId } : { workingDirectory: 'user_default' }),
          })
          structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'bind_infinite_canvas_session', { sessionId: session.id, projectId: message.snapshot.projectId }))
          const canvasPrompt = `你正在操作 Jonwork 内嵌的 basketikun/infinite-canvas。本任务绑定画布 ${message.snapshot.projectId}。必须先调用 get_canvas_context 读取该画布，再用 apply_canvas_ops 完成所有新建、更新、移动、连接、删除或生成操作；不要只输出操作建议。生成后再次读取上下文的 results 获得原任务成果文件，不将 queued 当作生成成功。\n\n用户任务：${prompt}`
          iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'session-created', requestId: message.requestId, sessionId: session.id }, '*')
          if (message.workflow) {
            structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'run_infinite_canvas_workflow', {
              sessionId: session.id, projectId: message.snapshot.projectId, requestId: message.requestId, workflow: message.workflow, upstreamRevision: message.upstreamRevision,
            }))
          } else await window.electronAPI.sendMessage(session.id, canvasPrompt)
          iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'session-result', requestId: message.requestId, ok: true, sessionId: session.id }, '*')
          toast.success(message.workflow ? '业务生成已排队' : '已提交画布会话', { description: '请保持当前画布打开，真实成果保存后会显示查看入口。' })
        }
        if (message.type === 'open-session' && message.sessionId) {
          if (delivery.current || retryReceipt) throw new Error('请先等待生成完成并保存成果，再打开原任务。')
          const session = await window.electronAPI.getSessionMessages(message.sessionId)
          if (session?.workspaceId !== activeWorkspaceId) throw new Error('无权打开此任务。')
          navigateToSession(message.sessionId)
        }

        if ((message.type === 'ops-applied' || message.type === 'ops-failed') && Number.isFinite(message.revision)) {
          const revision = Number(message.revision)
          const current = delivery.current
          if (!current || current.revision !== revision || message.requestId !== current.token) return
          const projectId = current.projectId
          const confirmation = saveQueue.current.then(async () => structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'ack_infinite_canvas_update', {
              revision, deliveryToken: current.token, projectId,
              ...(message.type === 'ops-applied' ? { snapshot: message.snapshot, artifacts: message.artifacts, nodeIds: message.nodeIds } : { error: message.error || '画布未能应用操作' }),
            })))
          saveQueue.current = confirmation.catch(() => undefined)
          const receipt = await confirmation
          setRetryReceipt(null)
          setProgress('')
          if (receipt.result) {
            if (activeProjectId.current === projectId) { setResults(previous => [...previous.filter(item => item.revision !== revision), { ...receipt.result, revision, projectId, sessionId: receipt.sessionId }]); setSelectedRevision(revision) }
            toast.success('生成成果已保存到原任务', { description: '请查看成果并审查，尚未标记为最终定稿。' })
          }
          if (delivery.current?.token === current.token) {
            inFlightRevision.current = null
            delivery.current = null
          }
          if (message.type === 'ops-failed') toast.error('画布回写失败', { description: message.error })
        }
        if (message.type === 'ops-progress' && delivery.current && delivery.current.token === message.requestId && delivery.current.revision === message.revision) {
          const current = delivery.current
          setProgress(message.progress || '正在生成…')
          const receipt = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'heartbeat_infinite_canvas_update', { revision: current.revision, deliveryToken: current.token, projectId: current.projectId }))
          if (delivery.current?.token === current.token) current.deadline = receipt.deadline
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (message.type === 'ops-applied' && activeWorkspaceId && delivery.current && delivery.current.token === message.requestId) {
          const current = delivery.current
          setProgress('图片已生成，但成果保存失败；请重试保存，不必重新生成。')
          setRetryReceipt({ workspaceId: activeWorkspaceId, revision: current.revision, deliveryToken: current.token, projectId: current.projectId, snapshot: message.snapshot, artifacts: message.artifacts, nodeIds: message.nodeIds })
        }
        if (message.type === 'create-session') {
          iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'session-result', requestId: message.requestId, ok: false, error: text }, '*')
        }
        if (message.type === 'model-generation') (event.source as Window)?.postMessage({ source: SOURCE, type: 'model-result', modelRequestId: message.modelRequestId, error: text }, '*')
        toast.error('无限画布操作失败', { description: text })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [activeWorkspaceId, resolvedMode, navigateToSession, retryReceipt, managed, businessProjectId])

  useEffect(() => {
    const handleCanvasProjectOpen = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId
      if (!projectId) return
      if (managed) { void openBusinessProject(projectId).catch(error => toast.error(String(error))); return }
      iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'open-project', projectId }, '*')
    }
    window.addEventListener('jonwork:canvas-project-open', handleCanvasProjectOpen)
    return () => window.removeEventListener('jonwork:canvas-project-open', handleCanvasProjectOpen)
  }, [managed, activeWorkspaceId, businessProjects, retryReceipt])

  useEffect(() => {
    if (!loaded) return
    iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'set-theme', theme: resolvedMode }, '*')
  }, [loaded, resolvedMode])

  useEffect(() => {
    if (!activeWorkspaceId || !loaded) return
    let disposed = false
    let polling = false
    const poll = async () => {
      if (disposed || polling) return
      if (delivery.current && delivery.current.deadline <= Date.now()) inFlightRevision.current = null
      if (inFlightRevision.current !== null) return
      polling = true
      try {
        const projectId = activeProjectId.current
        if (!projectId) return
        const payload = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'get_infinite_canvas_updates', { projectId }))
        if (disposed) return
        if (activeProjectId.current !== projectId) return
        setResults(payload.results || [])
        setBlocked(payload.blocked || null)
        if (payload.blocked && blockedRevision.current !== Number(payload.blocked.revision)) {
          blockedRevision.current = Number(payload.blocked.revision)
          toast.error('画布任务需要人工处理', { description: payload.blocked.error || '上一项操作失败或结果未知，已停止后续执行。' })
        }
        const next = payload.updates?.[0]
        if (!next) return
        // Project changed while claiming: do not deliver to the wrong canvas. Lease becomes uncertain.
        if (activeProjectId.current !== next.projectId) return
        inFlightRevision.current = Number(next.revision)
        delivery.current = { revision: next.revision, token: next.deliveryToken, projectId: next.projectId, deadline: next.deadline }
        setProgress('正在执行画布任务…')
        iframeRef.current?.contentWindow?.postMessage({
          source: SOURCE, type: 'apply-ops', requestId: next.deliveryToken, revision: next.revision, projectId: next.projectId, ops: next.ops,
        }, '*')
      } catch (error) {
        console.error('Failed to poll infinite canvas updates', error)
      } finally {
        polling = false
      }
    }
    void poll()
    const interval = window.setInterval(poll, 1000)
    return () => { disposed = true; window.clearInterval(interval) }
  }, [activeWorkspaceId, loaded])

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {setupError && <div role="alert" className="p-4">{setupError}</div>}
      {managed && <div className="flex items-center gap-3 border-b p-3 text-sm">
        <select aria-label="服务器业务项目" value={businessProjectId} disabled={Boolean(progress || retryReceipt)} onChange={event => void openBusinessProject(event.target.value).catch(error => toast.error(String(error)))}>
          <option value="" disabled>请选择业务项目（不读取或迁移旧画布）</option>
          {businessProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button disabled={Boolean(progress || retryReceipt)} onClick={async () => {
          const name = window.prompt('新业务项目名称')?.trim(); if (!name || !activeWorkspaceId) return
          try { const project = await window.electronAPI.createProject(activeWorkspaceId, { name }); setBusinessProjects(previous => [...previous, { id: project.id, name: project.name }]); await openBusinessProject(project.id) }
          catch (error) { toast.error(String(error)) }
        }}>新建业务项目</button>
        <span>服务端生成和计费 · 成果待审查</span>
      </div>}
      {modelPreview && <Suspense fallback={<div role="status">正在载入3D预览…</div>}><CanvasModelPreview path={modelPreview} onClose={() => setModelPreview(null)} /></Suspense>}
      {progress && !blocked && <div role="status" className="border-b p-3 text-sm text-muted-foreground">{progress}</div>}
      {result && <CanvasResultReview key={`${activeWorkspaceId}:${result.projectId}`} results={results} selected={result} locked={Boolean(progress || retryReceipt || blocked)} onSelect={setSelectedRevision} onOpen={path => path.endsWith('.glb') ? setModelPreview(path) : onOpenFile(path)} onFolder={path => window.electronAPI.showInFolder(path)} onTask={navigateToSession}
        onReview={async (selected, review) => {
          if (!activeWorkspaceId || selected.projectId !== activeProjectId.current || delivery.current || retryReceipt) throw new Error('请先保存当前任务并返回原画布，再审查。')
          const receipt = structured(await window.electronAPI.callCanvasTool(activeWorkspaceId, 'review_infinite_canvas_result', { revision: selected.revision, projectId: selected.projectId, review }))
          if (selected.projectId === activeProjectId.current) setResults(previous => previous.map(item => item.revision === selected.revision ? { ...item, review: receipt.review } : item))
          toast.success(review.decision === 'approved' ? '已批准所选版本，新成果仍需重新审查。' : '修改意见已保存；点击“按意见继续修改”填写下一次任务。')
        }}
        onContinue={(selected, revisionRequest) => {
          if (delivery.current || retryReceipt || selected.projectId !== activeProjectId.current) return
          iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'prepare-business-input', projectId: selected.projectId, revision: selected.revision, upstreamRevision: revisionRequest ? selected.upstream?.revision : selected.revision, sessionId: selected.sessionId, nodeIds: revisionRequest && selected.workflow ? selected.workflow.inputIds : selected.nodeIds || [], imageResult: !!selected.imageKeys?.length, workflow: selected.workflow, revisionRequest, comment: selected.review?.comment || '', previewPath: selected.previewPath }, '*')
        }} />}
      {retryReceipt && <div role="alert" className="border-b p-3 text-sm">
        成果尚未保存，请勿关闭窗口。
        <button className="ml-4 underline" disabled={saving} onClick={async () => {
          if (retryReceipt.workspaceId !== activeWorkspaceId) return
          setSaving(true)
          try {
            const receipt = structured(await window.electronAPI.callCanvasTool(retryReceipt.workspaceId, 'ack_infinite_canvas_update', retryReceipt))
            if (receipt.result && activeProjectId.current === retryReceipt.projectId) setResults(previous => [...previous.filter(item => item.revision !== retryReceipt.revision), { ...receipt.result, revision: retryReceipt.revision, projectId: retryReceipt.projectId, sessionId: receipt.sessionId }])
            setRetryReceipt(null); setBlocked(null); setProgress(''); delivery.current = null; inFlightRevision.current = null
            toast.success('成果已保存，没有重新调用生成服务。')
          } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败') }
          finally { setSaving(false) }
        }}>{saving ? '正在保存…' : '仅重试保存成果'}</button>
      </div>}
      {blocked && <div role="alert" className="border-b bg-destructive/10 p-3 text-sm">
        <p>画布操作 #{blocked.revision} 已暂停：{blocked.error || '等待确认执行结果'}</p>
        {blocked.workflow && <button className="mr-4 underline" onClick={() => iframeRef.current?.contentWindow?.postMessage({ source: SOURCE, type: 'prepare-business-input', projectId: blocked.projectId, revision: blocked.revision, sessionId: blocked.sessionId, workflow: blocked.workflow, nodeIds: blocked.workflow!.inputIds, revisionRequest: true, comment: '请核对失败原因及已生成的部分结果，再修改本次需求。' }, '*')}>恢复原需求并修改</button>}
        <button className="mr-4 underline" onClick={async () => {
          try {
            structured(await window.electronAPI.callCanvasTool(activeWorkspaceId!, 'retry_infinite_canvas_update', blocked))
            setBlocked(null)
          } catch (error) { toast.error(error instanceof Error ? error.message : '无法重试') }
        }}>重试安全操作 / 继续获取3D结果</button>
        <button className="underline" onClick={async () => {
          if (!window.confirm('请先核对画布。此操作仅将该队列项标记为已人工跳过，保留历史，不撤销已发生的操作或费用。继续？')) return
          try {
            structured(await window.electronAPI.callCanvasTool(activeWorkspaceId!, 'dismiss_infinite_canvas_update', blocked))
            setBlocked(null); delivery.current = null; inFlightRevision.current = null
          } catch (error) { toast.error(error instanceof Error ? error.message : '无法处理') }
        }}>已核对，跳过此项</button>
      </div>}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {!loaded && <div className="absolute inset-0 z-10 flex items-center justify-center bg-background text-muted-foreground">{managed && !businessProjectId ? '请先选择或新建服务器业务项目。旧画布保持原样。' : setupError ? '画布配置读取失败，请重开页面后重试。' : <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在载入 infinite-canvas…</>}</div>}
        {managed !== null && (!managed || businessProjectId) && <iframe
          key={`${activeWorkspaceId}:${businessProjectId}`}
          ref={iframeRef}
          title="infinite-canvas"
          src={managed ? `./infinite-canvas/index.html?managed=${encodeURIComponent(activeWorkspaceId!)}#/canvas?jonwork=1` : './infinite-canvas/index.html#/canvas?mode=recent&jonwork=1'}
          onLoad={() => setLoaded(true)}
          className="h-full w-full border-0 bg-background"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads allow-pointer-lock"
        />}
      </div>
    </div>
  )
}
