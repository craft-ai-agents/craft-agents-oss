import { describe, expect, it } from 'bun:test'
import { createManagedSession, syncBackendIdFromConnection } from './SessionManager.ts'

describe('createManagedSession', () => {
  const workspace = {
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: '/tmp/test-workspace',
    createdAt: Date.now(),
  }

  it('normalizes legacy thinkingLevel=think on restore', () => {
    const managed = createManagedSession({
      id: 'session_legacy',
      thinkingLevel: 'think' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBe('medium')
  })

  it('drops invalid thinking levels instead of leaking them into runtime state', () => {
    const managed = createManagedSession({
      id: 'session_invalid',
      thinkingLevel: 'ultra' as any,
    }, workspace as any)

    expect(managed.thinkingLevel).toBeUndefined()
  })

  it('preserves persisted backend ids across restore', () => {
    const managed = createManagedSession({
      id: 'session_backend',
      backendId: 'pi',
    } as any, workspace as any)

    expect(managed.backendId).toBe('pi')
  })

  it('clears stale backend ids when a connection is cleared or unknown', () => {
    const managed = {
      llmConnection: 'missing-connection',
      backendId: 'anthropic',
    } as { llmConnection?: string; backendId?: string }

    syncBackendIdFromConnection(managed)
    expect(managed.backendId).toBeUndefined()

    managed.llmConnection = undefined
    syncBackendIdFromConnection(managed)
    expect(managed.backendId).toBeUndefined()
  })
})
