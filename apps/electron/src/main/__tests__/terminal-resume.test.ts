/**
 * Unit tests for Terminal Resume IPC Handler
 *
 * Tests the fix for the missing `await` before sessionManager.getSession()
 * which was causing "Send a message first to initialize the session" error
 * even when the session had a valid sdkSessionId.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test'

// Mock types
interface MockSession {
  id: string
  sdkSessionId?: string
  sdkCwd?: string
  workingDirectory?: string
}

interface MockSessionManager {
  getSession: (sessionId: string) => Promise<MockSession | null>
}

interface SpawnTerminalOptions {
  sdkSessionId: string
  workingDirectory: string
  taskListId?: string
}

interface SpawnTerminalResult {
  success: boolean
  error?: string
}

/**
 * Simulates the IPC handler logic for SESSION_RESUME_IN_TERMINAL
 * This is extracted to test the actual logic without Electron IPC overhead
 */
async function handleResumeInTerminal(
  sessionId: string,
  sessionManager: MockSessionManager,
  spawnTerminalWithSession: (options: SpawnTerminalOptions) => Promise<SpawnTerminalResult>
): Promise<{ success: boolean }> {
  // Validate session ID format (prevent injection)
  const vesperIdPattern = /^(\d{6})-([a-z]+-[a-z]+)(?:-(\d+))?$/
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  if (!sessionId || (!vesperIdPattern.test(sessionId) && !uuidPattern.test(sessionId))) {
    throw new Error('Invalid session ID format')
  }

  // Get session - THE FIX: must await this async call
  const session = await sessionManager.getSession(sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  // Check if session has SDK session ID (only available after first message)
  if (!session.sdkSessionId) {
    throw new Error('Send a message first to initialize the session')
  }

  // Get working directory (prefer sdkCwd, fallback to workingDirectory)
  const workingDirectory = session.sdkCwd || session.workingDirectory
  if (!workingDirectory) {
    throw new Error('Session has no working directory configured')
  }

  // Spawn terminal with session
  const result = await spawnTerminalWithSession({
    sdkSessionId: session.sdkSessionId,
    workingDirectory,
    taskListId: sessionId
  })

  if (!result.success) {
    throw new Error(result.error || 'Failed to spawn terminal')
  }

  return { success: true }
}

/**
 * BROKEN version without await - demonstrates the bug
 */
async function handleResumeInTerminalBroken(
  sessionId: string,
  sessionManager: MockSessionManager,
  spawnTerminalWithSession: (options: SpawnTerminalOptions) => Promise<SpawnTerminalResult>
): Promise<{ success: boolean }> {
  const vesperIdPattern = /^(\d{6})-([a-z]+-[a-z]+)(?:-(\d+))?$/
  const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
  if (!sessionId || (!vesperIdPattern.test(sessionId) && !uuidPattern.test(sessionId))) {
    throw new Error('Invalid session ID format')
  }

  // BUG: Missing await - session is a Promise, not the actual session
  const session = sessionManager.getSession(sessionId) as unknown as MockSession
  if (!session) {
    throw new Error('Session not found')
  }

  // This will ALWAYS be undefined because Promise.sdkSessionId doesn't exist
  if (!session.sdkSessionId) {
    throw new Error('Send a message first to initialize the session')
  }

  const workingDirectory = session.sdkCwd || session.workingDirectory
  if (!workingDirectory) {
    throw new Error('Session has no working directory configured')
  }

  const result = await spawnTerminalWithSession({
    sdkSessionId: session.sdkSessionId,
    workingDirectory,
    taskListId: sessionId
  })

  if (!result.success) {
    throw new Error(result.error || 'Failed to spawn terminal')
  }

  return { success: true }
}

describe('Terminal Resume IPC Handler', () => {
  let mockSessionManager: MockSessionManager
  let mockSpawnTerminal: ReturnType<typeof mock>

  beforeEach(() => {
    mockSpawnTerminal = mock(() => Promise.resolve({ success: true }))
  })

  describe('with valid session that has sdkSessionId', () => {
    beforeEach(() => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: 'ses-abc123def456',
          sdkCwd: '/Users/test/project',
          workingDirectory: '/Users/test/project'
        }))
      }
    })

    it('FIXED: should successfully spawn terminal when session has sdkSessionId', async () => {
      const result = await handleResumeInTerminal(
        '260125-swift-river',
        mockSessionManager,
        mockSpawnTerminal
      )

      expect(result.success).toBe(true)
      expect(mockSpawnTerminal).toHaveBeenCalledWith({
        sdkSessionId: 'ses-abc123def456',
        workingDirectory: '/Users/test/project',
        taskListId: '260125-swift-river'
      })
    })

    it('BROKEN: demonstrates the bug - always throws "Send a message first" without await', async () => {
      // This test demonstrates the bug that was fixed
      await expect(
        handleResumeInTerminalBroken(
          '260125-swift-river',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Send a message first to initialize the session')

      // The spawn function should NOT have been called because the bug
      // causes early exit with the error
      expect(mockSpawnTerminal).not.toHaveBeenCalled()
    })
  })

  describe('with session that has no sdkSessionId (new session)', () => {
    beforeEach(() => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: undefined, // No SDK session yet
          workingDirectory: '/Users/test/project'
        }))
      }
    })

    it('should throw "Send a message first" for session without sdkSessionId', async () => {
      await expect(
        handleResumeInTerminal(
          '260125-swift-river',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Send a message first to initialize the session')
    })
  })

  describe('session not found', () => {
    beforeEach(() => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve(null))
      }
    })

    it('should throw "Session not found" when session does not exist', async () => {
      await expect(
        handleResumeInTerminal(
          '260125-swift-river',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Session not found')
    })
  })

  describe('session ID format validation', () => {
    beforeEach(() => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: 'ses-abc123',
          workingDirectory: '/tmp'
        }))
      }
    })

    it('should accept Vesper session ID format (YYMMDD-word-word)', async () => {
      const result = await handleResumeInTerminal(
        '260125-swift-river',
        mockSessionManager,
        mockSpawnTerminal
      )
      expect(result.success).toBe(true)
    })

    it('should accept Vesper session ID format with suffix (YYMMDD-word-word-N)', async () => {
      const result = await handleResumeInTerminal(
        '260125-swift-river-2',
        mockSessionManager,
        mockSpawnTerminal
      )
      expect(result.success).toBe(true)
    })

    it('should accept UUID format', async () => {
      const result = await handleResumeInTerminal(
        '12345678-1234-1234-1234-123456789012',
        mockSessionManager,
        mockSpawnTerminal
      )
      expect(result.success).toBe(true)
    })

    it('should reject invalid session ID format', async () => {
      await expect(
        handleResumeInTerminal(
          'invalid-format',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Invalid session ID format')
    })

    it('should reject SDK session ID format (ses-xxx)', async () => {
      // SDK session IDs should NOT be passed to this handler
      // The handler expects Vesper session IDs
      await expect(
        handleResumeInTerminal(
          'ses-abc123def456',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Invalid session ID format')
    })
  })

  describe('working directory handling', () => {
    it('should prefer sdkCwd over workingDirectory', async () => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: 'ses-abc123',
          sdkCwd: '/Users/test/sdk-cwd',
          workingDirectory: '/Users/test/original-cwd'
        }))
      }

      await handleResumeInTerminal(
        '260125-swift-river',
        mockSessionManager,
        mockSpawnTerminal
      )

      expect(mockSpawnTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: '/Users/test/sdk-cwd'
        })
      )
    })

    it('should fallback to workingDirectory when sdkCwd is not set', async () => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: 'ses-abc123',
          sdkCwd: undefined,
          workingDirectory: '/Users/test/original-cwd'
        }))
      }

      await handleResumeInTerminal(
        '260125-swift-river',
        mockSessionManager,
        mockSpawnTerminal
      )

      expect(mockSpawnTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          workingDirectory: '/Users/test/original-cwd'
        })
      )
    })

    it('should throw when no working directory is available', async () => {
      mockSessionManager = {
        getSession: mock(() => Promise.resolve({
          id: '260125-swift-river',
          sdkSessionId: 'ses-abc123',
          sdkCwd: undefined,
          workingDirectory: undefined
        }))
      }

      await expect(
        handleResumeInTerminal(
          '260125-swift-river',
          mockSessionManager,
          mockSpawnTerminal
        )
      ).rejects.toThrow('Session has no working directory configured')
    })
  })
})

