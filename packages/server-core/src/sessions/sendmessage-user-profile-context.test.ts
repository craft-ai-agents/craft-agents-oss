import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentEvent } from '@craft-agent/shared/agent'
import { getSessionFilePath, writeSessionJsonl } from '@craft-agent/shared/sessions'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import type { UserProfileProvider } from './user-profile-context.ts'

describe('sendMessage user profile context', () => {
  let tmpRoot: string
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-profile-context-'))
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('passes expanded profile context to the backend while persisting only a redacted reference', async () => {
    let chatMessage = ''
    const provider: UserProfileProvider = {
      fetchUserProfile: async () => ({
        userName: 'Ada Lovelace',
        ystId: 'OS-12345',
        zuName: 'AI Platform',
        shiName: 'Engineering',
        chargeModule: [{ appCode: 'sessions', appName: 'Sessions' }],
      }),
    }

    const sm = new SessionManager({
      userProfileProvider: provider,
      userProfileCachePath: join(tmpRoot, 'profile-cache.json'),
    })
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id: 'profile-session', name: 'profile context' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.agent = {
      chat: async function* (message: string): AsyncGenerator<AgentEvent> {
        chatMessage = message
        yield { type: 'complete' } as AgentEvent
      },
      setAllSources: () => {},
      setSourceServers: () => {},
      getModel: () => 'test-model',
      getSessionId: () => null,
      getActiveSourceSlugs: () => [],
      getAllSources: () => [],
      getSummarizeCallback: () => async () => null,
      isProcessing: () => false,
    } as never
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)

    await sm.sendMessage(managed.id, 'hello')

    expect(chatMessage).toContain('hello')
    expect(chatMessage).toContain('<user_profile')
    expect(chatMessage).toContain('YST ID: OS-12345')

    const lines = readFileSync(getSessionFilePath(tmpRoot, managed.id), 'utf-8').trim().split('\n')
    const storedUserMessage = JSON.parse(lines[1]!)
    expect(storedUserMessage.content).toBe('hello')
    expect(storedUserMessage.dynamicContextRef).toEqual({
      type: 'user_profile',
      status: 'fresh',
      fetchedAt: expect.any(Number),
      summary: 'User profile context available',
    })
    expect(JSON.stringify(storedUserMessage)).not.toContain('Ada Lovelace')
    expect(JSON.stringify(storedUserMessage)).not.toContain('AI Platform')
    expect(JSON.stringify(storedUserMessage)).not.toContain('Engineering')
    expect(JSON.stringify(storedUserMessage)).not.toContain('OS-12345')
    expect(JSON.stringify(storedUserMessage)).not.toContain('<user_profile')
  })

  it('preserves safe branch history refs while recomputing fresh profile context for new branch messages', async () => {
    const profiles = [
      {
        userName: 'Original User',
        ystId: 'OS-OLD',
        zuName: 'Old Group',
        shiName: 'Old Department',
      },
      {
        userName: 'Current User',
        ystId: 'OS-NEW',
        zuName: 'New Group',
        shiName: 'New Department',
      },
    ]
    let chatMessage = ''
    const provider: UserProfileProvider = {
      fetchUserProfile: async () => profiles.shift() ?? null,
    }

    const sm = new SessionManager({
      userProfileProvider: provider,
      userProfileCachePath: join(tmpRoot, 'profile-cache.json'),
    })
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }

    const managed = createManagedSession(
      { id: 'branch-session', name: 'branch context' },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.messages = [{
      id: 'historical-user',
      role: 'user',
      content: 'historical question',
      timestamp: 1,
      dynamicContextRef: {
        type: 'user_profile',
        status: 'fresh',
        fetchedAt: 1,
        summary: 'User profile context available',
      },
    }]
    managed.agent = {
      chat: async function* (message: string): AsyncGenerator<AgentEvent> {
        chatMessage = message
        yield { type: 'complete' } as AgentEvent
      },
      setAllSources: () => {},
      setSourceServers: () => {},
      getModel: () => 'test-model',
      getSessionId: () => null,
      getActiveSourceSlugs: () => [],
      getAllSources: () => [],
      getSummarizeCallback: () => async () => null,
      isProcessing: () => false,
    } as never
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)

    await sm.sendMessage(managed.id, 'branch follow-up')

    expect(chatMessage).toContain('branch follow-up')
    expect(chatMessage).toContain('YST ID: OS-OLD')
    expect(chatMessage).not.toContain('OS-NEW')

    await sm.sendMessage(managed.id, 'second branch follow-up')
    expect(chatMessage).toContain('YST ID: OS-NEW')

    const lines = readFileSync(getSessionFilePath(tmpRoot, managed.id), 'utf-8').trim().split('\n')
    const serialized = lines.slice(1).map(line => JSON.parse(line))
    expect(serialized[0].dynamicContextRef.summary).toBe('User profile context available')
    expect(JSON.stringify(serialized[0])).not.toContain('Original User')
    expect(JSON.stringify(serialized[0])).not.toContain('OS-OLD')
    expect(JSON.stringify(serialized)).not.toContain('<user_profile')
  })

  it('redacts dynamic context refs before uploading shared sessions', async () => {
    let uploadedBody = ''
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      uploadedBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ id: 'share-1', url: 'https://viewer.test/s/share-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    const sm = new SessionManager()
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id: 'share-session', name: 'share context' },
      workspace as never,
      { messagesLoaded: true },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(managed.id, managed)

    const sessionFile = getSessionFilePath(tmpRoot, managed.id)
    mkdirSync(join(tmpRoot, 'sessions', managed.id), { recursive: true })
    writeSessionJsonl(sessionFile, {
      id: managed.id,
      workspaceRootPath: tmpRoot,
      createdAt: 1,
      lastUsedAt: 2,
      name: 'share context',
      messages: [{
        id: 'msg-profile',
        type: 'user',
        content: 'hello',
        timestamp: 3,
        dynamicContextRef: {
          type: 'user_profile',
          status: 'fresh',
          fetchedAt: 3,
          summary: 'Ada Lovelace, AI Platform, Engineering',
          dynamicContext: '<user_profile>YST ID: OS-12345</user_profile>',
        } as never,
      }],
    } as never)

    const result = await sm.shareToViewer(managed.id)

    expect(result.success).toBe(true)
    expect(uploadedBody).toContain('User profile context redacted for export')
    expect(uploadedBody).not.toContain('Ada Lovelace')
    expect(uploadedBody).not.toContain('OS-12345')
    expect(uploadedBody).not.toContain('<user_profile')
  })
})
