/**
 * Loop Event Handlers
 *
 * Handles Ralph Loop events: progress, story_complete, etc.
 * Pure functions that return new state - no side effects.
 */

import type {
  SessionState,
  LoopProgressEvent,
  LoopStoryCompleteEvent,
  LoopCompleteEvent,
  LoopStartedEvent,
  LoopPausedEvent,
  LoopResumedEvent,
  LoopCancelledEvent,
  LoopErrorEvent,
} from '../types'

/**
 * Handle loop_started - loop execution has begun
 */
export function handleLoopStarted(
  state: SessionState,
  event: LoopStartedEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        isActive: true,
        loopId: event.loopId,
        status: 'running',
        progress: {
          currentStoryIndex: 0,
          totalStories: event.totalStories,
          currentIteration: 0,
          maxIterations: event.config.maxIterationsPerStory,
        },
        elapsedMs: 0,
      },
    },
  }
}

/**
 * Handle loop_progress - real-time updates during loop execution
 */
export function handleLoopProgress(
  state: SessionState,
  event: LoopProgressEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        ...state.session.loopState,
        isActive: true,
        loopId: event.loopId,
        status: event.status,
        currentStory: event.currentStory || undefined,
        progress: {
          currentStoryIndex: event.storyIndex,
          totalStories: event.totalStories,
          currentIteration: event.currentIteration,
          maxIterations: event.maxIterations,
        },
        elapsedMs: event.elapsedMs,
      },
    },
  }
}

/**
 * Handle loop_story_complete - a story finished processing
 */
export function handleLoopStoryComplete(
  state: SessionState,
  event: LoopStoryCompleteEvent
): SessionState {
  // Story completion doesn't change the overall loop state significantly
  // The progress event will update with the next story
  return state
}

/**
 * Handle loop_complete - entire loop finished
 */
export function handleLoopComplete(
  state: SessionState,
  event: LoopCompleteEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        isActive: false,
        loopId: event.loopId,
        status: 'completed',
        summary: event.summary,
      },
    },
  }
}

/**
 * Handle loop_paused - loop was paused by user
 */
export function handleLoopPaused(
  state: SessionState,
  event: LoopPausedEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        ...state.session.loopState,
        isActive: true,
        loopId: event.loopId,
        status: 'paused',
        progress: state.session.loopState?.progress
          ? {
              ...state.session.loopState.progress,
              currentStoryIndex: event.currentStoryIndex,
            }
          : undefined,
      },
    },
  }
}

/**
 * Handle loop_resumed - loop was resumed after pause
 */
export function handleLoopResumed(
  state: SessionState,
  event: LoopResumedEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        ...state.session.loopState,
        isActive: true,
        loopId: event.loopId,
        status: 'running',
      },
    },
  }
}

/**
 * Handle loop_cancelled - loop was cancelled by user
 */
export function handleLoopCancelled(
  state: SessionState,
  event: LoopCancelledEvent
): SessionState {
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        isActive: false,
        loopId: event.loopId,
        status: 'cancelled',
        summary: {
          totalStories: event.totalStories,
          completedStories: event.completedStories,
          failedStories: 0,
          skippedStories: event.totalStories - event.completedStories,
          totalTimeMs: state.session.loopState?.elapsedMs || 0,
          commits: [],
        },
      },
    },
  }
}

/**
 * Handle loop_error - error during loop execution
 */
export function handleLoopError(
  state: SessionState,
  event: LoopErrorEvent
): SessionState {
  // Errors are recorded but don't necessarily stop the loop
  // The loop runner decides whether to continue based on error type
  return {
    ...state,
    session: {
      ...state.session,
      loopState: {
        ...state.session.loopState,
        isActive: state.session.loopState?.status === 'running',
        loopId: event.loopId,
        // Don't change status here - let loop_complete/cancelled handle final state
      },
    },
  }
}
