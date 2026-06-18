import { beforeEach, describe, expect, it, mock } from 'bun:test'

const workspaceRootPath = '/tmp/ws-rollback'
const workspace = {
  id: 'ws-1',
  name: 'Workspace',
  rootPath: workspaceRootPath,
}

let idCounter = 0
const storedById = new Map<string, any>()
const deletedIds: string[] = []
let mockedProvider: 'anthropic' | 'pi' = 'anthropic'

// Partial-mock baseline: import real modules via file paths (avoids recursive mock imports)
const actualSharedAgentModule = await import('../../../../../packages/shared/src/agent/index.ts')
const actualSharedAgentBackendModule = await import('../../../../../packages/shared/src/agent/backend/index.ts')

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    dock: { setIcon: () => {}, setBadge: () => {} },
    setBadgeCount: () => {},
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  Notification: class {
    static isSupported() { return false }
    on() {}
    show() {}
  },
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
}))

mock.module('@sentry/electron/main', () => ({
  captureException: () => {},
}))

mock.module('../logger', () => {
  const stubLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  return {
    mainLog: stubLog,
    sessionLog: stubLog,
    handlerLog: stubLog,
    windowLog: stubLog,
    agentLog: stubLog,
    searchLog: stubLog,
    isDebugMode: false,
    getLogFilePath: () => '/tmp/main.log',
  }
})

mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => (id === workspace.id ? workspace : null),
  getWorkspaces: () => [workspace],
  loadConfigDefaults: () => ({
    workspaceDefaults: {
      permissionMode: 'ask',
      thinkingLevel: 'medium',
    },
  }),
  getLlmConnection: () => null,
  getDefaultLlmConnection: () => null,
  resolveAuthEnvVars: () => ({}),
  getToolIconsDir: () => '/tmp/tool-icons',
  getMiniModel: () => 'claude-haiku-4-5-20251001',
  getDefaultThinkingLevel: () => 'medium',
  ConfigWatcher: class ConfigWatcher {
    constructor(..._args: unknown[]) {}
    start() {}
    stop() {}
  },
  migrateLegacyCredentials: async () => {},
  migrateLegacyLlmConnectionsConfig: async () => {},
  migrateOrphanedDefaultConnections: async () => {},
  MODEL_REGISTRY: [],
  // Targeted stubs: prevent SyntaxError in tests that import these from the barrel
  DEFAULT_MODEL: 'claude-sonnet-4-20250514',
  DEFAULT_THEME: { mode: 'system' },
  getDefaultModelsForConnection: () => ({ default: 'claude-sonnet-4-20250514', mini: 'claude-haiku-4-5-20251001' }),
  getDefaultModelForConnection: () => 'claude-sonnet-4-20250514',
  setGitBashPath: () => {},
  clearGitBashPath: () => {},
  setActiveWorkspace: () => {},
  getSummarizationModel: () => 'claude-haiku-4-5-20251001',
  ensureConfigDir: () => {},
  ensureConfigDefaults: () => {},
  addWorkspace: async () => null,
  getAllSessionDrafts: () => [],
  getGitBashPath: () => null,
  // Handler-required stubs: prevent SyntaxError in handler modules loaded by registration test
  getPreferencesPath: () => '/tmp/preferences.json',
  getSessionDraft: () => null,
  setSessionDraft: async () => {},
  deleteSessionDraft: async () => {},
  getLlmConnections: () => [],
  addLlmConnection: async () => null,
  updateLlmConnection: async () => null,
  deleteLlmConnection: async () => {},
  setDefaultLlmConnection: async () => {},
  touchLlmConnection: async () => {},
  isCompatProvider: () => false,
  isAnthropicProvider: () => true,
}))

mock.module('@craft-agent/shared/workspaces', () => ({
  loadWorkspaceConfig: () => ({
    defaults: {
      permissionMode: 'ask',
      thinkingLevel: 'medium',
      defaultLlmConnection: undefined,
    },
  }),
}))

mock.module('@craft-agent/shared/agent', () => ({
  ...actualSharedAgentModule,
  setPermissionMode: () => {},
  getPermissionModeDiagnostics: () => ({ mode: 'ask', source: 'test' }),
  unregisterSessionScopedToolCallbacks: () => {},
  mergeSessionScopedToolCallbacks: () => {},
  hydratePreviousPermissionMode: () => {},
  initializeModeState: () => {},
  cleanupModeState: () => {},
  getPermissionMode: () => 'ask',
  registerSessionScopedToolCallbacks: () => {},
  cleanupSessionScopedTools: () => {},
  getSessionScopedTools: () => [],
  normalizeCanonicalBrowserToolName: (name: string) => name,
}))

