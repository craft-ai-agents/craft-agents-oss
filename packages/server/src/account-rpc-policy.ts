import { getWorkspaces } from '@craft-agent/shared/config'
import { RPC_CHANNELS, type PushTarget } from '@craft-agent/shared/protocol'
import { resolveManagedDefaultModel, type AccountStore, type ErpControlRuntime } from '@craft-agent/server-core/webui'
import type { HandlerFn, RpcServer } from '@craft-agent/server-core/transport'
import { join, isAbsolute, resolve } from 'node:path'
import { AccountSkillLibrary, GLOBAL_AGENT_SKILLS_DIR, assertSkillPath } from '@craft-agent/shared/skills'
import { CanvasStore } from '@craft-agent/session-tools-core/canvas-store'
import { CANVAS_WORKFLOWS, canvasWorkflowFromOps } from '@craft-agent/session-tools-core/canvas-workflows'
import { advanceCanvasModel, stepCanvasProvider, canvasWorkflowModel, readCanvasProviderArtifacts, rejectUnisolatedAgentExecution } from '@craft-agent/server-core/webui'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'

function requireCanvasSkill(workflowId: unknown, skills: string[]): string {
  if (typeof workflowId !== 'string' || !CANVAS_WORKFLOWS.some(workflow => workflow.id === workflowId)) throw new Error('未知画布业务技能')
  const slug = `jonwork-${workflowId}`
  if (!Array.isArray(skills) || !skills.includes(slug)) throw new Error('ERP 未授权此业务技能')
  return slug
}

// Managed instances expose business operations, not the desktop's server-admin
// API. New channels must be reviewed before being made available to customers.
const MANAGED_CHANNELS = new Set<string>([
  ...Object.values(RPC_CHANNELS.sessions).filter(c => !/import|exportRemoteTransfer/i.test(c)),
  ...Object.values(RPC_CHANNELS.file), ...Object.values(RPC_CHANNELS.fs),
  ...Object.values(RPC_CHANNELS.skills),
  ...Object.values(RPC_CHANNELS.projects), RPC_CHANNELS.canvas.CALL_TOOL,
  RPC_CHANNELS.workspaces.GET, RPC_CHANNELS.server.GET_WORKSPACES,
  RPC_CHANNELS.window.SWITCH_WORKSPACE,
  RPC_CHANNELS.system.VERSIONS, RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.workspace.SETTINGS_GET, RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.statuses.LIST, RPC_CHANNELS.labels.LIST, RPC_CHANNELS.views.LIST,
  RPC_CHANNELS.sources.GET, RPC_CHANNELS.theme.GET_APP, RPC_CHANNELS.theme.GET_PRESETS,
  RPC_CHANNELS.theme.GET_COLOR_THEME, RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES,
  RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME, RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL,
  RPC_CHANNELS.llmConnections.LIST, RPC_CHANNELS.llmConnections.LIST_WITH_STATUS, RPC_CHANNELS.llmConnections.GET,
  RPC_CHANNELS.toolIcons.GET_MAPPINGS, RPC_CHANNELS.logo.GET_URL,
])
const MANAGED_COMMANDS = new Set(['flag','unflag','archive','unarchive','rename','setSessionStatus',
  'markRead','markUnread','setActiveViewing','setThinkingLevel','setSources','setLabels',
  'setKanbanColumn','setConnection','setProjectId','setPendingPlanExecution','markCompactionComplete',
  'markPendingPlanExecutionDispatched','clearPendingPlanExecution','addAnnotation','removeAnnotation','updateAnnotation'])
const MANAGED_CANVAS_TOOLS = new Set(['get_infinite_canvas_state','save_infinite_canvas_state','bind_infinite_canvas_session',
  'get_infinite_canvas_updates','ack_infinite_canvas_update','heartbeat_infinite_canvas_update',
  'review_infinite_canvas_result','dismiss_infinite_canvas_update','run_infinite_canvas_workflow','advance_infinite_canvas_model',
  'advance_infinite_canvas_provider','get_infinite_canvas_capabilities','retry_infinite_canvas_update'])

