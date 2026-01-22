/**
 * Ralph Loop Types
 *
 * Core type definitions for the Ralph Loop autonomous coding system.
 * Ralph Loop processes PRD documents with checkbox-formatted user stories,
 * working through each story autonomously until completion.
 */

/**
 * Status of a single story in the PRD
 */
export type StoryStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

/**
 * A single user story extracted from a PRD
 */
export interface Story {
  /** Story identifier (e.g., "US-001") */
  id: string
  /** Story title from the checkbox line */
  title: string
  /** Line number in original PRD (for marking complete) */
  lineNumber: number
  /** Full story block content including description */
  content: string
  /** Current status of this story */
  status: StoryStatus
}

/**
 * Parsed PRD (Product Requirements Document)
 */
export interface PRD {
  /** Original markdown source */
  source: string
  /** Extracted stories */
  stories: Story[]
  /** PRD metadata */
  metadata: {
    totalStories: number
    completedStories: number
    pendingStories: number
    failedStories: number
  }
}

/**
 * Configuration for a Ralph Loop execution
 */
export interface LoopConfig {
  /** Maximum iterations per story before moving on (default: 5) */
  maxIterationsPerStory: number
  /** Timeout per story in milliseconds (default: 600000 = 10 min) */
  timeoutPerStoryMs: number
  /** Whether to auto-commit changes when agent doesn't (default: true) */
  autoCommit: boolean
  /** Prefix for commit messages (default: "feat") */
  commitMessagePrefix: string
}

/**
 * Default configuration values
 */
export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxIterationsPerStory: 5,
  timeoutPerStoryMs: 600000, // 10 minutes
  autoCommit: true,
  commitMessagePrefix: 'feat',
}

/**
 * Status of a Ralph Loop execution
 */
export type LoopStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'

/**
 * Error that occurred during loop execution
 */
export interface LoopError {
  /** Story that failed (if applicable) */
  storyId?: string
  /** Error message */
  message: string
  /** Error code for categorization */
  code: 'timeout' | 'agent_error' | 'git_error' | 'permission_denied' | 'unknown'
  /** Timestamp of the error */
  timestamp: number
}

/**
 * Result of completing a single story
 */
export interface StoryResult {
  /** Story that was processed */
  storyId: string
  /** Outcome of processing */
  result: 'success' | 'failed' | 'skipped' | 'timeout'
  /** Git commit SHA if changes were committed */
  commitSha?: string
  /** Number of iterations taken */
  iterations: number
  /** Time taken in milliseconds */
  durationMs: number
  /** Error message if failed */
  error?: string
}

/**
 * Summary of git changes made during story processing
 */
export interface ChangeSummary {
  /** Number of files added */
  filesAdded: number
  /** Number of files modified */
  filesModified: number
  /** Number of files deleted */
  filesDeleted: number
  /** List of changed file paths */
  changedFiles: string[]
}

/**
 * Complete state of a Ralph Loop execution
 */
export interface LoopState {
  /** Unique identifier for this loop execution */
  id: string
  /** Session this loop is running in */
  sessionId: string
  /** The PRD being processed */
  prd: PRD
  /** Configuration for this loop */
  config: LoopConfig
  /** Currently processing story (null if between stories or not started) */
  currentStory: Story | null
  /** Current iteration number for the current story (1-indexed) */
  currentIteration: number
  /** Overall loop status */
  status: LoopStatus
  /** When the loop started (Unix timestamp) */
  startTime: number
  /** Number of stories completed successfully */
  storiesCompleted: number
  /** Errors encountered during execution */
  errors: LoopError[]
  /** Results for each processed story */
  storyResults: StoryResult[]
}

/**
 * Final result of a Ralph Loop execution
 */
export interface LoopResult {
  /** Unique identifier of the completed loop */
  loopId: string
  /** Final status */
  status: 'completed' | 'cancelled' | 'error'
  /** Summary statistics */
  summary: {
    totalStories: number
    completedStories: number
    failedStories: number
    skippedStories: number
    totalTimeMs: number
    commits: string[]
  }
  /** Individual story results */
  storyResults: StoryResult[]
  /** Errors that occurred */
  errors: LoopError[]
}

/**
 * Events emitted by the RalphLoopRunner
 */
export type LoopRunnerEvent =
  | { type: 'progress'; state: LoopState }
  | { type: 'story_start'; story: Story }
  | { type: 'story_complete'; story: Story; result: StoryResult }
  | { type: 'iteration'; iteration: number; story: Story }
  | { type: 'error'; error: LoopError }
  | { type: 'complete'; result: LoopResult }
  | { type: 'paused'; state: LoopState }
  | { type: 'resumed'; state: LoopState }

/**
 * State persisted for crash recovery
 */
export interface PersistedLoopState {
  loopId: string
  sessionId: string
  prd: PRD
  config: LoopConfig
  currentStoryIndex: number
  currentIteration: number
  completedStories: string[]
  failedStories: string[]
  skippedStories: string[]
  storyResults: StoryResult[]
  startTime: number
  lastUpdated: number
}
