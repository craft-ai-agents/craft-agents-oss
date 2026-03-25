import type { RpcClient } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS, type LlmConnectionBundle, type LlmConnectionSetup, type RemoteServerProfile, type RemoteServerRuntimeState, type SaveRemoteServerProfileInput, type UnreadSummary } from '@craft-agent/shared/protocol'
import { buildRemoteWorkspaceTargetId, parseRemoteWorkspaceTargetId } from '@craft-agent/shared/workspaces'
import type { Workspace, ElectronAPI, TransportConnectionState, Session, WorkspaceCreationTarget } from '../shared/types'
import { WsRpcClient } from '../transport/client'

interface RemoteServerAuthMaterial {
  id: string
  name: string
  url: string
  enabled: boolean
  token: string | null
}

interface RemoteServerConnection {
  profile: RemoteServerProfile
  auth: RemoteServerAuthMaterial
  client: WsRpcClient
  workspaces: Workspace[]
  unreadSummary: UnreadSummary
  runtime: RemoteServerRuntimeState
  selectedWorkspaceId: string | null
  dispose: () => void
}

type VoidListener = () => void

function emptyUnreadSummary(): UnreadSummary {
  return {
    totalUnreadSessions: 0,
    byWorkspace: {},
    hasUnreadByWorkspace: {},
  }
}

function buildRemoteRuntimeState(serverId: string): RemoteServerRuntimeState {
  return {
    serverId,
    status: 'idle',
    workspaceCount: 0,
    updatedAt: Date.now(),
  }
}

function mapRemoteWorkspace(profile: RemoteServerProfile, workspace: Workspace): Workspace {
  return {
    ...workspace,
    id: buildRemoteWorkspaceTargetId(profile.id, workspace.id),
    isRemote: true,
    remoteServerId: profile.id,
    remoteServerName: profile.name,
    remoteWorkspaceId: workspace.id,
    remoteServerUrl: profile.url,
  }
}

function mapRemoteSession(serverId: string, session: Session): Session {
  return {
    ...session,
    workspaceId: buildRemoteWorkspaceTargetId(serverId, session.workspaceId),
  }
}

function isLocalhostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function getLlmShareWarning(connection: { baseUrl?: string }): string | undefined {
  if (!connection.baseUrl) return undefined

  try {
    const hostname = new URL(connection.baseUrl).hostname
    if (isLocalhostHostname(hostname)) {
      return 'This connection points at localhost. It was copied, but it may not work from the destination server.'
    }
  } catch {
    // Ignore invalid URLs; server-side validation will handle them later.
  }

  return undefined
}

function isMissingHandlerError(error: unknown, channel: string): boolean {
  return error instanceof Error && error.message.includes(`No handler for: ${channel}`)
}

function getConnectionModelsForSetup(bundle: LlmConnectionBundle): string[] | null {
  const models = bundle.connection.models
  if (!models || models.length === 0) return null
  return models.map(model => typeof model === 'string' ? model : model.id)
}

function getLlmCompatibilityWarning(bundle: LlmConnectionBundle): string | undefined {
  if (bundle.connection.authType !== 'oauth') return undefined
  if (!bundle.credential) return undefined

  if (bundle.credential.refreshToken || bundle.credential.clientId || bundle.credential.clientSecret || bundle.credential.idToken) {
    return 'Destination server uses an older share API. The OAuth access token was copied, but refresh metadata was not, so re-authentication may be needed later.'
  }

  return 'Destination server uses an older share API. This OAuth connection was copied in compatibility mode.'
}

async function importLlmBundleCompat(destinationClient: RpcClient, bundle: LlmConnectionBundle): Promise<{ success: boolean; slug: string; error?: string }> {
  const saveResult = await destinationClient.invoke(
    RPC_CHANNELS.llmConnections.SAVE,
    bundle.connection,
  ) as { success: boolean; error?: string }

  if (!saveResult.success) {
    return {
      success: false,
      slug: bundle.connection.slug,
      error: saveResult.error || 'Failed to save connection',
    }
  }

  if (!bundle.credential) {
    return { success: true, slug: bundle.connection.slug }
  }

  if (bundle.connection.providerType === 'bedrock' || bundle.connection.providerType === 'vertex') {
    return {
      success: false,
      slug: bundle.connection.slug,
      error: 'This remote server is too old to receive this credential type. Update the headless server first.',
    }
  }

  const setup: LlmConnectionSetup = {
    slug: bundle.connection.slug,
    credential: bundle.credential.value,
    baseUrl: bundle.connection.baseUrl ?? null,
    defaultModel: bundle.connection.defaultModel ?? null,
    models: getConnectionModelsForSetup(bundle),
    piAuthProvider: bundle.connection.piAuthProvider,
    modelSelectionMode: bundle.connection.modelSelectionMode,
    customEndpoint: bundle.connection.customEndpoint,
    updateOnly: true,
  }

  const setupResult = await destinationClient.invoke(
    RPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
    setup,
  ) as { success: boolean; error?: string }

  if (!setupResult.success) {
    return {
      success: false,
      slug: bundle.connection.slug,
      error: setupResult.error || 'Failed to save credentials',
    }
  }

  return { success: true, slug: bundle.connection.slug }
}

function isBlockedInsecureRemoteServer(profile: RemoteServerProfile): boolean {
  try {
    const parsed = new URL(profile.url)
    return parsed.protocol === 'ws:' && !isLocalhostHostname(parsed.hostname) && !profile.allowInsecureWs
  } catch {
    return false
  }
}

function buildBlockedInsecureRuntimeState(serverId: string): RemoteServerRuntimeState {
  return {
    serverId,
    status: 'failed',
    workspaceCount: 0,
    updatedAt: Date.now(),
    error: 'Unsecured ws:// connection blocked. Enable "Allow insecure ws://" to connect.',
  }
}

export class WorkspaceTransportBroker {
  private readonly localClient: WsRpcClient
  private readonly api: ElectronAPI
  private readonly initialWorkspaceId: string

  private initialized = false
  private initializingPromise: Promise<void> | null = null
  private activeWorkspaceId: string

  private localWorkspaces: Workspace[] = []
  private localUnreadSummary: UnreadSummary = emptyUnreadSummary()
  private remoteProfiles = new Map<string, RemoteServerProfile>()
  private remoteConnections = new Map<string, RemoteServerConnection>()

  private readonly remoteServerListeners = new Set<VoidListener>()
  private readonly workspaceListeners = new Set<VoidListener>()
  private readonly unreadSummaryListeners = new Set<(summary: UnreadSummary) => void>()
  private readonly transportListeners = new Set<(state: TransportConnectionState) => void>()
  private readonly sessionEventListeners = new Set<(...args: any[]) => void>()
  private readonly sessionFilesChangedListeners = new Set<(sessionId: string) => void>()
  private readonly llmConnectionsChangedListeners = new Set<VoidListener>()
  private readonly defaultPermissionsChangedListeners = new Set<(value: null) => void>()
  private readonly sourcesChangedListeners = new Set<(workspaceId: string, ...args: any[]) => void>()
  private readonly skillsChangedListeners = new Set<(workspaceId: string, ...args: any[]) => void>()
  private readonly labelsChangedListeners = new Set<(workspaceId: string, ...args: any[]) => void>()
  private readonly statusesChangedListeners = new Set<(workspaceId: string, ...args: any[]) => void>()
  private readonly automationsChangedListeners = new Set<(workspaceId: string, ...args: any[]) => void>()
  private readonly workspaceThemeChangedListeners = new Set<(data: { workspaceId: string; themeId: string | null }) => void>()