interface SessionSummary {
  id: string
  workspaceId?: string
  projectId?: string
}

// Positive ownership checks, not a blacklist of currently known foreign IDs.
const SESSION_BOUND_CHANNELS = new Set<string>([
  RPC_CHANNELS.sessions.DELETE, RPC_CHANNELS.sessions.GET_MESSAGES,
  RPC_CHANNELS.sessions.SEND_MESSAGE, RPC_CHANNELS.sessions.CANCEL,
  RPC_CHANNELS.sessions.KILL_SHELL, RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL, RPC_CHANNELS.sessions.COMMAND,
  RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION, RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  RPC_CHANNELS.sessions.GET_MODEL, RPC_CHANNELS.sessions.SET_MODEL,
  RPC_CHANNELS.sessions.GET_FILES, RPC_CHANNELS.sessions.GET_NOTES,
  RPC_CHANNELS.sessions.SET_NOTES, RPC_CHANNELS.sessions.WATCH_FILES,
  RPC_CHANNELS.sessions.EXPORT, RPC_CHANNELS.file.STORE_ATTACHMENT,
])
const WORKSPACE_BOUND_CHANNELS = new Set<string>([
  RPC_CHANNELS.sessions.MARK_ALL_READ, RPC_CHANNELS.sessions.SEARCH_CONTENT,
])

interface SessionLookup {
  getSessions: (workspaceId?: string) => SessionSummary[]
}

const BLOCKED_ACCOUNT_CHANNELS = new Set<string>([
  RPC_CHANNELS.workspaces.CREATE,
  RPC_CHANNELS.workspaces.UPDATE_REMOTE,
])

const FILTERED_WORKSPACE_LIST_CHANNELS = new Set<string>([
  RPC_CHANNELS.workspaces.GET,
  RPC_CHANNELS.server.GET_WORKSPACES,
])

function containsForbiddenId(value: unknown, forbiddenIds: Set<string>): boolean {
  if (typeof value === 'string') return forbiddenIds.has(value)
  if (Array.isArray(value)) return value.some(item => containsForbiddenId(item, forbiddenIds))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(item => containsForbiddenId(item, forbiddenIds))
  }
  return false
}

/**
 * Enforces the WebUI account boundary at the RPC entry point. Desktop and
 * bearer-token clients have no principalId and retain the existing behavior.
 */
export class AccountScopedRpcServer implements RpcServer {
  constructor(
    private readonly inner: RpcServer,
    private readonly accounts: AccountStore,
    private readonly sessions: SessionLookup,
    private readonly control?: ErpControlRuntime,
  ) {}

