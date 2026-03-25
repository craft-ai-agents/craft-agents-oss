import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'

const tempConfigDir = mkdtempSync(path.join(tmpdir(), 'craft-agent-session-model-'))
const originalConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = tempConfigDir

const sharedConfig = await import('@craft-agent/shared/config')
const serverCoreSessions = await import('./SessionManager.ts')

const { saveConfig } = sharedConfig
const { SessionManager, createManagedSession } = serverCoreSessions

const workspace = {
  id: 'ws-update-model-test',
  name: 'Test Workspace',
  rootPath: path.join(tempConfigDir, 'workspace'),
  createdAt: Date.now(),
}

const connections: LlmConnection[] = [
  {
    slug: 'conn-anthropic',
    name: 'Anthropic',
    providerType: 'anthropic',
    authType: 'environment',
    models: ['claude-3-opus'],
    createdAt: Date.now(),
  },
  {
    slug: 'conn-pi-openai',
    name: 'OpenAI via Pi',
    providerType: 'pi',
    authType: 'api_key',
    piAuthProvider: 'openai',
    models: ['gpt-4o'],
    createdAt: Date.now() + 1,
  },
]

const sessionId = 'session-update-model-test'

function configureConfig(): void {
  mkdirSync(workspace.rootPath, { recursive: true })
  saveConfig({
    workspaces: [workspace],
    activeWorkspaceId: workspace.id,
    activeSessionId: null,
    llmConnections: [...connections],
    defaultLlmConnection: connections[0].slug,
  })
}

function buildManager() {
  const manager = new SessionManager()
  const events: Array<Record<string, any>> = []
  manager.setEventSink((_channel, _target, event) => {
    events.push(event as Record<string, any>)
  })

  const managed = createManagedSession({
    id: sessionId,
    llmConnection: connections[0].slug,
    model: 'claude-3-opus',
  }, workspace, {
    messages: [],
    messagesLoaded: true,
  })

  const sessions = (manager as unknown as { sessions: Map<string, typeof managed> }).sessions
  sessions.set(sessionId, managed)

  return { manager, managed, events, sessions }
}

function buildMockAgent() {
  const setModelCalls: string[] = []
  let disposeCalls = 0

  return {
    setModelCalls,
    get disposeCalls() {
      return disposeCalls
    },
    agent: {
      setModel(model: string) {
        setModelCalls.push(model)
      },
      dispose() {
        disposeCalls += 1
      },
      supportsBranching: true,
    },
  }
}

beforeEach(() => {
  configureConfig()
})

afterAll(() => {
  process.env.CRAFT_CONFIG_DIR = originalConfigDir
  rmSync(tempConfigDir, { recursive: true, force: true })
})

