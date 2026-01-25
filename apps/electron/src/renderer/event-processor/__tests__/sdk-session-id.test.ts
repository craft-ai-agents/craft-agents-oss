/**
 * Tests for sdk_session_id_changed event handling in the event processor.
 *
 * This event enables the terminal resume button to appear after the first
 * message is sent and the SDK session ID is captured.
 */

import { describe, it, expect } from 'bun:test'
import { processEvent } from '../processor'
import type { SessionState, SdkSessionIdChangedEvent } from '../types'

describe('Event Processor - sdk_session_id_changed', () => {
  const createMockSessionState = (sdkSessionId?: string): SessionState => ({
    session: {
      id: '260125-swift-river',
      workspaceId: 'workspace-1',
      workspaceName: 'Test Workspace',
      messages: [],
      isProcessing: false,
      lastMessageAt: Date.now(),
      sdkSessionId,
    },
    streaming: null,
  })

  describe('handleSdkSessionIdChanged', () => {
    it('should update session with sdkSessionId when first captured', () => {
      const state = createMockSessionState(undefined)
      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = processEvent(state, event)

      expect(result.state.session.sdkSessionId).toBe('ses-abc123def456')
      expect(result.effects).toEqual([])
    })

    it('should clear sdkSessionId when set to undefined', () => {
      const state = createMockSessionState('ses-abc123def456')
      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: undefined,
      }

      const result = processEvent(state, event)

      expect(result.state.session.sdkSessionId).toBeUndefined()
    })

    it('should not mutate the original state', () => {
      const state = createMockSessionState(undefined)
      const originalSdkSessionId = state.session.sdkSessionId

      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = processEvent(state, event)

      // Original state should be unchanged
      expect(state.session.sdkSessionId).toBe(originalSdkSessionId)
      // Result should have the new value
      expect(result.state.session.sdkSessionId).toBe('ses-abc123def456')
    })

    it('should return new object references for state and session', () => {
      const state = createMockSessionState(undefined)
      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = processEvent(state, event)

      // Should be different object references (for React reactivity)
      expect(result.state).not.toBe(state)
      expect(result.state.session).not.toBe(state.session)
    })

    it('should preserve streaming state', () => {
      const state: SessionState = {
        ...createMockSessionState(undefined),
        streaming: {
          content: 'partial response...',
          turnId: 'turn-1',
        },
      }
      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = processEvent(state, event)

      expect(result.state.streaming).toEqual({
        content: 'partial response...',
        turnId: 'turn-1',
      })
    })

    it('should preserve other session properties', () => {
      const state = createMockSessionState(undefined)
      state.session.name = 'My Session'
      state.session.isFlagged = true
      state.session.workingDirectory = '/Users/test/project'

      const event: SdkSessionIdChangedEvent = {
        type: 'sdk_session_id_changed',
        sessionId: '260125-swift-river',
        sdkSessionId: 'ses-abc123def456',
      }

      const result = processEvent(state, event)

      expect(result.state.session.name).toBe('My Session')
      expect(result.state.session.isFlagged).toBe(true)
      expect(result.state.session.workingDirectory).toBe('/Users/test/project')
      expect(result.state.session.sdkSessionId).toBe('ses-abc123def456')
    })
  })
})