  handle(channel: string, handler: HandlerFn): void {
    this.inner.handle(channel, async (ctx, ...args) => {
      if (!ctx.principalId || ctx.principalId === 'webui') return handler(ctx, ...args)

      const account = this.accounts.getById(ctx.principalId)
      if (!account || account.disabled) throw new Error('账户不存在、已停用或登录已失效')
      if (ctx.workspaceId !== account.workspaceId) throw new Error('无权访问该工作区')
      if (!MANAGED_CHANNELS.has(channel)) throw new Error('中台模式不开放该管理操作')
      if (SESSION_BOUND_CHANNELS.has(channel)) {
        this.assertSession(account.workspaceId, args[0])
        const root = this.accounts.getSkillWorkspaceRoot(account.id)
        assertSkillPath(root,join(root,'sessions',args[0]))
      }
      if (WORKSPACE_BOUND_CHANNELS.has(channel) && args[0] !== account.workspaceId) throw new Error('无权访问该工作区')
      if ([RPC_CHANNELS.sessions.SEND_MESSAGE, RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
        RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL].includes(channel as any)) {
        // Legacy multi-account sessions have no isolated execution policy. ERP
        // sessions continue into SessionManager's project-scoped tool runtime.
        if (!this.control) rejectUnisolatedAgentExecution()
      }
      if (this.control) {
        const policy = await this.control.policy(account.id)
        if (!policy.active) throw new Error('ERP 授权已停用')
        if (!MANAGED_CHANNELS.has(channel)) throw new Error('中台模式不开放该管理操作')
        if (channel === RPC_CHANNELS.window.SWITCH_WORKSPACE) {
          if (args[0] !== account.workspaceId) throw new Error('无权访问该工作区')
          // Account handshake already binds push routing. Do not mutate the
          // server-global active workspace or register a caller-supplied window.
          return { workspaceId: account.workspaceId }
        }
        if (channel === RPC_CHANNELS.sessions.COMMAND && !MANAGED_COMMANDS.has(args[1]?.type)) throw new Error('中台模式不支持该会话操作')
        if (channel === RPC_CHANNELS.sessions.CREATE) {
          if (args[0] !== account.workspaceId) throw new Error('无权创建该工作区的会话')
          // Preserve business choices, but never caller-selected execution roots.
          const input = args[1] ?? {}
          if (input.parentSessionId || input.branchFromSessionId || input.branchFromMessageId) throw new Error('企业入口暂不开放会话上下文复制，请在目标项目新建空白会话')
          if (input.model !== undefined && !policy.models.includes(input.model)) throw new Error('ERP 未授权此模型')
          if (input.llmConnection) await this.assertConnection(input.llmConnection,policy.models)
          if (!input.projectId) throw new Error('企业会话必须绑定明确的项目')
          const project = await this.assertProject(account.id,input.projectId)
          args[1] = { name: typeof input.name === 'string' ? input.name : undefined,
            model:input.model ?? resolveManagedDefaultModel(policy),llmConnection:input.llmConnection,projectId:input.projectId,
            workingDirectory:project.config.workingDirectory || project.folderPath }
        }
        if (channel === RPC_CHANNELS.sessions.SET_MODEL) {
          if (args[1] !== account.workspaceId || !policy.models.includes(args[2])) throw new Error('ERP 未授权此模型或工作区')
          if (args[3]) await this.assertConnection(args[3],policy.models)
        }
        if (channel === RPC_CHANNELS.sessions.COMMAND) {
          if (args[1].type === 'setConnection') await this.assertConnection(args[1].connectionSlug,policy.models)
          if (args[1].type === 'setProjectId') {
            const session = this.assertSession(account.workspaceId,args[0])
            if ((session.projectId ?? null) !== args[1].projectId) throw new Error('企业会话不能跨项目改绑或解绑，请在目标项目新建会话')
          }
        }
        if (channel === RPC_CHANNELS.canvas.CALL_TOOL) {
          if (args[0] !== account.workspaceId) throw new Error('无权访问该画布工作区')
          if (args[1] === 'get_infinite_canvas_capabilities') return { content: [], structuredContent: { managed: true }, isError: false }
          if (!MANAGED_CANVAS_TOOLS.has(args[1])) throw new Error('中台模式暂未开放未接入服务端计费的画布生成操作')
          const canvasProject = args[1] === 'save_infinite_canvas_state' ? args[2]?.snapshot?.projectId : args[2]?.projectId
          if (typeof canvasProject !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(canvasProject)) throw new Error('必须指定当前画布项目，禁止回退到最近打开的画布')
          // A canvas ID alone is not an authorization scope. Managed canvases
          // must use an existing business project identity; no silent adoption
          // of legacy global canvases into a different project's history.
          if (args[2]?.sessionId !== undefined) {
            const source = this.assertSession(account.workspaceId,args[2].sessionId)
            if (source.projectId !== canvasProject) throw new Error('画布与会话不属于同一业务项目')
          }
          await this.assertProject(account.id,canvasProject)
          const canvasRoot = this.accounts.getSkillWorkspaceRoot(account.id)
          assertSkillPath(canvasRoot,join(canvasRoot,'canvas'))
          const canvasState = new CanvasStore(canvasRoot).state(canvasProject)
          for (const entry of [...canvasState.pendingUpdates,...canvasState.results]) {
            const source = this.assertSession(account.workspaceId,entry.sessionId)
            if (source.projectId !== canvasProject) throw new Error('历史画布包含其他项目上下文；请保留原数据并新建项目，不迁移')
          }
          if (args[1] === 'run_infinite_canvas_workflow') {
            requireCanvasSkill(args[2]?.workflow?.id, policy.skills)
            const model = canvasWorkflowModel(args[2]?.workflow?.id)
            if (!policy.models.includes(model)) throw new Error('ERP 未授权此业务的服务端模型')
          }
          if (args[1] === 'advance_infinite_canvas_provider') {
            const input = args[2] ?? {}, store = new CanvasStore(canvasRoot)
            const entry = store.delivery(Number(input.revision), String(input.deliveryToken ?? ''), canvasProject)
            const source = this.assertSession(account.workspaceId, entry.sessionId)
            if (source.projectId !== canvasProject) throw new Error('原任务与画布不属于同一业务项目')
            const workflowId = canvasWorkflowFromOps(entry.ops)?.id
            const skill = requireCanvasSkill(workflowId, policy.skills)
            const model = canvasWorkflowModel(workflowId!)
            if (!policy.models.includes(model)) throw new Error('ERP 未授权此业务的服务端模型')
            const key = 'canvas-' + createHash('sha256').update(JSON.stringify([account.id, canvasProject, entry.id, entry.revision, input.nodeId])).digest('hex')
            const billing = this.control.providerTask({ workspaceId: account.workspaceId, model, skills: [skill], sources: [] }, key)
            const result = await stepCanvasProvider(store, { revision: entry.revision, deliveryToken: entry.deliveryToken!, projectId: canvasProject, nodeId: input.nodeId, images: input.images }, billing)
            return { content: [], structuredContent: result, isError: false }
          }
          if (args[1] === 'ack_infinite_canvas_update' && args[2]?.error === undefined) {
            const store = new CanvasStore(canvasRoot), input = args[2]
            const entry = store.delivery(Number(input.revision), String(input.deliveryToken ?? ''), canvasProject)
            if (entry.ops.some(op => op.type === 'run_generation')) {
              // Client snapshots carry layout only. Published bytes come from the
              // server's provider record; client-supplied artifacts cannot settle bills.
              args[2] = { ...input, artifacts: readCanvasProviderArtifacts(store, entry) }
            }
          }
          if (args[1] === 'advance_infinite_canvas_model') {
            const skill = requireCanvasSkill('image-to-3d', policy.skills)
            if (!policy.models.includes('meshy/image-to-3d')) throw new Error('ERP 未授权图片转3D模型')
            const input = args[2] ?? {}
            const root = this.accounts.getSkillWorkspaceRoot(account.id)
            assertSkillPath(root, join(root, 'canvas'))
            const store = new CanvasStore(root)
            const entry = store.delivery(Number(input.revision), String(input.deliveryToken ?? ''), String(input.projectId ?? ''))
            const source = this.assertSession(account.workspaceId,entry.sessionId)
            if (source.projectId !== entry.projectId) throw new Error('3D原任务与画布不属于同一业务项目')
            const key = 'canvas-' + createHash('sha256').update(JSON.stringify([account.id,entry.projectId,entry.id,entry.revision])).digest('hex')
            const billing = this.control.providerTask({workspaceId:account.workspaceId,model:'meshy/image-to-3d',skills:[skill],sources:[]},key)
            const result = await advanceCanvasModel(store,{revision:entry.revision,deliveryToken:entry.deliveryToken!,projectId:entry.projectId,image:input.image},fetch,undefined,billing)
            return {content:[],structuredContent:result,isError:false}
          }
        }
      }
      if (BLOCKED_ACCOUNT_CHANNELS.has(channel)) throw new Error('普通用户不能管理服务器工作区')

      if (Object.values(RPC_CHANNELS.projects).includes(channel as any)) {
        if (args[0] !== account.workspaceId) throw new Error('无权访问该项目工作区')
        const root = this.accounts.getSkillWorkspaceRoot(account.id)
        assertSkillPath(root,join(root,'projects'))
        if (channel !== RPC_CHANNELS.projects.GET && channel !== RPC_CHANNELS.projects.CREATE) {
          if (typeof args[1] !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(args[1])) throw new Error('项目标识无效')
          assertSkillPath(root,join(root,'projects',args[1]))
        }
        if (channel === RPC_CHANNELS.projects.CREATE || channel === RPC_CHANNELS.projects.UPDATE) {
          const input = args[channel === RPC_CHANNELS.projects.CREATE ? 1 : 2]
          const allowed = new Set(['name','description','details','colorTheme','color','workingDirectory','archivedAt','kanbanColumns'])
          if (!input || typeof input !== 'object' || Object.keys(input).some(k=>!allowed.has(k))) throw new Error('项目字段无效')
          if (input.workingDirectory !== undefined && (typeof input.workingDirectory !== 'string' || !isAbsolute(input.workingDirectory))) throw new Error('项目工作目录无效')
          if (input.workingDirectory) assertSkillPath(root,input.workingDirectory)
          if (this.control && input.workingDirectory) {
            if (channel === RPC_CHANNELS.projects.CREATE) throw new Error('企业项目工作目录由服务器分配，不能指定共享目录')
            assertSkillPath(join(root,'projects',args[1]),input.workingDirectory)
          }
        }
        // The legacy delete handler unbinds all existing sessions. Preserve their
        // immutable context boundary; archive instead until scoped deletion exists.
        if (this.control && channel === RPC_CHANNELS.projects.DELETE) throw new Error('企业项目请先归档，禁止删除项目并解绑历史会话')
        if (channel === RPC_CHANNELS.projects.UPLOAD_ASSET) {
          const input = args[2]
          if (!input || typeof input.filename !== 'string' || input.filename.includes('/') || input.filename.includes('\\') || input.filename.includes(':')) throw new Error('附件名称无效')
          if (input.sourcePath !== undefined) throw new Error('请上传附件内容，不能读取服务器源路径')
          if ((typeof input.base64 !== 'string' && typeof input.text !== 'string') || Buffer.byteLength(input.base64 ?? input.text) > 16*1024*1024) throw new Error('附件内容无效或超过16MB')
          assertSkillPath(root,join(root,'projects',args[1],'assets',input.filename))
        }
        if (channel === RPC_CHANNELS.projects.DELETE_ASSET) {
          if (typeof args[2] !== 'string' || args[2].includes('/') || args[2].includes('\\') || args[2].includes(':')) throw new Error('附件名称无效')
          assertSkillPath(root,join(root,'projects',args[1],'assets',args[2]))
        }
      }

      // Generic file previews must not bypass the skill library boundary via
      // the server user's home/tmp allowlist. Public skill attachments are
      // served through the filtered library API, not arbitrary file paths.
      if ([RPC_CHANNELS.file.READ, RPC_CHANNELS.file.READ_DATA_URL,
        RPC_CHANNELS.file.READ_PREVIEW_DATA_URL, RPC_CHANNELS.file.READ_BINARY,
        RPC_CHANNELS.file.READ_ATTACHMENT, RPC_CHANNELS.file.READ_USER_ATTACHMENT,
        RPC_CHANNELS.fs.LIST_DIRECTORY, RPC_CHANNELS.fs.SEARCH].includes(channel as any)) {
        const path = args[0]
        {
          const roots = [this.accounts.getSkillWorkspaceRoot(account.id)]
          const allowed = typeof path === 'string' && isAbsolute(path) && roots.some(root => {
            try { assertSkillPath(root, resolve(path)); return true } catch { return false }
          })
          if (!allowed) throw new Error('无权访问其他用户或服务器的私有文件')
        }
      }

      // Never use client-supplied workspace names, project paths, or global
      // directories to resolve account skills. Public skills are read-only.
      if (Object.values(RPC_CHANNELS.skills).includes(channel as any)) {
        if (args[0] !== account.workspaceId) throw new Error('无权访问其他用户的技能')
        if (this.control) {
          const releases = await this.control.catalog(account.id)
          if (channel === RPC_CHANNELS.skills.GET) return Promise.all(releases.map(async r => (await this.control!.bundle(account.id,r)).skill))
          if (channel === RPC_CHANNELS.skills.GET_FILES) {
            const release = releases.find(r => r.slug === args[1])
            return release ? (await this.control.bundle(account.id,release)).files.map(f => ({name:f.path,type:'file',size:Buffer.from(f.base64,'base64').length})) : []
          }
          throw new Error('公共技能请在 ERP 审批发布')
        }
        const library = new AccountSkillLibrary(
          process.env.CRAFT_PUBLIC_SKILLS_DIR ?? GLOBAL_AGENT_SKILLS_DIR,
          join(this.accounts.getSkillWorkspaceRoot(account.id), 'skills'),
        )
        if (channel === RPC_CHANNELS.skills.GET) return library.snapshot().skills.map(bundle => bundle.skill)
        if (channel === RPC_CHANNELS.skills.GET_FILES) {
          const bundle = library.get(args[1])
          return bundle?.files.map(file => ({ name: file.path, type: 'file', size: Buffer.from(file.base64, 'base64').length })) ?? []
        }
        throw new Error('请通过账号技能库操作；公共技能只读，不能打开服务器文件路径')
      }

      const forbiddenIds = new Set(getWorkspaces().map(workspace => workspace.id))
      forbiddenIds.delete(account.workspaceId)
      for (const session of this.sessions.getSessions()) {
        if (session.workspaceId && session.workspaceId !== account.workspaceId) forbiddenIds.add(session.id)
      }
      if (containsForbiddenId(args, forbiddenIds)) throw new Error('无权访问其他用户的数据')

      let debited = false
      if (channel === RPC_CHANNELS.sessions.SEND_MESSAGE && !this.accounts.getExternalMember(account.id)) {
        await this.accounts.debit(account.id)
        debited = true
      }

      try {
        const result = this.control && channel === RPC_CHANNELS.sessions.SEND_MESSAGE
          ? await this.control.acceptMessage(account.id,args,async () => handler(ctx,...args))
          : await handler(ctx, ...args)
        if (this.control && [RPC_CHANNELS.llmConnections.LIST,RPC_CHANNELS.llmConnections.LIST_WITH_STATUS,RPC_CHANNELS.llmConnections.GET].includes(channel as any)) {
          const p = await this.control.policy(account.id)
          const managedDefaultModel = resolveManagedDefaultModel(p)
          const project = (c: any) => {
            if (!c) return null
            const models = (c.models ?? []).map((m:any) => typeof m==='string' ? {id:m,name:m} : {id:m.id,name:m.name}).filter((m:any)=>p.models.includes(m.id))
            if (!models.length && !p.models.includes(c.defaultModel)) return null
            const servesManagedDefault = managedDefaultModel !== undefined
              && (models.some((model:any) => model.id === managedDefaultModel) || c.defaultModel === managedDefaultModel)
            return {slug:c.slug,name:c.name,providerType:c.providerType,authType:c.authType,models,
              defaultModel:servesManagedDefault ? managedDefaultModel : p.models.includes(c.defaultModel)?c.defaultModel:models[0]?.id,
              createdAt:c.createdAt,isAuthenticated:!!c.isAuthenticated,isDefault:servesManagedDefault}
          }
          if (!Array.isArray(result)) return project(result)
          const projected = result.map(project).filter(Boolean)
          const defaultIndex = Math.max(0, projected.findIndex((connection:any) => connection.isDefault))
          return projected.map((connection:any, index:number) => ({...connection,isDefault:index === defaultIndex}))
        }
        if (this.control && channel === RPC_CHANNELS.sources.GET && Array.isArray(result)) {
          const allowed = await this.control.allowedSources(account.workspaceId)
          return result.filter(s => allowed.includes(s?.config?.slug))
        }
        if (FILTERED_WORKSPACE_LIST_CHANNELS.has(channel) && Array.isArray(result)) {
          return result.filter(item => item && typeof item === 'object' && (item as { id?: string }).id === account.workspaceId)
        }
        if (channel === RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES && result && typeof result === 'object') {
          const themes = result as Record<string, unknown>
          return account.workspaceId in themes ? { [account.workspaceId]: themes[account.workspaceId] } : {}
        }
        if (channel === RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY && result && typeof result === 'object') {
          const summary = result as {
            byWorkspace?: Record<string, number>
            hasUnreadByWorkspace?: Record<string, boolean>
          }
          const count = summary.byWorkspace?.[account.workspaceId] ?? 0
          return {
            totalUnreadSessions: count,
            byWorkspace: { [account.workspaceId]: count },
            hasUnreadByWorkspace: { [account.workspaceId]: summary.hasUnreadByWorkspace?.[account.workspaceId] ?? false },
          }
        }
        return result
      } catch (error) {
        if (debited) await this.accounts.credit(account.id)
        throw error
      }
    })
  }