describe('SessionManager.updateSessionModel', () => {
  it('updates both connection and model when requested connection is valid and unlocked', async () => {
    const { manager, managed, events } = buildManager()

    await manager.updateSessionModel(sessionId, workspace.id, 'gpt-4.1', connections[1].slug)

    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(managed.model).toBe('gpt-4.1')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'gpt-4.1',
    })
  })

  it('keeps model update when requested connection is invalid', async () => {
    const { manager, managed, events } = buildManager()

    await manager.updateSessionModel(sessionId, workspace.id, 'model-fallback', 'missing-connection')

    expect(managed.llmConnection).toBe(connections[0].slug)
    expect(managed.model).toBe('model-fallback')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'model-fallback',
    })
  })

  it('switches connection even when the original session connection is locked', async () => {
    const { manager, managed, events } = buildManager()
    managed.connectionLocked = true

    await manager.updateSessionModel(sessionId, workspace.id, 'model-locked', connections[1].slug)

    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(managed.model).toBe('model-locked')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'model-locked',
    })
  })

  it('updates the live agent model in place when the connection does not change', async () => {
    const { manager, managed, events } = buildManager()
    const mockAgent = buildMockAgent()
    managed.agent = mockAgent.agent as any
    managed.messages = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      isQueued: false,
      isPending: false,
      attachments: [],
    }] as unknown as typeof managed.messages

    await manager.updateSessionModel(sessionId, workspace.id, 'claude-3-5-sonnet', connections[0].slug)

    expect(mockAgent.setModelCalls).toEqual(['claude-3-5-sonnet'])
    expect(mockAgent.disposeCalls).toBe(0)
    expect(managed.pendingResponseRuntimeChange).toBe(true)
    expect(managed.agent).toBe(mockAgent.agent as any)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'claude-3-5-sonnet',
    })
  })

  it('does not mark the first response as a runtime change before any conversation exists', async () => {
    const { manager, managed, events } = buildManager()

    await manager.updateSessionModel(sessionId, workspace.id, 'gpt-4.1', connections[1].slug)

    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(managed.model).toBe('gpt-4.1')
    expect(managed.pendingResponseRuntimeChange).toBeUndefined()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'gpt-4.1',
    })
  })

  it('recreates a live session backend when the connection changes', async () => {
    const { manager, managed, events } = buildManager()
    const mockAgent = buildMockAgent()
    managed.agent = mockAgent.agent as any
    managed.sdkSessionId = 'sdk-session-old'
    managed.messages = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      isQueued: false,
      isPending: false,
      attachments: [],
    }] as unknown as typeof managed.messages

    await manager.updateSessionModel(sessionId, workspace.id, 'gpt-4.1', connections[1].slug)

    expect(mockAgent.disposeCalls).toBe(1)
    expect(mockAgent.setModelCalls).toEqual([])
    expect(managed.agent).toBeNull()
    expect(managed.sdkSessionId).toBeUndefined()
    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(managed.model).toBe('gpt-4.1')
    expect(managed.branchContextStrategy as 'sdk-fork' | 'seeded-fresh-session' | undefined).toBe('seeded-fresh-session')
    expect(managed.branchSeedApplied).toBe(false)
    expect(managed.branchFromMessageId).toBe('message-1')
    expect(managed.pendingResponseRuntimeChange).toBe(true)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'gpt-4.1',
    })
  })

  it('resets sdk lineage on connection change even without a live agent', async () => {
    const { manager, managed, events } = buildManager()

    managed.sdkSessionId = 'sdk-session-old'
    managed.branchContextStrategy = 'sdk-fork'
    managed.branchSeedApplied = true
    managed.branchFromSdkSessionId = 'branch-sdk-old'
    managed.branchFromSessionPath = '/tmp/source-session'
    managed.branchFromSdkCwd = '/tmp/source-cwd'
    managed.branchFromSdkTurnId = 'turn-old'
    managed.messages = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      isQueued: false,
      isPending: false,
      attachments: [],
    }] as unknown as typeof managed.messages

    await manager.updateSessionModel(sessionId, workspace.id, 'gpt-4.1', connections[1].slug)

    expect(managed.agent).toBeNull()
    expect(managed.sdkSessionId).toBeUndefined()
    expect(String(managed.branchContextStrategy)).toBe('seeded-fresh-session')
    expect(managed.branchSeedApplied).toBe(false)
    expect(managed.branchFromMessageId).toBe('message-1')
    expect(managed.branchFromSdkSessionId).toBeUndefined()
    expect(managed.branchFromSessionPath).toBeUndefined()
    expect(managed.branchFromSdkCwd).toBeUndefined()
    expect(managed.branchFromSdkTurnId).toBeUndefined()
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'gpt-4.1',
    })
  })

  it('does not emit a connection change event when connection is unchanged', async () => {
    const { manager, managed, events } = buildManager()

    await manager.updateSessionModel(sessionId, workspace.id, 'same-conn-model', connections[0].slug)

    expect(managed.llmConnection).toBe(connections[0].slug)
    expect(managed.model).toBe('same-conn-model')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'same-conn-model',
    })
  })
})

describe('SessionManager.setSessionConnection', () => {
  it('allows changing connection before first message', async () => {
    const { manager, managed, events } = buildManager()

    await manager.setSessionConnection(sessionId, connections[1].slug)

    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
    })
  })

  it('allows updateSessionModel to switch connection when connectionLocked is false', async () => {
    const { manager, managed, events } = buildManager()

    managed.messages = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      isQueued: false,
      isPending: false,
      attachments: [],
    }] as unknown as typeof managed.messages

    await manager.updateSessionModel(sessionId, workspace.id, 'model-mid-session', connections[1].slug)

    expect(managed.llmConnection).toBe(connections[1].slug)
    expect(managed.model).toBe('model-mid-session')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'connection_changed',
      sessionId,
      connectionSlug: connections[1].slug,
      supportsBranching: true,
    })
    expect(events[1]).toMatchObject({
      type: 'session_model_changed',
      sessionId,
      model: 'model-mid-session',
    })
  })

  it('rejects connection change after first message is sent', async () => {
    const { manager, managed, events } = buildManager()

    managed.messages = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      isQueued: false,
      isPending: false,
      attachments: [],
    }] as unknown as typeof managed.messages

    await expect(manager.setSessionConnection(sessionId, connections[1].slug)).rejects.toThrow('Cannot change connection after session has started')

    expect(managed.llmConnection).toBe(connections[0].slug)
    expect(events).toHaveLength(0)
  })
})
