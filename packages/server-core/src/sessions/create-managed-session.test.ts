import { describe, expect, it } from 'bun:test'
import {
  clearExternalPluginBackendsForTests,
  registerExternalPluginBackend,
} from '@craft-agent/shared/agent/backend'
import {
  createManagedSession,
  resolveSessionBackendTarget,
  syncBackendIdFromConnection,
} from './SessionManager.ts'

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

describe('resolveSessionBackendTarget', () => {
  it('resolves registered external plugin backends without a connection', () => {
    clearExternalPluginBackendsForTests()
    registerExternalPluginBackend({
      backendId: 'codex-cli',
      pluginId: 'external.codex-cli',
      helperPath: '/tmp/codex-helper.mjs',
      defaultModel: 'gpt-5.4',
      needsHttpPoolServer: true,
      supportsBranching: false,
    })

    const target = resolveSessionBackendTarget({
      backendId: 'codex-cli',
      model: 'gpt-5.4-mini',
    })

    expect(target.kind).toBe('external')
    expect(target.backendId).toBe('codex-cli')
    expect(target.capabilities.needsHttpPoolServer).toBe(true)
  })

  it('rejects mixing external plugin backends with llm connections', () => {
    clearExternalPluginBackendsForTests()
    registerExternalPluginBackend({
      backendId: 'codex-cli',
      pluginId: 'external.codex-cli',
      helperPath: '/tmp/codex-helper.mjs',
    })

    expect(() => resolveSessionBackendTarget({
      backendId: 'codex-cli',
      llmConnection: 'anthropic-default',
    })).toThrow('External plugin backends do not support llmConnection selection')
  })

  it('rejects mismatched built-in backend requests', () => {
    clearExternalPluginBackendsForTests()

    expect(() => resolveSessionBackendTarget({
      backendId: 'pi',
    })).toThrow('Requested backend "pi" does not match the resolved connection backend "anthropic"')
  })
})