  private async assertConnection(slug: string, models: string[]) {
    if (typeof slug !== 'string') throw new Error('模型连接无效')
    const { getLlmConnection } = await import('@craft-agent/shared/config/storage')
    const c = getLlmConnection(slug)
    if (!c || !(c.models ?? []).some(m=>models.includes(typeof m === 'string' ? m : m.id)) && !models.includes(c.defaultModel ?? '')) throw new Error('ERP 未授权此模型连接')
  }
  private assertSession(workspaceId: string, id: unknown): SessionSummary {
    const session = typeof id === 'string' && this.sessions.getSessions().find(s => s.id === id && s.workspaceId === workspaceId)
    if (!session) throw new Error('无权访问其他用户的数据或不存在的会话')
    return session
  }
  private async assertProject(account: string, project: string) {
    if (typeof project !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(project)) throw new Error('项目标识无效')
    const root = this.accounts.getSkillWorkspaceRoot(account)
    const { loadProjectById } = await import('@craft-agent/shared/projects')
    assertSkillPath(root,join(root,'projects'))
    if (!existsSync(join(root,'projects'))) throw new Error('无权绑定该项目')
    const p = loadProjectById(root,project)
    if (!p) throw new Error('无权绑定该项目')
    assertSkillPath(root,p.folderPath)
    if (p.config.workingDirectory) assertSkillPath(p.folderPath,p.config.workingDirectory)
    return p
  }

  push(channel: string, target: PushTarget, ...args: any[]): void {
    this.inner.push(channel, target, ...args)
  }

  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any> {
    return this.inner.invokeClient(clientId, channel, ...args)
  }

  updateClientWorkspace(clientId: string, workspaceId: string): void {
    this.inner.updateClientWorkspace?.(clientId, workspaceId)
  }

  hasClientCapability(clientId: string, capability: string): boolean {
    return this.inner.hasClientCapability(clientId, capability)
  }

  findClientsWithCapability(capability: string, opts?: { workspaceId?: string }): string[] {
    return this.inner.findClientsWithCapability(capability, opts)
  }
}
