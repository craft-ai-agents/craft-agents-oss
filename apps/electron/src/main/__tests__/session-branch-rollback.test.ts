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

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
}))

mock.module('@sentry/electron/main', () => ({
  captureException: () => {},
}))

mock.module('../logger', () => ({
  sessionLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  isDebugMode: false,
  getLogFilePath: () => '/tmp/main.log',
}))

mock.module('../notifications', () => ({
  updateBadgeCount: () => {},
}))

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
  ConfigWatcher: class ConfigWatcher {
    constructor(..._args: unknown[]) {}
    start() {}
    stop() {}
  },
  migrateLegacyCredentials: async () => {},
  migrateLegacyLlmConnectionsConfig: async () => {},
  migrateOrphanedDefaultConnections: async () => {},
  MODEL_REGISTRY: [],
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
  setPermissionMode: () => {},
  getPermissionModeDiagnostics: () => ({ mode: 'ask', source: 'test' }),
  unregisterSessionScopedToolCallbacks: () => {},
  mergeSessionScopedToolCallbacks: () => {},
  AbortReason: {
    USER_REQUEST: 'user_request',
  },
}))

mock.module('@craft-agent/shared/agent/backend', () => ({
  resolveSessionConnection: () => null,
  createBackendFromConnection: () => {
    throw new Error('not used in this test')
  },
  resolveBackendContext: () => ({
    provider: 'anthropic',
    resolvedModel: 'claude-sonnet-4-20250514',
    connection: { providerType: 'anthropic' },
  }),
  createBackendFromResolvedContext: () => {
    throw new Error('not used in this test')
  },
  cleanupSourceRuntimeArtifacts: async () => {},
  providerTypeToAgentProvider: () => 'anthropic',
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
  pickSessionFields: (s: any) => ({ ...s }),
}))

const { SessionManager } = await import('../sessions')

describe('session branch rollback on preflight failure', () => {
  beforeEach(() => {
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
})
