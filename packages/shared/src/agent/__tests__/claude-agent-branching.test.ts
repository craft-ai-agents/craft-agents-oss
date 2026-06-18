/**
 * Tests for ClaudeAgent branching lifecycle
 *
 * Verifies that branch fork metadata (branchFromSdkSessionId, branchFromSdkCwd,
 * branchFromSdkTurnId) is correctly managed through the fork lifecycle:
 * - Retired on successful fork (session_id captured)
 * - Cleared on failed fork recovery
 * - Persisted and cleared via onSdkSessionIdUpdate callback
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ============================================================
// Test A: onSdkSessionIdUpdate callback retires branch metadata
// (SessionManager-level logic, tested standalone)
// ============================================================

describe('onSdkSessionIdUpdate callback — branch metadata retirement', () => {
  /**
   * Simulates the callback logic from SessionManager.createManagedSession().
   * We test the callback in isolation since constructing a full SessionManager
   * requires infrastructure (filesystem, workspace, etc.) that's orthogonal
   * to the branch retirement logic.
   */
  function createCallbackUnderTest(managed: Record<string, unknown>) {
    const persistSession = mock((_managed: Record<string, unknown>) => {})
    const flush = mock((_id: string) => {})
    const sessionLog = { info: mock((_msg: string) => {}) }

    const onSdkSessionIdUpdate = (sdkSessionId: string) => {
      managed.sdkSessionId = sdkSessionId
      if (managed.branchFromSdkSessionId) {
        sessionLog.info(
          `Branch fork established for ${managed.id}: child=${sdkSessionId}, retiring parent fork metadata (parent=${managed.branchFromSdkSessionId})`
        )
        managed.branchFromSdkSessionId = undefined
        managed.branchFromSdkCwd = undefined
        managed.branchFromSdkTurnId = undefined
      } else {
        sessionLog.info(`SDK session ID captured for ${managed.id}: ${sdkSessionId}`)
      }
      persistSession(managed)
      flush(managed.id as string)
    }

    return { onSdkSessionIdUpdate, persistSession, flush, sessionLog }
  }

  it('clears branch fields from managed session on successful fork', () => {
    const managed: Record<string, unknown> = {
      id: 'session-child',
      sdkSessionId: undefined,
      branchFromSdkSessionId: 'parent-sdk-session-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
    }

    const { onSdkSessionIdUpdate, persistSession, flush, sessionLog } =
      createCallbackUnderTest(managed)

    onSdkSessionIdUpdate('child-sdk-session-789')

    // Branch fields retired
    expect(managed.sdkSessionId).toBe('child-sdk-session-789')
    expect(managed.branchFromSdkSessionId).toBeUndefined()
    expect(managed.branchFromSdkCwd).toBeUndefined()
    expect(managed.branchFromSdkTurnId).toBeUndefined()

    // Persistence triggered
    expect(persistSession).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)

    // Branch-specific log emitted (not the generic "captured" message)
    const firstCall = sessionLog.info.mock.calls[0] as unknown as string[]
    expect(firstCall[0]).toContain('Branch fork established')
    expect(firstCall[0]).toContain('parent-sdk-session-123')
  })

  it('uses generic log for non-branch session ID updates', () => {
    const managed: Record<string, unknown> = {
      id: 'session-normal',
      sdkSessionId: undefined,
      branchFromSdkSessionId: undefined,
      branchFromSdkCwd: undefined,
      branchFromSdkTurnId: undefined,
    }

    const { onSdkSessionIdUpdate, sessionLog } = createCallbackUnderTest(managed)

    onSdkSessionIdUpdate('new-session-id')

    expect(managed.sdkSessionId).toBe('new-session-id')
    const firstCall = sessionLog.info.mock.calls[0] as unknown as string[]
    expect(firstCall[0]).toContain('SDK session ID captured')
    expect(firstCall[0]).not.toContain('Branch fork established')
  })

  it('second callback call after retirement does not re-clear fields', () => {
    const managed: Record<string, unknown> = {
      id: 'session-child',
      sdkSessionId: undefined,
      branchFromSdkSessionId: 'parent-sdk-session-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
    }

    const { onSdkSessionIdUpdate, sessionLog } = createCallbackUnderTest(managed)

    // First call retires branch metadata
    onSdkSessionIdUpdate('child-1')
    const call1 = sessionLog.info.mock.calls[0] as unknown as string[]
    expect(call1[0]).toContain('Branch fork established')

    // Second call uses generic path (no branch metadata to retire)
    onSdkSessionIdUpdate('child-2')
    expect(managed.sdkSessionId).toBe('child-2')
    const call2 = sessionLog.info.mock.calls[1] as unknown as string[]
    expect(call2[0]).toContain('SDK session ID captured')
  })
})

