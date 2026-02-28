import { describe, expect, it } from 'bun:test'

type StoredMessage = { id: string }
type StoredSession = {
  sdkSessionId?: string
  messages: StoredMessage[]
}

type BranchRequest = {
  branchFromSessionId?: string
  branchFromMessageId?: string
}

function validateBranchLikeSessionManager(args: {
  request: BranchRequest
  targetWorkspaceRootPath: string
  targetProvider?: 'anthropic' | 'pi'
  targetProviderType?: string
  targetPiAuthProvider?: string
  sourceManagedWorkspaceRootPath?: string
  sourceManagedSdkSessionId?: string
  sourceProvider?: 'anthropic' | 'pi'
  sourceProviderType?: string
  sourcePiAuthProvider?: string
  sourceSession?: StoredSession
}) {
  const {
    request,
    targetWorkspaceRootPath,
    targetProvider = 'anthropic',
    targetProviderType,
    targetPiAuthProvider,
    sourceManagedWorkspaceRootPath,
    sourceManagedSdkSessionId,
    sourceProvider = 'anthropic',
    sourceProviderType,
    sourcePiAuthProvider,
    sourceSession,
  } = args

  if (request.branchFromSessionId || request.branchFromMessageId) {
    if (!request.branchFromSessionId || !request.branchFromMessageId) {
      throw new Error('Invalid branch request: both branchFromSessionId and branchFromMessageId are required')
    }

    if (sourceManagedWorkspaceRootPath && sourceManagedWorkspaceRootPath !== targetWorkspaceRootPath) {
      throw new Error('Invalid branch request: source session belongs to a different workspace')
    }

    const resolvedTargetProviderType = targetProviderType ?? (targetProvider === 'pi' ? 'pi' : 'anthropic')
    const resolvedSourceProviderType = sourceProviderType ?? (sourceProvider === 'pi' ? 'pi' : 'anthropic')
    const providerMismatch = sourceProvider !== targetProvider
    const providerTypeMismatch = resolvedSourceProviderType !== resolvedTargetProviderType
    const piAuthProviderMismatch = sourceProvider === 'pi' && sourcePiAuthProvider !== targetPiAuthProvider

    if (providerMismatch || providerTypeMismatch || piAuthProviderMismatch) {
      throw new Error('Branching is only supported within the same provider/backend. Switch this panel connection and try again.')
    }

    if (!sourceSession) {
      throw new Error(`Invalid branch request: source session ${request.branchFromSessionId} not found`)
    }

    const branchIdx = sourceSession.messages.findIndex(m => m.id === request.branchFromMessageId)
    if (branchIdx === -1) {
      throw new Error(`Invalid branch request: message ${request.branchFromMessageId} not found in source session`)
    }

    return {
      sourceSessionId: request.branchFromSessionId,
      sourceMessageId: request.branchFromMessageId,
      copiedMessages: sourceSession.messages.slice(0, branchIdx + 1),
      branchFromSdkSessionId: sourceManagedSdkSessionId || sourceSession.sdkSessionId,
    }
  }

  return undefined
}

describe('session branching validation semantics', () => {
  it('creates validated branch payload only for valid source/message', () => {
    const sourceSession: StoredSession = {
      sdkSessionId: 'sdk-parent',
      messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    }

    const result = validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'm2' },
      targetWorkspaceRootPath: '/ws-a',
      sourceManagedWorkspaceRootPath: '/ws-a',
      sourceSession,
    })

    expect(result).toBeDefined()
    expect(result?.copiedMessages.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(result?.branchFromSdkSessionId).toBe('sdk-parent')
  })

  it('rejects cross-workspace branch request', () => {
    expect(() => validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'm1' },
      targetWorkspaceRootPath: '/ws-a',
      sourceManagedWorkspaceRootPath: '/ws-b',
      sourceSession: { messages: [{ id: 'm1' }] },
    })).toThrow('source session belongs to a different workspace')
  })

  it('rejects missing branch message id in source session', () => {
    expect(() => validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'missing' },
      targetWorkspaceRootPath: '/ws-a',
      sourceManagedWorkspaceRootPath: '/ws-a',
      sourceSession: { messages: [{ id: 'm1' }] },
    })).toThrow('not found in source session')
  })

  it('allows branching for pi provider', () => {
    const sourceSession: StoredSession = {
      sdkSessionId: 'pi-parent',
      messages: [{ id: 'm1' }],
    }

    const result = validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'm1' },
      targetWorkspaceRootPath: '/ws-a',
      targetProvider: 'pi',
      sourceProvider: 'pi',
      sourceManagedWorkspaceRootPath: '/ws-a',
      sourceSession,
    })

    expect(result).toBeDefined()
    expect(result?.branchFromSdkSessionId).toBe('pi-parent')
  })

  it('rejects cross-provider branch requests', () => {
    expect(() => validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'm1' },
      targetWorkspaceRootPath: '/ws-a',
      targetProvider: 'anthropic',
      sourceProvider: 'pi',
      sourceManagedWorkspaceRootPath: '/ws-a',
      sourceSession: { messages: [{ id: 'm1' }] },
    })).toThrow('Branching is only supported within the same provider/backend')
  })

  it('rejects pi branches when auth providers differ', () => {
    expect(() => validateBranchLikeSessionManager({
      request: { branchFromSessionId: 'source-1', branchFromMessageId: 'm1' },
      targetWorkspaceRootPath: '/ws-a',
      targetProvider: 'pi',
      targetPiAuthProvider: 'openai-codex',
      sourceProvider: 'pi',
      sourcePiAuthProvider: 'github-copilot',
      sourceManagedWorkspaceRootPath: '/ws-a',
      sourceSession: { messages: [{ id: 'm1' }] },
    })).toThrow('Branching is only supported within the same provider/backend')
  })
})