  private activeListenerDisposers: Array<() => void> = []

  constructor(api: ElectronAPI, localClient: WsRpcClient, initialWorkspaceId: string) {
    this.api = api
    this.localClient = localClient
    this.initialWorkspaceId = initialWorkspaceId
    this.activeWorkspaceId = initialWorkspaceId
    this.localClient.on(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED, (summary: UnreadSummary) => {
      this.localUnreadSummary = summary
      this.emitUnreadSummaryChanged()
    })
    this.localClient.on(RPC_CHANNELS.remoteServers.CHANGED, () => {
      void this.reloadRemoteServers()
    })
    this.localClient.on(RPC_CHANNELS.sources.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.sourcesChangedListeners, workspaceId, ...args)
    })
    this.localClient.on(RPC_CHANNELS.skills.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.skillsChangedListeners, workspaceId, ...args)
    })
    this.localClient.on(RPC_CHANNELS.labels.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.labelsChangedListeners, workspaceId, ...args)
    })
    this.localClient.on(RPC_CHANNELS.statuses.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.statusesChangedListeners, workspaceId, ...args)
    })
    this.localClient.on(RPC_CHANNELS.automations.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.automationsChangedListeners, workspaceId, ...args)
    })
    this.localClient.on(RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, (data: { workspaceId: string; themeId: string | null }) => {
      this.emitWorkspaceThemeChanged(data)
    })
  }

  install(): ElectronAPI {
    this.overrideWorkspaceMethods()
    this.overrideSessionMethods()
    this.overrideWorkspaceScopedMethods()
    this.overrideThemeMethods()
    this.overrideLlmMethods()
    this.overrideAutomationMethods()
    this.overrideTransportMethods()
    this.overrideSystemMethods()
    void this.ensureInitialized()
    return this.api
  }

  async invokeOnActiveTarget(channel: string, ...args: any[]): Promise<any> {
    return this.invokeActive(channel, ...args)
  }

  async invokeOnTarget(target: WorkspaceCreationTarget, channel: string, ...args: any[]): Promise<any> {
    const client = await this.getClientForTarget(target)
    return client.invoke(channel, ...args)
  }

  async listenOnTarget(target: WorkspaceCreationTarget, channel: string, callback: (...args: any[]) => void): Promise<() => void> {
    const client = await this.getClientForTarget(target)
    return client.on(channel, callback)
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (this.initializingPromise) return this.initializingPromise

    this.initializingPromise = (async () => {
      await this.refreshLocalWorkspaces()
      try {
        this.localUnreadSummary = await this.localClient.invoke(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) as UnreadSummary
      } catch {
        this.localUnreadSummary = emptyUnreadSummary()
      }
      await this.reloadRemoteServers()
      await this.reconcileInitialWorkspace()
      this.initialized = true
    })().finally(() => {
      this.initializingPromise = null
    })

    return this.initializingPromise
  }

  private overrideWorkspaceMethods(): void {
    this.api.getWorkspaces = async () => {
      await this.ensureInitialized()
      return this.getAggregatedWorkspaces()
    }

    this.api.createWorkspace = async (folderPath: string, name: string, options?: { managedByApp?: boolean }) => {
      await this.ensureInitialized()
      const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
      if (!activeRemote) {
        const created = await this.localClient.invoke(RPC_CHANNELS.workspaces.CREATE, folderPath, name, options) as Workspace
        await this.refreshLocalWorkspaces()
        this.emitWorkspacesChanged()
        return created
      }

      const connection = await this.requireRemoteConnection(activeRemote.serverId)
      const created = await connection.client.invoke(RPC_CHANNELS.workspaces.CREATE, folderPath, name, options) as Workspace
      await this.refreshRemoteWorkspaces(connection)
      this.emitWorkspacesChanged()
      return mapRemoteWorkspace(connection.profile, created)
    }

    this.api.deleteWorkspace = async (workspaceId: string) => {
      await this.ensureInitialized()
      const fallbackWorkspaceId = this.getFallbackWorkspaceId(workspaceId)
      if (!fallbackWorkspaceId && this.getAggregatedWorkspaces().some(workspace => workspace.id === workspaceId)) {
        throw new Error('At least one workspace must remain')
      }

      const target = parseRemoteWorkspaceTargetId(workspaceId)
      if (!target) {
        const deleted = await this.localClient.invoke(RPC_CHANNELS.workspaces.DELETE, workspaceId) as boolean
        await this.refreshLocalWorkspaces()
        if (deleted && this.activeWorkspaceId === workspaceId && fallbackWorkspaceId) {
          await this.switchActiveWindowWorkspace(fallbackWorkspaceId)
        }
        this.emitWorkspacesChanged()
        return deleted
      }

      const connection = await this.requireRemoteConnection(target.serverId)
      const deleted = await connection.client.invoke(RPC_CHANNELS.workspaces.DELETE, target.workspaceId) as boolean
      await this.refreshRemoteWorkspaces(connection)
      if (deleted && this.activeWorkspaceId === workspaceId && fallbackWorkspaceId) {
        await this.switchActiveWindowWorkspace(fallbackWorkspaceId)
      }
      this.emitWorkspacesChanged()
      return deleted
    }

    this.api.createWorkspaceAtTarget = async (target: WorkspaceCreationTarget, folderPath: string, name: string, options?: { managedByApp?: boolean }) => {
      await this.ensureInitialized()
      if (target.mode === 'local') {
        const created = await this.localClient.invoke(RPC_CHANNELS.workspaces.CREATE, folderPath, name, options) as Workspace
        await this.refreshLocalWorkspaces()
        this.emitWorkspacesChanged()
        return created
      }

      if (!target.serverId) {
        throw new Error('Select a remote server before creating a workspace')
      }

      const connection = await this.requireRemoteConnection(target.serverId)
      const created = await connection.client.invoke(RPC_CHANNELS.workspaces.CREATE, folderPath, name, options) as Workspace
      await this.refreshRemoteWorkspaces(connection)
      this.emitWorkspacesChanged()
      return mapRemoteWorkspace(connection.profile, created)
    }

    this.api.checkWorkspaceSlug = async (slug: string) => {
      await this.ensureInitialized()
      const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
      if (!activeRemote) {
        return this.localClient.invoke(RPC_CHANNELS.workspaces.CHECK_SLUG, slug) as Promise<any>
      }

      const connection = await this.requireRemoteConnection(activeRemote.serverId)
      return connection.client.invoke(RPC_CHANNELS.workspaces.CHECK_SLUG, slug) as Promise<any>
    }

    this.api.checkWorkspaceSlugAtTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      await this.ensureInitialized()
      if (target.mode === 'local') {
        return this.localClient.invoke(RPC_CHANNELS.workspaces.CHECK_SLUG, slug) as Promise<any>
      }

      if (!target.serverId) {
        throw new Error('Select a remote server before validating a workspace')
      }

      const connection = await this.requireRemoteConnection(target.serverId)
      return connection.client.invoke(RPC_CHANNELS.workspaces.CHECK_SLUG, slug) as Promise<any>
    }

    this.api.listRemoteServers = async () => {
      await this.ensureInitialized()
      return [...this.remoteProfiles.values()].sort((a, b) => a.name.localeCompare(b.name))
    }

    this.api.saveRemoteServerProfile = async (input: SaveRemoteServerProfileInput) => {
      const saved = await this.localClient.invoke(RPC_CHANNELS.remoteServers.SAVE, input) as RemoteServerProfile
      await this.reloadRemoteServers()
      return saved
    }

    this.api.deleteRemoteServerProfile = async (serverId: string) => {
      const deleted = await this.localClient.invoke(RPC_CHANNELS.remoteServers.DELETE, serverId) as boolean
      await this.reloadRemoteServers()
      return deleted
    }

    this.api.saveRemoteServerToken = async (serverId: string, token: string) => {
      await this.localClient.invoke(RPC_CHANNELS.remoteServers.SAVE_TOKEN, serverId, token)
      await this.reloadRemoteServers()
    }

    this.api.clearRemoteServerToken = async (serverId: string) => {
      await this.localClient.invoke(RPC_CHANNELS.remoteServers.CLEAR_TOKEN, serverId)
      await this.reloadRemoteServers()
    }

    this.api.getRemoteServerRuntimeStates = async () => {
      await this.ensureInitialized()
      return Object.fromEntries(
        [...this.remoteProfiles.keys()].map((serverId) => [
          serverId,
          this.remoteConnections.get(serverId)?.runtime
            ?? (this.remoteProfiles.get(serverId) && isBlockedInsecureRemoteServer(this.remoteProfiles.get(serverId)!)
              ? buildBlockedInsecureRuntimeState(serverId)
              : buildRemoteRuntimeState(serverId)),
        ]),
      )
    }

    this.api.onRemoteServersChanged = (callback: VoidListener) => {
      this.remoteServerListeners.add(callback)
      return () => {
        this.remoteServerListeners.delete(callback)
      }
    }

    this.api.onWorkspacesChanged = (callback: VoidListener) => {
      this.workspaceListeners.add(callback)
      return () => {
        this.workspaceListeners.delete(callback)
      }
    }

    this.api.getWindowWorkspace = async () => {
      await this.ensureInitialized()
      return this.activeWorkspaceId
    }

    this.api.switchWorkspace = async (workspaceId: string) => {
      await this.localClient.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, workspaceId)
      await this.setActiveWorkspace(workspaceId)
    }

    this.api.openWorkspace = async (workspaceId: string) => {
      await this.localClient.invoke(RPC_CHANNELS.window.OPEN_WORKSPACE, workspaceId)
    }
  }

  private overrideSessionMethods(): void {
    this.api.getUnreadSummary = async () => {
      await this.ensureInitialized()
      return this.aggregateUnreadSummary()
    }

    this.api.onUnreadSummaryChanged = (callback: (summary: UnreadSummary) => void) => {
      this.unreadSummaryListeners.add(callback)
      callback(this.aggregateUnreadSummary())
      return () => {
        this.unreadSummaryListeners.delete(callback)
      }
    }

    this.api.getSessions = async () => {
      const sessions = await this.invokeActive(RPC_CHANNELS.sessions.GET) as Session[]
      const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
      if (!activeRemote) return sessions
      return sessions.map(session => mapRemoteSession(activeRemote.serverId, session))
    }
    this.api.getSessionMessages = async (sessionId: string) => {
      const session = await this.invokeActive(RPC_CHANNELS.sessions.GET_MESSAGES, sessionId) as Session | null
      const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
      if (!session || !activeRemote) return session
      return mapRemoteSession(activeRemote.serverId, session)
    }
    this.api.createSession = async (workspaceId: string, options?: any) => {
      const target = await this.resolveWorkspaceTarget(workspaceId)
      const created = await target.client.invoke(RPC_CHANNELS.sessions.CREATE, target.workspaceId, options) as Session
      const remoteTarget = parseRemoteWorkspaceTargetId(workspaceId)
      if (!remoteTarget) return created
      return mapRemoteSession(remoteTarget.serverId, created)
    }
    this.api.deleteSession = async (sessionId: string) => {
      await this.invokeActive(RPC_CHANNELS.sessions.DELETE, sessionId)
    }
    this.api.sendMessage = async (sessionId: string, message: string, attachments?: any[], storedAttachments?: any[], options?: any) => {
      await this.invokeActive(RPC_CHANNELS.sessions.SEND_MESSAGE, sessionId, message, attachments, storedAttachments, options)
    }
    this.api.cancelProcessing = async (sessionId: string, silent?: boolean) => this.invokeActive(RPC_CHANNELS.sessions.CANCEL, sessionId, silent) as Promise<any>
    this.api.killShell = async (sessionId: string, shellId: string) => this.invokeActive(RPC_CHANNELS.sessions.KILL_SHELL, sessionId, shellId) as Promise<any>
    this.api.getTaskOutput = async (taskId: string) => this.invokeActive(RPC_CHANNELS.tasks.GET_OUTPUT, taskId) as Promise<any>
    this.api.respondToPermission = async (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean, options?: any) => {
      return this.invokeActive(RPC_CHANNELS.sessions.RESPOND_TO_PERMISSION, sessionId, requestId, allowed, alwaysAllow, options) as Promise<any>
    }
    this.api.respondToCredential = async (sessionId: string, requestId: string, response: any) => {
      return this.invokeActive(RPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL, sessionId, requestId, response) as Promise<any>
    }
    this.api.sessionCommand = async (sessionId: string, command: any) => {
      if (command?.type === 'setActiveViewing' && typeof command.workspaceId === 'string') {
        const parsed = parseRemoteWorkspaceTargetId(command.workspaceId)
        if (parsed) {
          return this.invokeActive(RPC_CHANNELS.sessions.COMMAND, sessionId, { ...command, workspaceId: parsed.workspaceId }) as Promise<any>
        }
      }
      return this.invokeActive(RPC_CHANNELS.sessions.COMMAND, sessionId, command) as Promise<any>
    }
    this.api.getPendingPlanExecution = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION, sessionId) as Promise<any>
    this.api.getPendingPermissions = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.GET_PENDING_PERMISSIONS, sessionId) as Promise<any>
    this.api.getSessionPermissionModeState = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, sessionId) as Promise<any>
    this.api.markAllSessionsRead = async (workspaceId: string) => {
      await this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sessions.MARK_ALL_READ)
    }
    this.api.getSessionModel = async (sessionId: string, workspaceId: string) => {
      const target = await this.resolveWorkspaceTarget(workspaceId)
      return target.client.invoke(RPC_CHANNELS.sessions.GET_MODEL, sessionId, target.workspaceId) as Promise<any>
    }
    this.api.setSessionModel = async (sessionId: string, workspaceId: string, model: string | null, connection?: string) => {
      const target = await this.resolveWorkspaceTarget(workspaceId)
      await target.client.invoke(RPC_CHANNELS.sessions.SET_MODEL, sessionId, target.workspaceId, model, connection)
    }
    this.api.getSessionFiles = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.GET_FILES, sessionId) as Promise<any>
    this.api.getSessionNotes = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.GET_NOTES, sessionId) as Promise<any>
    this.api.setSessionNotes = async (sessionId: string, notes: string) => this.invokeActive(RPC_CHANNELS.sessions.SET_NOTES, sessionId, notes) as Promise<any>
    this.api.watchSessionFiles = async (sessionId: string) => this.invokeActive(RPC_CHANNELS.sessions.WATCH_FILES, sessionId) as Promise<any>
    this.api.unwatchSessionFiles = async () => this.invokeActive(RPC_CHANNELS.sessions.UNWATCH_FILES) as Promise<any>

    this.api.onSessionEvent = (callback: (...args: any[]) => void) => {
      this.sessionEventListeners.add(callback)
      this.rebindActiveListeners()
      return () => {
        this.sessionEventListeners.delete(callback)
      }
    }

    this.api.onSessionFilesChanged = (callback: (sessionId: string) => void) => {
      this.sessionFilesChangedListeners.add(callback)
      this.rebindActiveListeners()
      return () => {
        this.sessionFilesChangedListeners.delete(callback)
      }
    }
  }

  private overrideSystemMethods(): void {
    this.api.getHomeDir = async () => this.invokeActive(RPC_CHANNELS.system.HOME_DIR) as Promise<any>
    this.api.getHomeDirForTarget = async (target: WorkspaceCreationTarget) => {
      await this.ensureInitialized()
      if (target.mode === 'local') {
        return this.localClient.invoke(RPC_CHANNELS.system.HOME_DIR) as Promise<any>
      }
      if (!target.serverId) {
        throw new Error('Select a remote server before browsing folders')
      }
      const connection = await this.requireRemoteConnection(target.serverId)
      return connection.client.invoke(RPC_CHANNELS.system.HOME_DIR) as Promise<any>
    }
  }

  private overrideWorkspaceScopedMethods(): void {
    this.api.getWorkspaceSettings = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.workspace.SETTINGS_GET) as Promise<any>
    this.api.updateWorkspaceSetting = async (workspaceId: string, key: string, value: unknown) => {
      await this.invokeForWorkspace(workspaceId, RPC_CHANNELS.workspace.SETTINGS_UPDATE, key, value)
    }
    this.api.readWorkspaceImage = async (workspaceId: string, relativePath: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.workspace.READ_IMAGE, relativePath) as Promise<any>
    this.api.writeWorkspaceImage = async (workspaceId: string, relativePath: string, base64: string, mimeType: string) => {
      await this.invokeForWorkspace(workspaceId, RPC_CHANNELS.workspace.WRITE_IMAGE, relativePath, base64, mimeType)
    }
    this.api.searchFiles = async (basePath: string, query: string) => this.invokeActive(RPC_CHANNELS.fs.SEARCH, basePath, query) as Promise<any>
    this.api.listServerDirectory = async (path?: string, limit?: number) => this.invokeActive(RPC_CHANNELS.fs.LIST_DIRECTORY, path, limit) as Promise<any>
    this.api.listServerDirectoryForTarget = async (target: WorkspaceCreationTarget, path: string) => {
      await this.ensureInitialized()
      if (target.mode === 'local') {
        return this.localClient.invoke(RPC_CHANNELS.fs.LIST_DIRECTORY, path) as Promise<any>
      }
      if (!target.serverId) {
        throw new Error('Select a remote server before browsing folders')
      }
      const connection = await this.requireRemoteConnection(target.serverId)
      return connection.client.invoke(RPC_CHANNELS.fs.LIST_DIRECTORY, path) as Promise<any>
    }
    this.api.readFile = async (path: string) => this.invokeActiveIfRemote(RPC_CHANNELS.file.READ, path, () => this.localClient.invoke(RPC_CHANNELS.file.READ, path)) as Promise<any>
    this.api.readFileBinary = async (path: string) => this.invokeActiveIfRemote(RPC_CHANNELS.file.READ_BINARY, path, () => this.localClient.invoke(RPC_CHANNELS.file.READ_BINARY, path)) as Promise<any>
    this.api.readFileDataUrl = async (path: string) => this.invokeActiveIfRemote(RPC_CHANNELS.file.READ_DATA_URL, path, () => this.localClient.invoke(RPC_CHANNELS.file.READ_DATA_URL, path)) as Promise<any>
    this.api.getSources = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.GET) as Promise<any>
    this.api.createSource = async (workspaceId: string, config: any) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.CREATE, config) as Promise<any>
    this.api.deleteSource = async (workspaceId: string, sourceSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.DELETE, sourceSlug) as Promise<any>
    this.api.shareSourceToWorkspace = async (sourceWorkspaceId: string, sourceSlug: string, destinationWorkspaceId: string) => {
      const bundle = await this.invokeForWorkspace(sourceWorkspaceId, RPC_CHANNELS.sources.EXPORT_BUNDLE, sourceSlug)
      return this.invokeForWorkspace(destinationWorkspaceId, RPC_CHANNELS.sources.IMPORT_BUNDLE, bundle) as Promise<any>
    }
    this.api.startSourceOAuth = async (workspaceId: string, sourceSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.START_OAUTH, sourceSlug) as Promise<any>
    this.api.saveSourceCredentials = async (workspaceId: string, sourceSlug: string, credential: string) => {
      await this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.SAVE_CREDENTIALS, sourceSlug, credential)
    }
    this.api.getSourcePermissionsConfig = async (workspaceId: string, sourceSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.GET_PERMISSIONS, sourceSlug) as Promise<any>
    this.api.getWorkspacePermissionsConfig = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.workspace.GET_PERMISSIONS) as Promise<any>
    this.api.getDefaultPermissionsConfig = async () => this.invokeActive(RPC_CHANNELS.permissions.GET_DEFAULTS) as Promise<any>
    this.api.getMcpTools = async (workspaceId: string, sourceSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sources.GET_MCP_TOOLS, sourceSlug) as Promise<any>
    this.api.getSkills = async (workspaceId: string, workingDirectory?: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.skills.GET, workingDirectory) as Promise<any>
    this.api.getSkillFiles = async (workspaceId: string, skillSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.skills.GET_FILES, skillSlug) as Promise<any>
    this.api.deleteSkill = async (workspaceId: string, skillSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.skills.DELETE, skillSlug) as Promise<any>
    this.api.shareSkillToWorkspace = async (sourceWorkspaceId: string, skillSlug: string, destinationWorkspaceId: string) => {
      const bundle = await this.invokeForWorkspace(sourceWorkspaceId, RPC_CHANNELS.skills.EXPORT_BUNDLE, skillSlug)
      return this.invokeForWorkspace(destinationWorkspaceId, RPC_CHANNELS.skills.IMPORT_BUNDLE, bundle) as Promise<any>
    }
    this.api.openSkillInEditor = async (workspaceId: string, skillSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.skills.OPEN_EDITOR, skillSlug) as Promise<any>
    this.api.openSkillInFinder = async (workspaceId: string, skillSlug: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.skills.OPEN_FINDER, skillSlug) as Promise<any>
    this.api.listStatuses = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.statuses.LIST) as Promise<any>
    this.api.reorderStatuses = async (workspaceId: string, orderedIds: string[]) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.statuses.REORDER, orderedIds) as Promise<any>
    this.api.listLabels = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.labels.LIST) as Promise<any>
    this.api.createLabel = async (workspaceId: string, input: any) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.labels.CREATE, input) as Promise<any>
    this.api.deleteLabel = async (workspaceId: string, labelId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.labels.DELETE, labelId) as Promise<any>
    this.api.listViews = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.views.LIST) as Promise<any>
    this.api.saveViews = async (workspaceId: string, views: any[]) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.views.SAVE, views) as Promise<any>
    this.api.searchSessionContent = async (workspaceId: string, query: string, searchId?: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.sessions.SEARCH_CONTENT, query, searchId) as Promise<any>

    this.api.onDefaultPermissionsChanged = (callback: (value: null) => void) => {
      this.defaultPermissionsChangedListeners.add(callback)
      this.rebindActiveListeners()
      return () => {
        this.defaultPermissionsChangedListeners.delete(callback)
      }
    }

    this.api.onSourcesChanged = (callback: (workspaceId: string, ...args: any[]) => void) => {
      this.sourcesChangedListeners.add(callback)
      return () => {
        this.sourcesChangedListeners.delete(callback)
      }
    }

    this.api.onSkillsChanged = (callback: (workspaceId: string, ...args: any[]) => void) => {
      this.skillsChangedListeners.add(callback)
      return () => {
        this.skillsChangedListeners.delete(callback)
      }
    }

    this.api.onLabelsChanged = (callback: (workspaceId: string, ...args: any[]) => void) => {
      this.labelsChangedListeners.add(callback)
      return () => {
        this.labelsChangedListeners.delete(callback)
      }
    }

    this.api.onStatusesChanged = (callback: (workspaceId: string, ...args: any[]) => void) => {
      this.statusesChangedListeners.add(callback)
      return () => {
        this.statusesChangedListeners.delete(callback)
      }
    }

    this.api.onAutomationsChanged = (callback: (workspaceId: string, ...args: any[]) => void) => {
      this.automationsChangedListeners.add(callback)
      return () => {
        this.automationsChangedListeners.delete(callback)
      }
    }
  }

  private overrideThemeMethods(): void {
    this.api.getWorkspaceColorTheme = async (workspaceId: string) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.theme.GET_WORKSPACE_COLOR_THEME) as Promise<any>
    this.api.setWorkspaceColorTheme = async (workspaceId: string, themeId: string | null) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.theme.SET_WORKSPACE_COLOR_THEME, themeId) as Promise<any>
    this.api.getAllWorkspaceThemes = async () => {
      await this.ensureInitialized()
      const localThemes = await this.localClient.invoke(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES) as Record<string, string | undefined>
      const merged: Record<string, string | undefined> = { ...localThemes }
      await Promise.allSettled([...this.remoteConnections.values()].map(async (connection) => {
        const themes = await connection.client.invoke(RPC_CHANNELS.theme.GET_ALL_WORKSPACE_THEMES) as Record<string, string | undefined>
        for (const [workspaceId, themeId] of Object.entries(themes)) {
          merged[buildRemoteWorkspaceTargetId(connection.profile.id, workspaceId)] = themeId
        }
      }))
      return merged
    }
    this.api.broadcastWorkspaceThemeChange = async (workspaceId: string, themeId: string | null) => {
      await this.invokeForWorkspace(workspaceId, RPC_CHANNELS.theme.BROADCAST_WORKSPACE_THEME, themeId)
    }
    this.api.onWorkspaceThemeChange = (callback: (data: { workspaceId: string; themeId: string | null }) => void) => {
      this.workspaceThemeChangedListeners.add(callback)
      return () => {
        this.workspaceThemeChangedListeners.delete(callback)
      }
    }
  }

  private overrideLlmMethods(): void {
    this.api.listLlmConnections = async () => this.invokeActive(RPC_CHANNELS.llmConnections.LIST) as Promise<any>
    this.api.listLlmConnectionsWithStatus = async () => this.invokeActive(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS) as Promise<any>
    this.api.getLlmConnection = async (slug: string) => this.invokeActive(RPC_CHANNELS.llmConnections.GET, slug) as Promise<any>
    this.api.getLlmConnectionApiKey = async (slug: string) => this.invokeActive(RPC_CHANNELS.llmConnections.GET_API_KEY, slug) as Promise<any>
    this.api.saveLlmConnection = async (connection: any) => this.invokeActive(RPC_CHANNELS.llmConnections.SAVE, connection) as Promise<any>
    this.api.deleteLlmConnection = async (slug: string) => this.invokeActive(RPC_CHANNELS.llmConnections.DELETE, slug) as Promise<any>
    this.api.testLlmConnection = async (slug: string) => this.invokeActive(RPC_CHANNELS.llmConnections.TEST, slug) as Promise<any>
    this.api.setDefaultLlmConnection = async (slug: string) => this.invokeActive(RPC_CHANNELS.llmConnections.SET_DEFAULT, slug) as Promise<any>
    this.api.setWorkspaceDefaultLlmConnection = async (workspaceId: string, slug: string | null) => this.invokeForWorkspace(workspaceId, RPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, slug) as Promise<any>
    this.api.getDefaultThinkingLevel = async () => this.invokeActive(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL) as Promise<any>
    this.api.setDefaultThinkingLevel = async (level: string) => this.invokeActive(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL, level) as Promise<any>
    this.api.listLlmConnectionsForTarget = async (target: WorkspaceCreationTarget) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.LIST) as Promise<any>
    }
    this.api.listLlmConnectionsWithStatusForTarget = async (target: WorkspaceCreationTarget) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.LIST_WITH_STATUS) as Promise<any>
    }
    this.api.getLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.GET, slug) as Promise<any>
    }
    this.api.getLlmConnectionApiKeyForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.GET_API_KEY, slug) as Promise<any>
    }
    this.api.saveLlmConnectionForTarget = async (target: WorkspaceCreationTarget, connection: any) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.SAVE, connection) as Promise<any>
    }
    this.api.deleteLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.DELETE, slug) as Promise<any>
    }
    this.api.testLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.TEST, slug) as Promise<any>
    }
    this.api.setDefaultLlmConnectionForTarget = async (target: WorkspaceCreationTarget, slug: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.llmConnections.SET_DEFAULT, slug) as Promise<any>
    }
    this.api.shareLlmConnectionToTarget = async (sourceTarget: WorkspaceCreationTarget, connectionSlug: string, destinationTarget: WorkspaceCreationTarget) => {
      const sourceClient = await this.getClientForTarget(sourceTarget)
      const destinationClient = await this.getClientForTarget(destinationTarget)
      const bundle = await sourceClient.invoke(RPC_CHANNELS.llmConnections.EXPORT_BUNDLE, connectionSlug) as LlmConnectionBundle

      let result: { success: boolean; slug: string; error?: string }
      let compatibilityWarning: string | undefined
      try {
        result = await destinationClient.invoke(RPC_CHANNELS.llmConnections.IMPORT_BUNDLE, bundle) as { success: boolean; slug: string; error?: string }
      } catch (error) {
        if (!isMissingHandlerError(error, RPC_CHANNELS.llmConnections.IMPORT_BUNDLE)) {
          throw error
        }

        result = await importLlmBundleCompat(destinationClient, bundle)
        compatibilityWarning = result.success ? getLlmCompatibilityWarning(bundle) : undefined
      }

      const warning = [getLlmShareWarning(bundle.connection), compatibilityWarning]
        .filter(Boolean)
        .join(' ')

      return {
        ...result,
        warning: result.success ? (warning || undefined) : undefined,
      }
    }
    this.api.getDefaultThinkingLevelForTarget = async (target: WorkspaceCreationTarget) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.settings.GET_DEFAULT_THINKING_LEVEL) as Promise<any>
    }
    this.api.setDefaultThinkingLevelForTarget = async (target: WorkspaceCreationTarget, level: string) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.settings.SET_DEFAULT_THINKING_LEVEL, level) as Promise<any>
    }
    this.api.setupLlmConnectionForTarget = async (target: WorkspaceCreationTarget, setup: any) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, setup) as Promise<any>
    }
    this.api.testLlmConnectionSetupForTarget = async (target: WorkspaceCreationTarget, params: any) => {
      const client = await this.getClientForTarget(target)
      return client.invoke(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, params) as Promise<any>
    }
    this.api.setupLlmConnection = async (setup: any) => this.invokeActive(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, setup) as Promise<any>
    this.api.testLlmConnectionSetup = async (params: any) => this.invokeActive(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, params) as Promise<any>
    this.api.startChatGptOAuth = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.chatgpt.START_OAUTH, connectionSlug) as Promise<any>
    this.api.cancelChatGptOAuth = async () => this.invokeActive(RPC_CHANNELS.chatgpt.CANCEL_OAUTH) as Promise<any>
    this.api.getChatGptAuthStatus = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.chatgpt.GET_AUTH_STATUS, connectionSlug) as Promise<any>
    this.api.chatGptLogout = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.chatgpt.LOGOUT, connectionSlug) as Promise<any>
    this.api.startCopilotOAuth = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.copilot.START_OAUTH, connectionSlug) as Promise<any>
    this.api.cancelCopilotOAuth = async () => this.invokeActive(RPC_CHANNELS.copilot.CANCEL_OAUTH) as Promise<any>
    this.api.getCopilotAuthStatus = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.copilot.GET_AUTH_STATUS, connectionSlug) as Promise<any>
    this.api.copilotLogout = async (connectionSlug: string) => this.invokeActive(RPC_CHANNELS.copilot.LOGOUT, connectionSlug) as Promise<any>

    this.api.onLlmConnectionsChanged = (callback: VoidListener) => {
      this.llmConnectionsChangedListeners.add(callback)
      this.rebindActiveListeners()
      return () => {
        this.llmConnectionsChangedListeners.delete(callback)
      }
    }
  }

  private overrideAutomationMethods(): void {
    this.api.testAutomation = async (payload: any) => {
      const workspaceId = payload?.workspaceId
      const targetWorkspaceId = typeof workspaceId === 'string' ? workspaceId : this.activeWorkspaceId
      const nativePayload = workspaceId
        ? { ...payload, workspaceId: parseRemoteWorkspaceTargetId(targetWorkspaceId)?.workspaceId ?? targetWorkspaceId }
        : payload
      return this.invokeForWorkspace(targetWorkspaceId, RPC_CHANNELS.automations.TEST, nativePayload) as Promise<any>
    }
    this.api.setAutomationEnabled = async (workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.SET_ENABLED, eventName, matcherIndex, enabled) as Promise<any>
    }
    this.api.duplicateAutomation = async (workspaceId: string, eventName: string, matcherIndex: number) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.DUPLICATE, eventName, matcherIndex) as Promise<any>
    }
    this.api.deleteAutomation = async (workspaceId: string, eventName: string, matcherIndex: number) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.DELETE, eventName, matcherIndex) as Promise<any>
    }
    this.api.getAutomationHistory = async (workspaceId: string, automationId: string, limit?: number) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.GET_HISTORY, automationId, limit) as Promise<any>
    }
    this.api.getAutomationLastExecuted = async (workspaceId: string) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.GET_LAST_EXECUTED) as Promise<any>
    }
    this.api.replayAutomation = async (workspaceId: string, automationId: string, eventName: string) => {
      return this.invokeForWorkspace(workspaceId, RPC_CHANNELS.automations.REPLAY, automationId, eventName) as Promise<any>
    }
  }

  private overrideTransportMethods(): void {
    this.api.getTransportConnectionState = async () => this.getActiveConnectionState()
    this.api.onTransportConnectionStateChanged = (callback: (state: TransportConnectionState) => void) => {
      this.transportListeners.add(callback)
      callback(this.getActiveConnectionState())
      return () => {
        this.transportListeners.delete(callback)
      }
    }
    this.api.reconnectTransport = async () => {
      const connection = this.getActiveRemoteConnection()
      if (connection) {
        connection.client.reconnectNow()
        return
      }
      this.localClient.reconnectNow()
    }
  }

  private async invokeActive(channel: string, ...args: any[]): Promise<any> {
    const client = await this.getActiveClient()
    return client.invoke(channel, ...args)
  }

  private async getClientForTarget(target: WorkspaceCreationTarget): Promise<RpcClient> {
    await this.ensureInitialized()
    if (target.mode === 'local') {
      return this.localClient
    }
    if (!target.serverId) {
      throw new Error('Select a remote server first')
    }
    const connection = await this.requireRemoteConnection(target.serverId)
    return connection.client
  }

  private async invokeActiveIfRemote(channel: string, _path: string, fallback: () => Promise<any>): Promise<any> {
    const connection = this.getActiveRemoteConnection()
    if (!connection) return fallback()
    return connection.client.invoke(channel, _path)
  }

  private async invokeForWorkspace(workspaceId: string, channel: string, ...rest: any[]): Promise<any> {
    const target = await this.resolveWorkspaceTarget(workspaceId)
    return target.client.invoke(channel, target.workspaceId, ...rest)
  }

  private async resolveWorkspaceTarget(workspaceId: string): Promise<{ client: RpcClient; workspaceId: string }> {
    const parsed = parseRemoteWorkspaceTargetId(workspaceId)
    if (!parsed) {
      return {
        client: this.localClient,
        workspaceId,
      }
    }

    const connection = await this.requireRemoteConnection(parsed.serverId)
    await this.selectRemoteWorkspace(connection, parsed.workspaceId)
    return {
      client: connection.client,
      workspaceId: parsed.workspaceId,
    }
  }

  private async getActiveClient(): Promise<RpcClient> {
    const parsed = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
    if (!parsed) return this.localClient
    const connection = await this.requireRemoteConnection(parsed.serverId)
    await this.selectRemoteWorkspace(connection, parsed.workspaceId)
    return connection.client
  }

  private async requireRemoteConnection(serverId: string): Promise<RemoteServerConnection> {
    await this.ensureInitialized()
    const existing = this.remoteConnections.get(serverId)
    if (existing) return existing

    const auth = await this.getAuthMaterialById(serverId)
    if (!auth || !auth.enabled || !auth.token) {
      throw new Error('Remote server is not configured or missing a token')
    }

    const profile = this.remoteProfiles.get(serverId)
    if (!profile) {
      throw new Error('Remote server profile not found')
    }
    if (isBlockedInsecureRemoteServer(profile)) {
      throw new Error('Unsecured ws:// connection blocked. Enable "Allow insecure ws://" for this server to connect.')
    }

    return this.createRemoteConnection(profile, auth)
  }

  private async refreshLocalWorkspaces(): Promise<void> {
    this.localWorkspaces = await this.localClient.invoke(RPC_CHANNELS.workspaces.GET) as Workspace[]
  }

  private getAggregatedWorkspaces(): Workspace[] {
    return [
      ...this.localWorkspaces,
      ...[...this.remoteConnections.values()]
        .flatMap(connection => connection.workspaces)
        .sort((a, b) => {
          const serverCompare = (a.remoteServerName ?? '').localeCompare(b.remoteServerName ?? '')
          if (serverCompare !== 0) return serverCompare
          return a.name.localeCompare(b.name)
        }),
    ]
  }

  private async reloadRemoteServers(): Promise<void> {
    await this.refreshLocalWorkspaces()
    const [profiles, authMaterials] = await Promise.all([
      this.localClient.invoke(RPC_CHANNELS.remoteServers.LIST) as Promise<RemoteServerProfile[]>,
      this.localClient.invoke(RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL) as Promise<RemoteServerAuthMaterial[]>,
    ])

    this.remoteProfiles = new Map(profiles.map(profile => [profile.id, profile]))
    const authById = new Map(authMaterials.map(material => [material.id, material]))

    for (const [serverId, connection] of [...this.remoteConnections.entries()]) {
      const nextProfile = this.remoteProfiles.get(serverId)
      const nextAuth = authById.get(serverId)
      const changed = !nextProfile
        || !nextAuth
        || !nextAuth.enabled
        || !nextAuth.token
        || nextAuth.url !== connection.auth.url
        || nextAuth.token !== connection.auth.token
        || isBlockedInsecureRemoteServer(nextProfile)
      if (!changed) {
        connection.profile = nextProfile
        connection.auth = nextAuth
        continue
      }
      connection.dispose()
      this.remoteConnections.delete(serverId)
    }

    await Promise.allSettled(profiles.map(async (profile) => {
      const auth = authById.get(profile.id)
      if (!auth || !auth.enabled || !auth.token) return
      if (isBlockedInsecureRemoteServer(profile)) return
      let connection = this.remoteConnections.get(profile.id)
      if (!connection) {
        connection = this.createRemoteConnection(profile, auth)
      }
      await this.tryRefreshRemoteWorkspaces(connection, 2_500)
    }))

    await this.reconcileInitialWorkspace()
    this.emitRemoteServersChanged()
    this.emitWorkspacesChanged()
    this.emitUnreadSummaryChanged()
    this.emitTransportStateChanged()
    this.rebindActiveListeners()
  }

  private async getAuthMaterialById(serverId: string): Promise<RemoteServerAuthMaterial | null> {
    const authMaterials = await this.localClient.invoke(RPC_CHANNELS.remoteServers.GET_AUTH_MATERIAL) as RemoteServerAuthMaterial[]
    return authMaterials.find(material => material.id === serverId) ?? null
  }

  private createRemoteConnection(profile: RemoteServerProfile, auth: RemoteServerAuthMaterial): RemoteServerConnection {
    const client = new WsRpcClient(auth.url, {
      token: auth.token ?? undefined,
      autoReconnect: true,
      mode: 'remote',
    })

    const connection: RemoteServerConnection = {
      profile,
      auth,
      client,
      workspaces: [],
      unreadSummary: emptyUnreadSummary(),
      runtime: buildRemoteRuntimeState(profile.id),
      selectedWorkspaceId: null,
      dispose: () => {},
    }

    const disposers: Array<() => void> = []
    disposers.push(client.onConnectionStateChanged((state) => {
      connection.runtime = {
        serverId: profile.id,
        status: state.status,
        workspaceCount: connection.workspaces.length,
        updatedAt: state.updatedAt,
        error: state.lastError?.message,
      }

      if (state.status === 'connected') {
        void this.refreshRemoteWorkspaces(connection)
        if (connection.selectedWorkspaceId) {
          void this.selectRemoteWorkspace(connection, connection.selectedWorkspaceId)
        }
        void this.refreshRemoteUnreadSummary(connection)
      } else if (state.status === 'failed' || state.status === 'disconnected') {
        connection.workspaces = []
        connection.unreadSummary = emptyUnreadSummary()
      }

      this.emitRemoteServersChanged()
      this.emitWorkspacesChanged()
      this.emitUnreadSummaryChanged()
      if (this.getActiveRemoteConnection()?.profile.id === profile.id) {
        this.emitTransportStateChanged()
      }
    }))

    disposers.push(client.on(RPC_CHANNELS.sessions.UNREAD_SUMMARY_CHANGED, (summary: UnreadSummary) => {
      connection.unreadSummary = this.translateUnreadSummary(profile.id, summary)
      this.emitUnreadSummaryChanged()
    }))
    disposers.push(client.on(RPC_CHANNELS.sources.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.sourcesChangedListeners, buildRemoteWorkspaceTargetId(profile.id, workspaceId), ...args)
    }))
    disposers.push(client.on(RPC_CHANNELS.skills.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.skillsChangedListeners, buildRemoteWorkspaceTargetId(profile.id, workspaceId), ...args)
    }))
    disposers.push(client.on(RPC_CHANNELS.labels.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.labelsChangedListeners, buildRemoteWorkspaceTargetId(profile.id, workspaceId), ...args)
    }))
    disposers.push(client.on(RPC_CHANNELS.statuses.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.statusesChangedListeners, buildRemoteWorkspaceTargetId(profile.id, workspaceId), ...args)
    }))
    disposers.push(client.on(RPC_CHANNELS.automations.CHANGED, (workspaceId: string, ...args: any[]) => {
      this.emitWorkspaceScoped(this.automationsChangedListeners, buildRemoteWorkspaceTargetId(profile.id, workspaceId), ...args)
    }))
    disposers.push(client.on(RPC_CHANNELS.theme.WORKSPACE_THEME_CHANGED, (data: { workspaceId: string; themeId: string | null }) => {
      this.emitWorkspaceThemeChanged({
        workspaceId: buildRemoteWorkspaceTargetId(profile.id, data.workspaceId),
        themeId: data.themeId,
      })
    }))

    connection.dispose = () => {
      for (const dispose of disposers) dispose()
      client.destroy()
    }

    client.connect()
    this.remoteConnections.set(profile.id, connection)
    const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
    if (activeRemote?.serverId === profile.id) {
      void this.selectRemoteWorkspace(connection, activeRemote.workspaceId)
    }
    return connection
  }

  private async refreshRemoteWorkspaces(connection: RemoteServerConnection): Promise<void> {
    try {
      const workspaces = await connection.client.invoke(RPC_CHANNELS.workspaces.GET) as Workspace[]
      connection.workspaces = workspaces.map(workspace => mapRemoteWorkspace(connection.profile, workspace))
      connection.runtime = {
        ...connection.runtime,
        workspaceCount: connection.workspaces.length,
        updatedAt: Date.now(),
      }
      await this.reconcileActiveRemoteWorkspace(connection)
      this.emitWorkspacesChanged()
      this.emitRemoteServersChanged()
    } catch {
      connection.workspaces = []
      this.emitWorkspacesChanged()
    }
  }

  private async refreshRemoteUnreadSummary(connection: RemoteServerConnection): Promise<void> {
    try {
      const summary = await connection.client.invoke(RPC_CHANNELS.sessions.GET_UNREAD_SUMMARY) as UnreadSummary
      connection.unreadSummary = this.translateUnreadSummary(connection.profile.id, summary)
      this.emitUnreadSummaryChanged()
    } catch {
      connection.unreadSummary = emptyUnreadSummary()
      this.emitUnreadSummaryChanged()
    }
  }

  private translateUnreadSummary(serverId: string, summary: UnreadSummary): UnreadSummary {
    const byWorkspace: Record<string, number> = {}
    const hasUnreadByWorkspace: Record<string, boolean> = {}
    for (const [workspaceId, count] of Object.entries(summary.byWorkspace)) {
      byWorkspace[buildRemoteWorkspaceTargetId(serverId, workspaceId)] = count
    }
    for (const [workspaceId, hasUnread] of Object.entries(summary.hasUnreadByWorkspace)) {
      hasUnreadByWorkspace[buildRemoteWorkspaceTargetId(serverId, workspaceId)] = hasUnread
    }
    return {
      totalUnreadSessions: summary.totalUnreadSessions,
      byWorkspace,
      hasUnreadByWorkspace,
    }
  }

  private aggregateUnreadSummary(): UnreadSummary {
    const total = this.localUnreadSummary.totalUnreadSessions
      + [...this.remoteConnections.values()].reduce((sum, connection) => sum + connection.unreadSummary.totalUnreadSessions, 0)

    const byWorkspace: Record<string, number> = { ...this.localUnreadSummary.byWorkspace }
    const hasUnreadByWorkspace: Record<string, boolean> = { ...this.localUnreadSummary.hasUnreadByWorkspace }

    for (const connection of this.remoteConnections.values()) {
      Object.assign(byWorkspace, connection.unreadSummary.byWorkspace)
      Object.assign(hasUnreadByWorkspace, connection.unreadSummary.hasUnreadByWorkspace)
    }

    return {
      totalUnreadSessions: total,
      byWorkspace,
      hasUnreadByWorkspace,
    }
  }

  private async reconcileInitialWorkspace(): Promise<void> {
    const parsed = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
    if (!parsed) {
      if (this.localWorkspaces.some(workspace => workspace.id === this.activeWorkspaceId)) return
      await this.fallbackToLatestLocalWorkspace()
      return
    }

    const connection = this.remoteConnections.get(parsed.serverId)
    if (!connection) {
      await this.fallbackToLatestLocalWorkspace()
      return
    }

    if (connection.workspaces.some(workspace => workspace.remoteWorkspaceId === parsed.workspaceId)) {
      await this.selectRemoteWorkspace(connection, parsed.workspaceId)
      return
    }

    const refreshed = await this.tryRefreshRemoteWorkspaces(connection, 2_500)
    if (!refreshed) return
    if (connection.workspaces.some(workspace => workspace.remoteWorkspaceId === parsed.workspaceId)) {
      await this.selectRemoteWorkspace(connection, parsed.workspaceId)
      return
    }

    await this.fallbackToLatestLocalWorkspace()
  }

  private async tryRefreshRemoteWorkspaces(connection: RemoteServerConnection, timeoutMs: number): Promise<boolean> {
    return await Promise.race([
      this.refreshRemoteWorkspaces(connection).then(() => true).catch(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
    ])
  }

  private getLatestLocalWorkspaceId(): string | null {
    const [latestWorkspace] = [...this.localWorkspaces].sort((left, right) => {
      const leftTimestamp = left.lastAccessedAt ?? left.createdAt
      const rightTimestamp = right.lastAccessedAt ?? right.createdAt
      return rightTimestamp - leftTimestamp
    })
    return latestWorkspace?.id ?? null
  }

  private getFallbackWorkspaceId(excludedWorkspaceId: string): string | null {
    const localFallback = [...this.localWorkspaces]
      .filter(workspace => workspace.id !== excludedWorkspaceId)
      .sort((left, right) => {
        const leftTimestamp = left.lastAccessedAt ?? left.createdAt
        const rightTimestamp = right.lastAccessedAt ?? right.createdAt
        return rightTimestamp - leftTimestamp
      })[0]

    if (localFallback) return localFallback.id

    const remoteFallback = [...this.remoteConnections.values()]
      .flatMap(connection => connection.workspaces)
      .find(workspace => workspace.id !== excludedWorkspaceId)

    return remoteFallback?.id ?? null
  }

  private async fallbackToLatestLocalWorkspace(): Promise<void> {
    const fallbackWorkspaceId = this.getLatestLocalWorkspaceId()
    if (!fallbackWorkspaceId || fallbackWorkspaceId === this.activeWorkspaceId) return

    await this.switchActiveWindowWorkspace(fallbackWorkspaceId)
  }

  private async switchActiveWindowWorkspace(workspaceId: string): Promise<void> {
    this.activeWorkspaceId = workspaceId
    try {
      await this.localClient.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, workspaceId)
    } catch {
      // Keep renderer state usable even if main-process window state update fails.
    }
    const parsed = parseRemoteWorkspaceTargetId(workspaceId)
    if (parsed) {
      const connection = await this.requireRemoteConnection(parsed.serverId)
      await this.selectRemoteWorkspace(connection, parsed.workspaceId)
    }
    this.rebindActiveListeners()
    this.emitTransportStateChanged()
  }

  private async setActiveWorkspace(workspaceId: string): Promise<void> {
    this.activeWorkspaceId = workspaceId
    const parsed = parseRemoteWorkspaceTargetId(workspaceId)
    if (parsed) {
      const connection = await this.requireRemoteConnection(parsed.serverId)
      await this.selectRemoteWorkspace(connection, parsed.workspaceId)
    }
    this.rebindActiveListeners()
    this.emitTransportStateChanged()
  }

  private async selectRemoteWorkspace(connection: RemoteServerConnection, workspaceId: string): Promise<void> {
    if (connection.selectedWorkspaceId === workspaceId) return
    connection.selectedWorkspaceId = workspaceId
    try {
      await connection.client.invoke(RPC_CHANNELS.window.SWITCH_WORKSPACE, workspaceId)
    } catch {
      // Connection state listeners surface the failure; keep the desired workspace cached.
    }
  }

  private async reconcileActiveRemoteWorkspace(connection: RemoteServerConnection): Promise<void> {
    const activeRemote = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
    if (!activeRemote || activeRemote.serverId !== connection.profile.id) return

    const activeWorkspaceExists = connection.workspaces.some(workspace => workspace.remoteWorkspaceId === activeRemote.workspaceId)
    if (activeWorkspaceExists) return

    await this.fallbackToLatestLocalWorkspace()
  }

  private rebindActiveListeners(): void {
    for (const dispose of this.activeListenerDisposers) dispose()
    this.activeListenerDisposers = []

    const activeRemote = this.getActiveRemoteConnection()
    const client: RpcClient = activeRemote?.client ?? this.localClient

    if (this.sessionEventListeners.size > 0) {
      this.activeListenerDisposers.push(client.on(RPC_CHANNELS.sessions.EVENT, (...args: any[]) => {
        for (const listener of this.sessionEventListeners) listener(...args)
      }))
    }
    if (this.sessionFilesChangedListeners.size > 0) {
      this.activeListenerDisposers.push(client.on(RPC_CHANNELS.sessions.FILES_CHANGED, (sessionId: string) => {
        for (const listener of this.sessionFilesChangedListeners) listener(sessionId)
      }))
    }
    if (this.llmConnectionsChangedListeners.size > 0) {
      this.activeListenerDisposers.push(client.on(RPC_CHANNELS.llmConnections.CHANGED, () => {
        for (const listener of this.llmConnectionsChangedListeners) listener()
      }))
    }
    if (this.defaultPermissionsChangedListeners.size > 0) {
      this.activeListenerDisposers.push(client.on(RPC_CHANNELS.permissions.DEFAULTS_CHANGED, (value: null) => {
        for (const listener of this.defaultPermissionsChangedListeners) listener(value)
      }))
    }
  }

  private getActiveRemoteConnection(): RemoteServerConnection | null {
    const parsed = parseRemoteWorkspaceTargetId(this.activeWorkspaceId)
    if (!parsed) return null
    return this.remoteConnections.get(parsed.serverId) ?? null
  }

  private getActiveConnectionState(): TransportConnectionState {
    const activeRemote = this.getActiveRemoteConnection()
    if (activeRemote) {
      return activeRemote.client.getConnectionState()
    }
    return this.localClient.getConnectionState()
  }

  private emitRemoteServersChanged(): void {
    for (const listener of this.remoteServerListeners) listener()
  }

  private emitWorkspacesChanged(): void {
    for (const listener of this.workspaceListeners) listener()
  }

  private emitUnreadSummaryChanged(): void {
    const summary = this.aggregateUnreadSummary()
    for (const listener of this.unreadSummaryListeners) listener(summary)
  }

  private emitTransportStateChanged(): void {
    const state = this.getActiveConnectionState()
    for (const listener of this.transportListeners) listener(state)
  }

  private emitWorkspaceScoped(listeners: Set<(workspaceId: string, ...args: any[]) => void>, workspaceId: string, ...args: any[]): void {
    for (const listener of listeners) listener(workspaceId, ...args)
  }

  private emitWorkspaceThemeChanged(data: { workspaceId: string; themeId: string | null }): void {
    for (const listener of this.workspaceThemeChangedListeners) listener(data)
  }
}

export function installWorkspaceTransportBroker(
  api: ElectronAPI,
  localClient: WsRpcClient,
  initialWorkspaceId: string,
): ElectronAPI {
  const broker = new WorkspaceTransportBroker(api, localClient, initialWorkspaceId)
  return broker.install()
}
