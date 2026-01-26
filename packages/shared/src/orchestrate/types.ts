/**
 * Orchestrate Types
 *
 * Core type definitions for the Orchestrate autonomous coding system.
 * Orchestrate processes PRD documents with checkbox-formatted user stories,
 * delegating parallel execution to the dispatch skill.
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
 * Configuration for an Orchestrate execution
 */
export interface OrchestrateConfig {
  /** Maximum parallel agents (default: 3) */
  parallelism: number
  /** Timeout per story in milliseconds (default: 600000 = 10 min) */
  timeoutPerStoryMs: number
  /** Whether to auto-commit changes when agent doesn't (default: true) */
  autoCommit: boolean
  /** Prefix for commit messages (default: "feat") */
  commitMessagePrefix: string
  /** Task list ID for dispatch (created if not provided) */
  taskListId?: string
}

/**
 * Default configuration values
 */
export const DEFAULT_ORCHESTRATE_CONFIG: OrchestrateConfig = {
  parallelism: 3,
  timeoutPerStoryMs: 600000, // 10 minutes
  autoCommit: true,
  commitMessagePrefix: 'feat',
}

/**
 * Status of an Orchestrate execution
 */
export type OrchestrateStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error'

/**
 * Error that occurred during orchestration
 */
export interface OrchestrateError {
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
 * Complete state of an Orchestrate execution
 */
export interface OrchestrateState {
  /** Unique identifier for this orchestration */
  id: string
  /** Session this orchestration is running in */
  sessionId: string
  /** The PRD being processed */
  prd: PRD
  /** Configuration for this orchestration */
  config: OrchestrateConfig
  /** Overall status */
  status: OrchestrateStatus
  /** When the orchestration started (Unix timestamp) */
  startTime: number
  /** Number of stories completed successfully */
  storiesCompleted: number
  /** Number of stories in progress */
  storiesInProgress: number
  /** Errors encountered during execution */
  errors: OrchestrateError[]
  /** Results for each processed story */
  storyResults: StoryResult[]
  /** Task list ID being used */
  taskListId?: string
  /** Map of story IDs to their corresponding task IDs */
  taskIds?: Record<string, string>
}

/**
 * Final result of an Orchestrate execution
 */
export interface OrchestrateResult {
  /** Unique identifier of the completed orchestration */
  orchestrateId: string
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
  errors: OrchestrateError[]
}

/**
 * Events emitted by the Orchestrator
 */
export type OrchestrateEvent =
  | { type: 'progress'; state: OrchestrateState }
  | { type: 'story_start'; story: Story }
  | { type: 'story_complete'; story: Story; result: StoryResult }
  | { type: 'error'; error: OrchestrateError }
  | { type: 'complete'; result: OrchestrateResult }
  | { type: 'paused'; state: OrchestrateState }
  | { type: 'resumed'; state: OrchestrateState }

/**
 * Metadata embedded in task descriptions for story tracking
 */
export interface OrchestrateMeta {
  /** Story ID from PRD */
  storyId: string
  /** Orchestration ID */
  orchestrateId: string
  /** Line number in PRD */
  lineNumber: number
}

// Legacy type aliases for backwards compatibility during migration
export type LoopConfig = OrchestrateConfig
export type LoopStatus = OrchestrateStatus
export type LoopError = OrchestrateError
export type LoopState = OrchestrateState
export type LoopResult = OrchestrateResult
export type LoopRunnerEvent = OrchestrateEvent
export const DEFAULT_LOOP_CONFIG = DEFAULT_ORCHESTRATE_CONFIG