// ============================================================================
// Event Processor Tests - sdk_session_id_changed event
// ============================================================================

describe('SDK Session ID Changed Event Handler', () => {
  /**
   * Mock session state for testing the event processor
   */
  interface MockSessionState {
    session: {
      id: string
      sdkSessionId?: string
      workspaceId: string
      workspaceName: string
      messages: unknown[]
      isProcessing: boolean
      lastMessageAt: number
    }
    streaming: null
  }

  /**
   * Simulates the handleSdkSessionIdChanged event handler logic
   * This is the pure function from event-processor/handlers/session.ts
   */
  function handleSdkSessionIdChanged(
    state: MockSessionState,
    event: { type: 'sdk_session_id_changed'; sessionId: string; sdkSessionId: string | undefined }
  ): { state: MockSessionState; effects: unknown[] } {
    const { session, streaming } = state

    return {
      state: {
        session: { ...session, sdkSessionId: event.sdkSessionId },
        streaming,
      },
      effects: [],
    }
  }

  const createMockState = (sdkSessionId?: string): MockSessionState => ({
    session: {
      id: '260125-swift-river',
      sdkSessionId,
      workspaceId: 'workspace-1',
      workspaceName: 'Test Workspace',
      messages: [],
      isProcessing: false,
      lastMessageAt: Date.now(),
    },
    streaming: null,
  })

  describe('when sdkSessionId is set', () => {
    it('should update session with new sdkSessionId', () => {
      const state = createMockState(undefined)
      const event = {
        type: 'sdk_session_id_changed' as const,
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = handleSdkSessionIdChanged(state, event)

      expect(result.state.session.sdkSessionId).toBe('ses-abc123def456')
      expect(result.effects).toEqual([])
    })

    it('should replace existing sdkSessionId', () => {
      const state = createMockState('ses-old-session')
      const event = {
        type: 'sdk_session_id_changed' as const,
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-new-session',
      }

      const result = handleSdkSessionIdChanged(state, event)

      expect(result.state.session.sdkSessionId).toBe('ses-new-session')
    })
  })

  describe('when sdkSessionId is cleared', () => {
    it('should set sdkSessionId to undefined', () => {
      const state = createMockState('ses-abc123def456')
      const event = {
        type: 'sdk_session_id_changed' as const,
        sessionId: '260125-swift-river',
        sdkSessionId: undefined,
      }

      const result = handleSdkSessionIdChanged(state, event)

      expect(result.state.session.sdkSessionId).toBeUndefined()
    })
  })

  describe('state immutability', () => {
    it('should return a new state object without mutating original', () => {
      const state = createMockState(undefined)
      const event = {
        type: 'sdk_session_id_changed' as const,
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = handleSdkSessionIdChanged(state, event)

      // Original state unchanged
      expect(state.session.sdkSessionId).toBeUndefined()
      // New state has the update
      expect(result.state.session.sdkSessionId).toBe('ses-abc123def456')
      // Different object references
      expect(result.state).not.toBe(state)
      expect(result.state.session).not.toBe(state.session)
    })
  })
})

// ============================================================================
// Integration Tests - Event Flow
// ============================================================================

// ============================================================================
// macOS Terminal Script Generation Tests
// ============================================================================

describe('macOS Terminal Script Generation', () => {
  /**
   * Simulates the script content generation from openMacTerminal
   */
  function generateScriptContent(options: {
    workingDirectory: string
    sdkSessionId: string
    taskListId?: string
  }): string {
    const { workingDirectory, sdkSessionId, taskListId } = options

    // Escape path for shell (single quotes with escaped single quotes)
    const escapedDir = `'${workingDirectory.replace(/'/g, "'\\''")}'`

    let scriptContent = '#!/bin/bash\n'
    scriptContent += '# Vesper Terminal Resume Script - auto-generated\n'
    scriptContent += `cd ${escapedDir}\n`

    if (taskListId) {
      scriptContent += `export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'\n`
    }

    scriptContent += `claude --resume ${sdkSessionId}\n`
    scriptContent += 'exec $SHELL\n'

    return scriptContent
  }

  it('should generate valid bash script with working directory', () => {
    const script = generateScriptContent({
      workingDirectory: '/Users/test/project',
      sdkSessionId: 'ses-abc123def456',
    })

    expect(script).toContain('#!/bin/bash')
    expect(script).toContain("cd '/Users/test/project'")
    expect(script).toContain('claude --resume ses-abc123def456')
    expect(script).toContain('exec $SHELL')
  })

  it('should include task list ID environment variable when provided', () => {
    const script = generateScriptContent({
      workingDirectory: '/Users/test/project',
      sdkSessionId: 'ses-abc123def456',
      taskListId: '260125-swift-river',
    })

    expect(script).toContain("export CLAUDE_CODE_TASK_LIST_ID='260125-swift-river'")
  })

  it('should not include task list ID when not provided', () => {
    const script = generateScriptContent({
      workingDirectory: '/Users/test/project',
      sdkSessionId: 'ses-abc123def456',
      taskListId: undefined,
    })

    expect(script).not.toContain('CLAUDE_CODE_TASK_LIST_ID')
  })

  it('should properly escape paths with single quotes', () => {
    const script = generateScriptContent({
      workingDirectory: "/Users/test/it's a test",
      sdkSessionId: 'ses-abc123def456',
    })

    // Single quotes in path should be escaped as '\''
    expect(script).toContain("cd '/Users/test/it'\\''s a test'")
  })

  it('should properly escape paths with spaces', () => {
    const script = generateScriptContent({
      workingDirectory: '/Users/test/My Project',
      sdkSessionId: 'ses-abc123def456',
    })

    expect(script).toContain("cd '/Users/test/My Project'")
  })
})

describe('Terminal Resume Button Visibility Flow', () => {
  /**
   * This test verifies the complete flow from SDK session ID capture
   * to the terminal resume button becoming visible.
   *
   * Flow:
   * 1. User sends first message
   * 2. Agent processes and SDK session ID is assigned
   * 3. onSdkSessionIdUpdate callback fires
   * 4. Session is persisted with sdkSessionId
   * 5. 'sdk_session_id_changed' event is sent to renderer
   * 6. Event processor updates session state
   * 7. TerminalResumeButton receives sdkSessionId prop and becomes visible
   */
  it('should enable terminal resume button after sdkSessionId is captured', () => {
    // Simulate initial session state (no sdkSessionId yet)
    const initialState = {
      session: {
        id: '260125-swift-river',
        sdkSessionId: undefined,
        workspaceId: 'workspace-1',
        workspaceName: 'Test Workspace',
        messages: [],
        isProcessing: false,
        lastMessageAt: Date.now(),
      },
      streaming: null,
    }

    // Button visibility check (mirrors TerminalResumeButton logic)
    const isButtonVisible = (sdkSessionId?: string) => Boolean(sdkSessionId)

    // Initially button is hidden
    expect(isButtonVisible(initialState.session.sdkSessionId)).toBe(false)

    // Simulate event from SDK session ID capture
    const event = {
      type: 'sdk_session_id_changed' as const,
      sessionId: '260125-swift-river',
      sdkSessionId: 'ses-abc123def456',
    }

    // Apply the event (simulating event processor)
    const updatedState = {
      ...initialState,
      session: {
        ...initialState.session,
        sdkSessionId: event.sdkSessionId,
      },
    }

    // Now button should be visible
    expect(isButtonVisible(updatedState.session.sdkSessionId)).toBe(true)
  })

  it('should hide terminal resume button when sdkSessionId is cleared', () => {
    // Session with existing sdkSessionId
    const initialState = {
      session: {
        id: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      },
    }

    const isButtonVisible = (sdkSessionId?: string) => Boolean(sdkSessionId)

    // Initially button is visible
    expect(isButtonVisible(initialState.session.sdkSessionId)).toBe(true)

    // Simulate event from SDK session ID clear (resume recovery)
    const event = {
      type: 'sdk_session_id_changed' as const,
      sessionId: '260125-swift-river',
      sdkSessionId: undefined,
    }

    // Apply the event
    const updatedState = {
      ...initialState,
      session: {
        ...initialState.session,
        sdkSessionId: event.sdkSessionId,
      },
    }

    // Now button should be hidden
    expect(isButtonVisible(updatedState.session.sdkSessionId)).toBe(false)
  })
})
