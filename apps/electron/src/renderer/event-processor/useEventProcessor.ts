/**
 * Event Processor Hook
 *
 * Provides the event processor for use in App.tsx.
 * Manages streaming state per session and returns processed events.
 */

import { useCallback, useRef } from 'react'
import type { Session } from '../../shared/types'
import { processEvent } from './processor'
import type { SessionState, AgentEvent, Effect, StreamingState } from './types'
import { createEmptySession } from './helpers'

interface UseEventProcessorResult {
  /**
   * Process an agent event and return the updated session + any side effects
   *
   * @param event - The agent event to process
   * @param currentSession - Current session state (or null if not found)
   * @param workspaceId - Workspace ID for creating new sessions
   * @returns Updated session and any side effects to execute
   */
  processAgentEvent: (
    event: AgentEvent,
    currentSession: Session | null,
    workspaceId: string
  ) => { session: Session; effects: Effect[] }

  /**
   * Clear streaming state for a session (e.g., on error or complete)
   */
  clearStreamingState: (sessionId: string) => void

  /**
   * Get current streaming state for a session (for debugging/testing)
   */
  getStreamingState: (sessionId: string) => StreamingState | null
}

/**
 * Hook that provides the event processor
 *
 * Manages streaming state per session (replaces streamingTextRef).
 * All event processing goes through pure functions.
 */
export function useEventProcessor(): UseEventProcessorResult {
  // Streaming state per session (not in React state - just a ref for accumulation)
  const streamingStates = useRef<Map<string, StreamingState>>(new Map())

  const processAgentEvent = useCallback((
    event: AgentEvent,
    currentSession: Session | null,
    workspaceId: string
  ): { session: Session; effects: Effect[] } => {
    // Create empty session if needed
    const session = currentSession ?? createEmptySession(event.sessionId, workspaceId)

    // Build current state
    const currentState: SessionState = {
      session,
      streaming: streamingStates.current.get(event.sessionId) ?? null,
    }

    // Process through pure function
    const result = processEvent(currentState, event)

    // Update streaming state ref
    if (result.state.streaming) {
      streamingStates.current.set(event.sessionId, result.state.streaming)
    } else {
      streamingStates.current.delete(event.sessionId)
    }

    return {
      session: result.state.session,
      effects: result.effects,
    }
  }, [])

  const clearStreamingState = useCallback((sessionId: string) => {
    streamingStates.current.delete(sessionId)
  }, [])

  const getStreamingState = useCallback((sessionId: string): StreamingState | null => {
    return streamingStates.current.get(sessionId) ?? null
  }, [])

  return {
    processAgentEvent,
    clearStreamingState,
    getStreamingState,
  }
}