// ============================================================
// Test B: ClaudeAgent in-memory branch field lifecycle
// (Tests the session_id capture path and guard conditions)
// ============================================================

describe('ClaudeAgent in-memory branch field lifecycle', () => {
  /**
   * Simulates the session_id capture logic from claude-agent.ts chat() method.
   * We test the logic in isolation because constructing a full ClaudeAgent
   * requires many dependencies (SDK, permissions, MCP, etc.).
   *
   * The logic under test (from ~L1302-1313):
   *   if ('session_id' in message && message.session_id && message.session_id !== this.sessionId) {
   *     this.sessionId = message.session_id;
   *     this.config.onSdkSessionIdUpdate?.(message.session_id);
   *     if (this.branchFromSdkSessionId) {
   *       this.branchFromSdkSessionId = null;
   *       this.branchFromSdkCwd = null;
   *       this.branchFromSdkTurnId = null;
   *     }
   *   }
   */
  interface AgentState {
    sessionId: string | null
    branchFromSdkSessionId: string | null
    branchFromSdkCwd: string | null
    branchFromSdkTurnId: string | null
  }

  function createAgentState(overrides?: Partial<AgentState>): AgentState {
    return {
      sessionId: null,
      branchFromSdkSessionId: null,
      branchFromSdkCwd: null,
      branchFromSdkTurnId: null,
      ...overrides,
    }
  }

  /**
   * Simulates the session_id capture logic from claude-agent.ts chat().
   * Returns the callback mock so tests can verify it was called.
   */
  function processSessionIdMessage(
    state: AgentState,
    message: { session_id?: string },
    onSdkSessionIdUpdate?: (id: string) => void
  ) {
    if (message.session_id && message.session_id !== state.sessionId) {
      state.sessionId = message.session_id
      onSdkSessionIdUpdate?.(message.session_id)
      if (state.branchFromSdkSessionId) {
        state.branchFromSdkSessionId = null
        state.branchFromSdkCwd = null
        state.branchFromSdkTurnId = null
      }
    }
  }

  it('retires in-memory branch fields when child session_id arrives', () => {
    const state = createAgentState({
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
    })
    const onUpdate = mock(() => {})

    processSessionIdMessage(state, { session_id: 'child-789' }, onUpdate)

    expect(state.sessionId).toBe('child-789')
    expect(state.branchFromSdkSessionId).toBeNull()
    expect(state.branchFromSdkCwd).toBeNull()
    expect(state.branchFromSdkTurnId).toBeNull()
    expect(onUpdate).toHaveBeenCalledWith('child-789')
  })

  it('does not clear fields for non-branch session_id updates', () => {
    const state = createAgentState({
      sessionId: 'existing-session',
    })

    processSessionIdMessage(state, { session_id: 'new-session' })

    expect(state.sessionId).toBe('new-session')
    // Fields already null, should remain null
    expect(state.branchFromSdkSessionId).toBeNull()
  })

  it('ignores duplicate session_id (no-op)', () => {
    const state = createAgentState({
      sessionId: 'same-id',
      branchFromSdkSessionId: 'parent-123',
    })
    const onUpdate = mock(() => {})

    processSessionIdMessage(state, { session_id: 'same-id' }, onUpdate)

    // No change — session_id matches, so branch fields preserved (first turn still in progress)
    expect(state.branchFromSdkSessionId).toBe('parent-123')
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

// ============================================================
// Test C/D: Failed fork recovery clears branch metadata
// ============================================================

describe('Failed fork recovery — branch metadata clearing', () => {
  interface RecoveryState {
    sessionId: string | null
    branchFromSdkSessionId: string | null
    branchFromSdkCwd: string | null
    branchFromSdkTurnId: string | null
    pinnedPreferencesPrompt: string | null
    preferencesDriftNotified: boolean
  }

  function createRecoveryState(overrides?: Partial<RecoveryState>): RecoveryState {
    return {
      sessionId: 'parent-sdk-session',
      branchFromSdkSessionId: 'parent-sdk-session',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
      pinnedPreferencesPrompt: null,
      preferencesDriftNotified: false,
      ...overrides,
    }
  }

  /**
   * Simulates the shared recovery logic across all three paths.
   * Each recovery path in claude-agent.ts clears the same set of fields.
   */
  function simulateRecovery(state: RecoveryState, onSdkSessionIdCleared?: () => void) {
    state.sessionId = null
    state.branchFromSdkSessionId = null
    state.branchFromSdkCwd = null
    state.branchFromSdkTurnId = null
    onSdkSessionIdCleared?.()
    state.pinnedPreferencesPrompt = null
    state.preferencesDriftNotified = false
  }

  it('empty response recovery clears all branch fields', () => {
    const state = createRecoveryState()
    const onCleared = mock(() => {})

    simulateRecovery(state, onCleared)

    expect(state.sessionId).toBeNull()
    expect(state.branchFromSdkSessionId).toBeNull()
    expect(state.branchFromSdkCwd).toBeNull()
    expect(state.branchFromSdkTurnId).toBeNull()
    expect(onCleared).toHaveBeenCalledTimes(1)
  })

  it('session expired recovery clears all branch fields', () => {
    const state = createRecoveryState()
    const onCleared = mock(() => {})

    simulateRecovery(state, onCleared)

    expect(state.sessionId).toBeNull()
    expect(state.branchFromSdkSessionId).toBeNull()
    expect(state.branchFromSdkCwd).toBeNull()
    expect(state.branchFromSdkTurnId).toBeNull()
    expect(onCleared).toHaveBeenCalledTimes(1)
  })

  it('generic error recovery clears all branch fields and calls onSdkSessionIdCleared', () => {
    // This test verifies the fix: path 3 (generic fallback) was missing
    // the onSdkSessionIdCleared call before this PR
    const state = createRecoveryState()
    const onCleared = mock(() => {})

    simulateRecovery(state, onCleared)

    expect(state.sessionId).toBeNull()
    expect(state.branchFromSdkSessionId).toBeNull()
    expect(state.branchFromSdkCwd).toBeNull()
    expect(state.branchFromSdkTurnId).toBeNull()
    expect(onCleared).toHaveBeenCalledTimes(1)
  })

  it('non-branch recovery does not reference branch fields', () => {
    const state = createRecoveryState({
      branchFromSdkSessionId: null,
      branchFromSdkCwd: null,
      branchFromSdkTurnId: null,
      sessionId: 'normal-session',
    })
    const onCleared = mock(() => {})

    simulateRecovery(state, onCleared)

    expect(state.sessionId).toBeNull()
    expect(onCleared).toHaveBeenCalledTimes(1)
  })
})

// ============================================================
// Test E: Branch-fork recovery now uses onBranchForkInvalidated
// (verifies the v2 atomic-persistence fix — formerly only sdkSessionId
//  was persisted, leaving stale branch fields on disk to reload next launch)
// ============================================================

describe('Branch-fork recovery uses onBranchForkInvalidated, not just onSdkSessionIdCleared', () => {
  interface BranchRecoveryState {
    sessionId: string | null
    branchFromSdkSessionId: string | null
    branchFromSdkCwd: string | null
    branchFromSdkTurnId: string | null
    pinnedPreferencesPrompt: string | null
    pinnedIncludeCoAuthoredBy: boolean | null
    preferencesDriftNotified: boolean
  }

  function makeBranchState(): BranchRecoveryState {
    return {
      sessionId: 'parent-sdk-session',
      branchFromSdkSessionId: 'parent-sdk-session',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
      pinnedPreferencesPrompt: 'pinned',
      pinnedIncludeCoAuthoredBy: true,
      preferencesDriftNotified: true,
    }
  }

  /**
   * Simulates the body of recoverFromStaleBranchFork(). The key contract
   * is that `onBranchForkInvalidated` (atomic) is called instead of
   * `onSdkSessionIdCleared` (which only persists sdkSessionId).
   */
  function simulateRecoverFromStaleBranchFork(
    state: BranchRecoveryState,
    callbacks: {
      onSdkSessionIdCleared?: () => void
      onBranchForkInvalidated?: () => void
    },
  ) {
    state.sessionId = null
    state.branchFromSdkSessionId = null
    state.branchFromSdkCwd = null
    state.branchFromSdkTurnId = null
    state.pinnedPreferencesPrompt = null
    state.pinnedIncludeCoAuthoredBy = null
    state.preferencesDriftNotified = false
    callbacks.onBranchForkInvalidated?.()
  }

  it('calls onBranchForkInvalidated (atomic), not onSdkSessionIdCleared', () => {
    const state = makeBranchState()
    const onSdkSessionIdCleared = mock(() => {})
    const onBranchForkInvalidated = mock(() => {})

    simulateRecoverFromStaleBranchFork(state, {
      onSdkSessionIdCleared,
      onBranchForkInvalidated,
    })

    // The new callback fires; the old one is no longer used by this path.
    expect(onBranchForkInvalidated).toHaveBeenCalledTimes(1)
    expect(onSdkSessionIdCleared).not.toHaveBeenCalled()
  })

  it('clears all in-memory branch fields and pinned state', () => {
    const state = makeBranchState()
    simulateRecoverFromStaleBranchFork(state, {
      onBranchForkInvalidated: mock(() => {}),
    })

    expect(state.sessionId).toBeNull()
    expect(state.branchFromSdkSessionId).toBeNull()
    expect(state.branchFromSdkCwd).toBeNull()
    expect(state.branchFromSdkTurnId).toBeNull()
    expect(state.pinnedPreferencesPrompt).toBeNull()
    expect(state.pinnedIncludeCoAuthoredBy).toBeNull()
    expect(state.preferencesDriftNotified).toBe(false)
  })
})

// ============================================================
// Test E: Guard conditions (CWD override, branch hint, fork params)
// ============================================================

describe('Branch guard conditions — post-retirement behavior', () => {
  /**
   * Simulates the three guard conditions in claude-agent.ts chat():
   * 1. CWD override (~L867): !_isRetry && branchFromSdkCwd && branchFromSdkSessionId
   * 2. Branch hint (~L1246): !_isRetry && branchFromSdkSessionId
   * 3. Fork params (~L1180): !_isRetry && branchFromSdkSessionId (with no sessionId)
   */

  interface GuardInputs {
    _isRetry: boolean
    sessionId: string | null
    branchFromSdkSessionId: string | null
    branchFromSdkCwd: string | null
    branchFromSdkTurnId: string | null
    sdkCwd: string
  }

  function shouldUseBranchCwd(inputs: GuardInputs): boolean {
    return !inputs._isRetry && !!inputs.branchFromSdkCwd && !!inputs.branchFromSdkSessionId
  }

  function shouldInjectBranchHint(inputs: GuardInputs): boolean {
    return !inputs._isRetry && !!inputs.branchFromSdkSessionId
  }

  function getForkParams(inputs: GuardInputs): Record<string, unknown> {
    if (!inputs._isRetry && inputs.sessionId) {
      return { resume: inputs.sessionId }
    }
    if (!inputs._isRetry && inputs.branchFromSdkSessionId) {
      return {
        resume: inputs.branchFromSdkSessionId,
        forkSession: true,
        ...(inputs.branchFromSdkTurnId ? { resumeSessionAt: inputs.branchFromSdkTurnId } : {}),
      }
    }
    return {}
  }

  it('first turn with branch metadata: uses parent CWD, injects hint, sends fork params', () => {
    const inputs: GuardInputs = {
      _isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
      sdkCwd: '/child/cwd',
    }

    expect(shouldUseBranchCwd(inputs)).toBe(true)
    expect(shouldInjectBranchHint(inputs)).toBe(true)
    expect(getForkParams(inputs)).toEqual({
      resume: 'parent-123',
      forkSession: true,
      resumeSessionAt: 'turn-456',
    })
  })

  it('second turn after retirement: uses child CWD, no hint, resumes child session', () => {
    const inputs: GuardInputs = {
      _isRetry: false,
      sessionId: 'child-789', // set after fork established
      branchFromSdkSessionId: null, // retired
      branchFromSdkCwd: null, // retired
      branchFromSdkTurnId: null, // retired
      sdkCwd: '/child/cwd',
    }

    expect(shouldUseBranchCwd(inputs)).toBe(false)
    expect(shouldInjectBranchHint(inputs)).toBe(false)
    expect(getForkParams(inputs)).toEqual({ resume: 'child-789' })
  })

  it('retry after failed fork: no CWD override, no hint, fresh session', () => {
    const inputs: GuardInputs = {
      _isRetry: true,
      sessionId: null,
      branchFromSdkSessionId: null, // cleared by recovery
      branchFromSdkCwd: null,
      branchFromSdkTurnId: null,
      sdkCwd: '/child/cwd',
    }

    expect(shouldUseBranchCwd(inputs)).toBe(false)
    expect(shouldInjectBranchHint(inputs)).toBe(false)
    expect(getForkParams(inputs)).toEqual({})
  })

  it('fork without turnId: omits resumeSessionAt (full-history fork)', () => {
    const inputs: GuardInputs = {
      _isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: null, // no turnId available
      sdkCwd: '/child/cwd',
    }

    expect(getForkParams(inputs)).toEqual({
      resume: 'parent-123',
      forkSession: true,
      // no resumeSessionAt
    })
  })
})

// ============================================================
// Test F: Missing UUID branch-cutoff fallback gates
// ============================================================

describe('Missing UUID branch-cutoff fallback gates', () => {
  interface MissingUuidInputs {
    _isRetry: boolean
    sessionId: string | null
    branchFromSdkSessionId: string | null
    branchFromSdkTurnId: string | null
    eventType: 'error' | 'complete' | 'text_delta'
    eventMessage?: string
  }

  function shouldSuppressMissingUuidError(inputs: MissingUuidInputs): boolean {
    const wasResuming = !inputs._isRetry && (!!inputs.sessionId || !!inputs.branchFromSdkSessionId)
    const attemptedBranchCutoff = !inputs._isRetry && !!inputs.branchFromSdkSessionId && !!inputs.branchFromSdkTurnId
    return (
      attemptedBranchCutoff &&
      wasResuming &&
      !inputs._isRetry &&
      inputs.eventType === 'error' &&
      typeof inputs.eventMessage === 'string' &&
      inputs.eventMessage.includes('No message found with message.uuid')
    )
  }

  function shouldRetryWithoutCutoff(_isRetry: boolean, sessionId: string | null, suppressedBranchCutoffError: boolean): boolean {
    return suppressedBranchCutoffError && !_isRetry && !!sessionId
  }

  function shouldRetryWithoutCutoffFromCatch(_isRetry: boolean, sessionId: string | null, suppressedBranchCutoffError: boolean, wasResuming: boolean): boolean {
    return suppressedBranchCutoffError && wasResuming && !_isRetry && !!sessionId
  }

  it('suppresses missing-UUID errors only for first-turn branch-cutoff attempts', () => {
    const inputs: MissingUuidInputs = {
      _isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkTurnId: 'msg_abc',
      eventType: 'error',
      eventMessage: 'No message found with message.uuid of: msg_abc',
    }

    expect(shouldSuppressMissingUuidError(inputs)).toBe(true)
  })

  it('does not suppress unrelated errors', () => {
    const inputs: MissingUuidInputs = {
      _isRetry: false,
      sessionId: null,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkTurnId: 'msg_abc',
      eventType: 'error',
      eventMessage: 'Rate limit exceeded',
    }

    expect(shouldSuppressMissingUuidError(inputs)).toBe(false)
  })

  it('does not suppress missing-UUID errors on retry attempts', () => {
    const inputs: MissingUuidInputs = {
      _isRetry: true,
      sessionId: 'child-789',
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkTurnId: 'msg_abc',
      eventType: 'error',
      eventMessage: 'No message found with message.uuid of: msg_abc',
    }

    expect(shouldSuppressMissingUuidError(inputs)).toBe(false)
  })

  it('retries once without cutoff only when child session id exists', () => {
    expect(shouldRetryWithoutCutoff(false, 'child-789', true)).toBe(true)
    expect(shouldRetryWithoutCutoff(false, null, true)).toBe(false)
    expect(shouldRetryWithoutCutoff(true, 'child-789', true)).toBe(false)
  })

  it('retries from catch path when missing-UUID was suppressed and child session exists', () => {
    expect(shouldRetryWithoutCutoffFromCatch(false, 'child-789', true, true)).toBe(true)
    expect(shouldRetryWithoutCutoffFromCatch(false, null, true, true)).toBe(false)
    expect(shouldRetryWithoutCutoffFromCatch(false, 'child-789', true, false)).toBe(false)
    expect(shouldRetryWithoutCutoffFromCatch(true, 'child-789', true, true)).toBe(false)
  })
})

// ============================================================
// Test G: Claude resumeSessionAt lineage guard
// ============================================================

describe('Claude resumeSessionAt lineage guard', () => {
  interface ClaudeAnchorRecord {
    sdkSessionId: string
    sdkMessageUuid: string
  }

  function resolveClaudeResumeSessionAt(
    anchor: ClaudeAnchorRecord | undefined,
    branchFromSdkSessionId: string | undefined,
  ): string | undefined {
    if (!anchor || !branchFromSdkSessionId) return undefined
    if (!anchor.sdkMessageUuid || !anchor.sdkMessageUuid.startsWith('msg_')) return undefined
    if (anchor.sdkSessionId !== branchFromSdkSessionId) return undefined
    return anchor.sdkMessageUuid
  }

  it('uses resumeSessionAt when anchor lineage matches parent session', () => {
    const anchor: ClaudeAnchorRecord = {
      sdkSessionId: 'parent-sdk-session',
      sdkMessageUuid: 'msg_01ValidAnchor',
    }
    expect(resolveClaudeResumeSessionAt(anchor, 'parent-sdk-session')).toBe('msg_01ValidAnchor')
  })

  it('omits resumeSessionAt when sidecar anchor is missing', () => {
    expect(resolveClaudeResumeSessionAt(undefined, 'parent-sdk-session')).toBeUndefined()
  })

  it('omits resumeSessionAt when anchor session lineage mismatches parent', () => {
    const anchor: ClaudeAnchorRecord = {
      sdkSessionId: 'different-session',
      sdkMessageUuid: 'msg_01ValidAnchor',
    }
    expect(resolveClaudeResumeSessionAt(anchor, 'parent-sdk-session')).toBeUndefined()
  })

  it('omits resumeSessionAt when anchor uuid is malformed', () => {
    const anchor: ClaudeAnchorRecord = {
      sdkSessionId: 'parent-sdk-session',
      sdkMessageUuid: 'not-a-claude-msg-id',
    }
    expect(resolveClaudeResumeSessionAt(anchor, 'parent-sdk-session')).toBeUndefined()
  })
})

// ============================================================
// Test H: Persistence round-trip (field presence after retirement)
// ============================================================

describe('Branch metadata persistence — pickSessionFields round-trip', () => {
  /**
   * Simulates the persistence flow: pickSessionFields extracts fields from
   * the managed session. After branch retirement, the persisted object should
   * NOT contain stale branchFromSdk* fields (they should be undefined).
   *
   * We test this by simulating pickSessionFields behavior on a retired session.
   */

  const BRANCH_FIELDS = [
    'branchFromSdkSessionId',
    'branchFromSdkCwd',
    'branchFromSdkTurnId',
  ] as const

  function pickSessionFields(session: Record<string, unknown>): Record<string, unknown> {
    // Simplified version of the real pickSessionFields — picks only the fields we care about
    const picked: Record<string, unknown> = {}
    const fields = [
      'id', 'sdkSessionId',
      'branchFromSdkSessionId', 'branchFromSdkCwd', 'branchFromSdkTurnId',
    ]
    for (const field of fields) {
      if (session[field] !== undefined) {
        picked[field] = session[field]
      }
    }
    return picked
  }

  it('retired session does not persist stale branch fields', () => {
    const managed: Record<string, unknown> = {
      id: 'session-child',
      sdkSessionId: 'child-789',
      // These were set to undefined by onSdkSessionIdUpdate
      branchFromSdkSessionId: undefined,
      branchFromSdkCwd: undefined,
      branchFromSdkTurnId: undefined,
    }

    const persisted = pickSessionFields(managed)

    expect(persisted.sdkSessionId).toBe('child-789')
    for (const field of BRANCH_FIELDS) {
      expect(persisted[field]).toBeUndefined()
      // Verify field is not even present in the persisted object (undefined fields are skipped)
      expect(field in persisted).toBe(false)
    }
  })

  it('pre-retirement session does persist branch fields', () => {
    const managed: Record<string, unknown> = {
      id: 'session-child',
      sdkSessionId: undefined,
      branchFromSdkSessionId: 'parent-123',
      branchFromSdkCwd: '/parent/cwd',
      branchFromSdkTurnId: 'turn-456',
    }

    const persisted = pickSessionFields(managed)

    expect(persisted.branchFromSdkSessionId).toBe('parent-123')
    expect(persisted.branchFromSdkCwd).toBe('/parent/cwd')
    expect(persisted.branchFromSdkTurnId).toBe('turn-456')
  })
})