mock.module('@craft-agent/shared/agent/backend', () => ({
  ...actualSharedAgentBackendModule,
  resolveSessionConnection: () => null,
  createBackendFromConnection: () => {
    throw new Error('not used in this test')
  },
  resolveBackendContext: () => ({
    provider: mockedProvider,
    resolvedModel: mockedProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'pi/gpt-5',
    connection: { providerType: mockedProvider === 'anthropic' ? 'anthropic' : 'pi' },
  }),
  createBackendFromResolvedContext: () => {
    throw new Error('not used in this test')
  },
  cleanupSourceRuntimeArtifacts: async () => {},
  providerTypeToAgentProvider: () => 'anthropic',
  fetchBackendModels: async () => ({ models: [] }),
  initializeBackendHostRuntime: () => {},
  resolveBackendHostTooling: () => ({
    sourceCredentialManager: null,
    sourceServerBuilder: null,
    sourcePoolFactory: null,
    sourcePoolServerFactory: null,
  }),
  testBackendConnection: async () => ({ success: false, error: 'stub' }),
  validateStoredBackendConnection: async () => ({ success: false, error: 'stub' }),
}))

mock.module('@craft-agent/shared/sources', () => ({
  loadWorkspaceSources: () => [],
  loadAllSources: () => [],
  getSourcesBySlugs: () => [],
  isSourceUsable: () => true,
  getSourcesNeedingAuth: () => [],
  getSourceCredentialManager: () => ({
    getCredentialStatus: async () => ({ status: 'ready' }),
  }),
  getSourceServerBuilder: () => ({ buildServers: async () => ({ mcpServers: {}, apiServers: {} }) }),
  isApiOAuthProvider: () => false,
  SERVER_BUILD_ERRORS: {},
  TokenRefreshManager: class TokenRefreshManager {
    constructor(_mgr: unknown, _opts: unknown) {}
  },
  createTokenGetter: () => async () => null,
  // Targeted stubs: prevent SyntaxError in tests that import these from the barrel
  loadSource: () => null,
  API_OAUTH_PROVIDERS: [],
}))

mock.module('@craft-agent/shared/automations', () => ({
  AutomationSystem: class AutomationSystem {
    constructor(..._args: unknown[]) {}
    setInitialSessionMetadata() {}
    reloadConfig() { return { errors: [], automationCount: 0 } }
    emitLabelConfigChange = async () => {}
  },
  validateAutomationsConfig: () => ({ valid: true, errors: [], config: { automations: {} } }),
  validateAutomationsContent: () => ({ valid: true, errors: [], warnings: [] }),
  validateAutomations: () => ({ valid: true, errors: [], warnings: [] }),
  AUTOMATIONS_CONFIG_FILE: 'automations.json',
  AUTOMATIONS_HISTORY_FILE: 'automations.history.jsonl',
}))

