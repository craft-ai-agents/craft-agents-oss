import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentEvent } from '@craft-agent/shared/agent'
import { getSessionFilePath } from '@craft-agent/shared/sessions/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'
import type { UserProfileProvider } from './user-profile-context.ts'

describe('sendMessage user profile context', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-profile-context-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('passes expanded profile context to the backend while persisting only a redacted reference', async () => {
    let chatMessage = ''
    const provider: UserProfileProvider = {
      fetchUserProfile: async () => ({
        name: 'Ada Lovelace',
        oneStopId: 'OS-12345',
        group: 'AI Platform',
        department: 'Engineering',
        ownedModules: ['sessions'],
        ownedTopics: ['identity'],
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
    expect(chatMessage).toContain('One-stop ID: OS-12345')

    const lines = readFileSync(getSessionFilePath(tmpRoot, managed.id), 'utf-8').trim().split('\n')
    const storedUserMessage = JSON.parse(lines[1]!)
    expect(storedUserMessage.content).toBe('hello')
    expect(storedUserMessage.dynamicContextRef).toEqual({
      type: 'user_profile',
      status: 'fresh',
      fetchedAt: expect.any(Number),
      summary: 'Ada Lovelace, AI Platform, Engineering',
    })
    expect(JSON.stringify(storedUserMessage)).not.toContain('OS-12345')
    expect(JSON.stringify(storedUserMessage)).not.toContain('<user_profile')
  })
})