mock.module('@craft-agent/shared/sessions', () => ({
  listSessions: () => [],
  loadSession: (_root: string, id: string) => storedById.get(id) ?? null,
  saveSession: async (session: any) => {
    storedById.set(session.id, session)
  },
  createSession: async (_root: string, opts: any) => {
    const id = `child-${++idCounter}`
    const now = Date.now()
    const session = {
      id,
      name: opts?.name ?? null,
      messages: [],
      permissionMode: opts?.permissionMode ?? 'ask',
      workingDirectory: opts?.workingDirectory,
      hidden: !!opts?.hidden,
      labels: [],
      isFlagged: false,
      sessionStatus: opts?.sessionStatus,
      createdAt: now,
      lastUsedAt: now,
      workspaceRootPath: workspaceRootPath,
    }
    storedById.set(id, session)
    return session
  },
  deleteSession: async (_root: string, id: string) => {
    deletedIds.push(id)
    storedById.delete(id)
  },
  updateSessionMetadata: async () => {},
  canUpdateSdkCwd: () => false,
  setPendingPlanExecution: async () => {},
  markCompactionComplete: async () => {},
  clearPendingPlanExecution: async () => {},
  getPendingPlanExecution: async () => null,
  getSessionAttachmentsPath: () => '/tmp/attachments',
  getSessionPath: (_root: string, id: string) => `${workspaceRootPath}/sessions/${id}`,
  getOrCreateLatestSession: async () => null,
  sessionPersistenceQueue: { flush: async () => {} },
  pickSessionFields: (s: any) => {
    // Must match SESSION_PERSISTENT_FIELDS to prevent contamination of persistence tests
    const fields = [
      'id','workspaceRootPath','sdkSessionId','sdkCwd',
      'createdAt','lastUsedAt','lastMessageAt',
      'name','isFlagged','sessionStatus','labels','hidden',
      'lastReadMessageId','hasUnread',
      'enabledSourceSlugs','permissionMode','previousPermissionMode','workingDirectory',
      'model','llmConnection','connectionLocked','thinkingLevel',
      'sharedUrl','sharedId','pendingPlanExecution',
      'isArchived','archivedAt',
      'branchFromMessageId','branchFromSdkSessionId','branchFromSessionPath',
    ]
    const result: Record<string, unknown> = {}
    for (const f of fields) if (f in s) result[f] = (s as Record<string, unknown>)[f]
    return result
  },
  validateSessionId: () => true,
}))

const { SessionManager } = await import('@craft-agent/server-core/sessions')

describe('session branch rollback on preflight failure', () => {
  beforeEach(() => {
    mockedProvider = 'anthropic'
    idCounter = 0
    storedById.clear()
    deletedIds.length = 0

    storedById.set('source-1', {
      id: 'source-1',
      workspaceRootPath,
      llmConnection: undefined,
      model: 'claude-sonnet-4-20250514',
      sdkSessionId: 'sdk-parent',
      messages: [
        { id: 'm1', type: 'user', content: 'hello', timestamp: Date.now() - 10 },
        { id: 'm2', type: 'assistant', content: 'hi', timestamp: Date.now() - 5 },
      ],
      createdAt: Date.now() - 20,
      lastUsedAt: Date.now() - 5,
    })
  })

  it('deletes newly created child session when ensureBranchReady throws', async () => {
    const manager = new SessionManager()

    let destroyCalled = false
    let poolStopCalled = false

    ;(manager as any).ensureMessagesLoaded = async (_managed: any) => {}
    ;(manager as any).getOrCreateAgent = async (managed: any) => {
      managed.poolServer = { stop: () => { poolStopCalled = true } }
      managed.agent = {
        supportsBranching: true,
        ensureBranchReady: async () => {
          throw new Error('preflight boom')
        },
        destroy: () => {
          destroyCalled = true
        },
      }
      return managed.agent
    }

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('Could not create branch: preflight boom')

    expect(deletedIds).toEqual(['child-1'])
    expect(storedById.has('child-1')).toBe(false)
    expect((manager as any).sessions.has('child-1')).toBe(false)
    expect(destroyCalled).toBe(true)
    expect(poolStopCalled).toBe(true)
  })

  it('fails branch creation when parent claude sdk session id is missing', async () => {
    const source = storedById.get('source-1')
    source.sdkSessionId = undefined
    storedById.set('source-1', source)

    const manager = new SessionManager()

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('parent session SDK context is not initialized')

    expect(deletedIds).toEqual([])
    expect(storedById.has('child-1')).toBe(false)
  })

  it('runs backend preflight for pi branches and rolls back on failure', async () => {
    mockedProvider = 'pi'

    const manager = new SessionManager()
    let getOrCreateAgentCalled = false

    ;(manager as any).ensureMessagesLoaded = async (_managed: any) => {}
    ;(manager as any).getOrCreateAgent = async (managed: any) => {
      getOrCreateAgentCalled = true
      managed.poolServer = { stop: () => {} }
      managed.agent = {
        supportsBranching: true,
        ensureBranchReady: async () => {
          throw new Error('pi preflight boom')
        },
        destroy: () => {},
      }
      return managed.agent
    }

    await expect(
      manager.createSession('ws-1', {
        branchFromSessionId: 'source-1',
        branchFromMessageId: 'm1',
      } as any)
    ).rejects.toThrow('Could not create branch: pi preflight boom')

    expect(getOrCreateAgentCalled).toBe(true)
    expect(deletedIds).toEqual(['child-1'])
    expect(storedById.has('child-1')).toBe(false)
  })
})
