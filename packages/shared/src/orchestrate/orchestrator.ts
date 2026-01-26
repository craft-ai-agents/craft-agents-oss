/**
 * Orchestrator
 *
 * Thin orchestration layer over dispatch for PRD processing.
 * Parses PRD → creates dispatch tasks → monitors progress → emits events.
 *
 * Architecture:
 * - Converts PRD stories to dispatch-compatible tasks
 * - Embeds metadata in task descriptions for tracking
 * - Monitors ~/.claude/tasks/{listId}/ for progress updates
 * - Emits events for UI integration
 *
 * @example
 * ```typescript
 * const orchestrator = createOrchestrator(sessionId, { parallelism: 3 })
 *
 * orchestrator.on('dispatch_ready', (tasks, taskListId) => {
 *   // Pass tasks to dispatch skill for execution
 * })
 *
 * orchestrator.on('story_complete', (story, result) => {
 *   console.log(`Story ${story.id} completed`)
 * })
 *
 * const tasks = await orchestrator.prepare(prd, taskListId)
 * ```
 */

import { EventEmitter } from 'events'
import type { FSWatcher } from 'fs'
import type {
  PRD,
  Story,
  OrchestrateConfig,
  OrchestrateState,
  OrchestrateResult,
  OrchestrateError,
  StoryResult,
} from './types.ts'
import { DEFAULT_ORCHESTRATE_CONFIG } from './types.ts'
import {
  markStoryComplete,
  markStoryFailed,
  markStoryInProgress,
} from './prd-parser.ts'
import { storiesToDispatchTasks, type DispatchTask } from './dispatch-adapter.ts'
import { watchTaskProgress, type ProgressUpdate } from './progress-monitor.ts'

function generateOrchestrateId(): string {
  return `orch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Event interface for Orchestrator
 *
 * Events are emitted during orchestration lifecycle for UI integration.
 */
export interface OrchestratorEvents {
  /** Progress update with current state */
  progress: (state: OrchestrateState) => void
  /** Story execution started */
  story_start: (story: Story) => void
  /** Story execution completed (success/failed) */
  story_complete: (story: Story, result: StoryResult) => void
  /** Error occurred during orchestration */
  error: (error: OrchestrateError) => void
  /** All stories processed, orchestration complete */
  complete: (result: OrchestrateResult) => void
  /** Orchestration paused (deprecated - handled by dispatch) */
  paused: (state: OrchestrateState) => void
  /** Orchestration resumed (deprecated - handled by dispatch) */
  resumed: (state: OrchestrateState) => void
  /** Dispatch tasks ready for execution */
  dispatch_ready: (tasks: DispatchTask[], taskListId: string) => void
}

/**
 * Orchestrator class
 *
 * Main orchestration controller that delegates to dispatch skill.
 * Extends EventEmitter to provide lifecycle events.
 */
export class Orchestrator extends EventEmitter {
  private state: OrchestrateState | null = null
  private progressWatcher: FSWatcher | null = null
  private storyTaskMap: Map<string, string> = new Map() // storyId -> taskId

  constructor(
    private sessionId: string,
    private config: OrchestrateConfig = DEFAULT_ORCHESTRATE_CONFIG
  ) {
    super()
  }

  /**
   * Get current orchestration state
   * @returns Current state or null if not running
   */
  getState(): OrchestrateState | null {
    return this.state
  }

  /**
   * Check if orchestration is currently running
   * @returns True if status is 'running'
   */
  isRunning(): boolean {
    return this.state !== null && this.state.status === 'running'
  }

  /**
   * Prepare orchestration - parse PRD and create dispatch tasks
   *
   * This is the main entry point for the new architecture.
   * Converts PRD stories to dispatch tasks and starts progress monitoring.
   *
   * @param prd - Parsed PRD document with stories
   * @param taskListId - Task list ID for ~/.claude/tasks/{listId}/
   * @returns Array of dispatch tasks ready for execution
   *
   * @fires dispatch_ready - Emitted when tasks are ready
   * @fires progress - Emitted with initial state
   */
  async prepare(prd: PRD, taskListId: string): Promise<DispatchTask[]> {
    const orchestrateId = generateOrchestrateId()

    this.state = {
      id: orchestrateId,
      sessionId: this.sessionId,
      prd,
      config: this.config,
      status: 'running',
      startTime: Date.now(),
      storiesCompleted: 0,
      storiesInProgress: 0,
      errors: [],
      storyResults: [],
      taskListId,
    }

    // Convert stories to dispatch tasks
    const tasks = storiesToDispatchTasks(prd.stories, orchestrateId)

    // Start monitoring task progress
    this.startProgressMonitor(taskListId)

    this.emitProgress()
    this.emit('dispatch_ready', tasks, taskListId)

    return tasks
  }

  /**
   * Legacy start() method for backwards compatibility
   *
   * This method maintains the old RalphLoopRunner API but the implementation
   * is simplified. It prepares the orchestration and returns a promise that
   * resolves when all stories are complete.
   *
   * @deprecated The new architecture delegates execution to dispatch.
   * This method is maintained for backwards compatibility but will be removed
   * once sessions.ts is updated to use the new API.
   */
  async start(prd: PRD): Promise<OrchestrateResult> {
    if (this.state?.status === 'running') {
      throw new Error('Loop is already running')
    }

    // Use a default task list ID if not configured
    const taskListId = this.config.taskListId || `orch-${Date.now()}`

    // Prepare the orchestration (creates state and starts monitoring)
    await this.prepare(prd, taskListId)

    // Return a promise that resolves when orchestration completes
    return new Promise((resolve, reject) => {
      const handleComplete = (result: OrchestrateResult) => {
        this.off('complete', handleComplete)
        this.off('error', handleError)
        resolve(result)
      }

      const handleError = (error: OrchestrateError) => {
        this.off('complete', handleComplete)
        this.off('error', handleError)

        // Build a result even on error
        const result = this.buildResult()
        resolve(result)
      }

      this.on('complete', handleComplete)
      this.on('error', handleError)

      // Note: Actual task execution should happen externally via dispatch skill
      // For now, mark all stories as skipped since we have no agent executor
      setTimeout(() => {
        if (this.state) {
          for (const story of this.state.prd.stories) {
            this.state.storyResults.push({
              storyId: story.id,
              result: 'skipped',
              durationMs: 0,
              error: 'Orchestrator delegates execution to dispatch - no direct execution implemented',
            })
          }
          this.complete()
        }
      }, 100)
    })
  }

  /**
   * Pause execution (no-op in new architecture)
   * @deprecated Pause/resume logic should be handled by dispatch
   */
  pause(): void {
    if (this.state) {
      this.state.status = 'paused'
      this.emit('paused', { ...this.state })
      this.emitProgress()
    }
  }

  /**
   * Resume execution (no-op in new architecture)
   * @deprecated Pause/resume logic should be handled by dispatch
   */
  async resume(): Promise<void> {
    if (this.state && this.state.status === 'paused') {
      this.state.status = 'running'
      this.emit('resumed', { ...this.state })
      this.emitProgress()
    }
  }

  /**
   * Start monitoring task progress
   */
  private startProgressMonitor(taskListId: string): void {
    try {
      this.progressWatcher = watchTaskProgress(taskListId, (update) => {
        this.handleProgressUpdate(update)
      })
    } catch (error) {
      // Task directory may not exist yet - this is fine, we'll create it later
      // or monitoring may not be needed in test environments
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  /**
   * Handle progress updates from task file changes
   */
  private handleProgressUpdate(update: ProgressUpdate): void {
    if (!this.state || !update.meta) return

    const { storyId } = update.meta
    const story = this.state.prd.stories.find(s => s.id === storyId)
    if (!story) return

    // Track task ID mapping
    this.storyTaskMap.set(storyId, update.taskId)

    if (update.status === 'in_progress' && story.status === 'pending') {
      this.state.prd = markStoryInProgress(this.state.prd, storyId)
      this.state.storiesInProgress++
      this.emit('story_start', story)
    } else if (update.status === 'completed' && story.status !== 'completed') {
      this.state.prd = markStoryComplete(this.state.prd, storyId)
      this.state.storiesCompleted++
      this.state.storiesInProgress = Math.max(0, this.state.storiesInProgress - 1)

      const result: StoryResult = {
        storyId,
        result: 'success',
        durationMs: Date.now() - this.state.startTime,
      }
      this.state.storyResults.push(result)
      this.emit('story_complete', story, result)

      // Check if all stories completed
      if (this.state.storiesCompleted === this.state.prd.metadata.totalStories) {
        this.complete()
      }
    }

    this.emitProgress()
  }

  /**
   * Mark orchestration as complete
   */
  private complete(): void {
    if (!this.state) return

    this.state.status = 'completed'
    this.stopProgressMonitor()

    const result = this.buildResult()
    this.emit('complete', result)
    this.emitProgress()
  }

  /**
   * Cancel orchestration
   *
   * Stops progress monitoring and marks state as cancelled.
   * Does not affect running tasks - those should be cancelled via dispatch.
   */
  cancel(): void {
    if (this.state) {
      this.state.status = 'cancelled'
      this.stopProgressMonitor()
      this.emitProgress()
    }
  }

  /**
   * Clean up resources
   *
   * Stops file watcher, removes event listeners, clears state.
   * Should be called when orchestration is complete or session ends.
   */
  destroy(): void {
    // If there's an active state, emit complete event before cleanup
    // This ensures any pending promises resolve
    if (this.state && this.state.status === 'running') {
      this.state.status = 'cancelled'
      const result = this.buildResult()
      this.emit('complete', result)
    }

    this.stopProgressMonitor()
    this.removeAllListeners()
    this.state = null
    this.storyTaskMap.clear()
  }

  private stopProgressMonitor(): void {
    if (this.progressWatcher) {
      this.progressWatcher.close()
      this.progressWatcher = null
    }
  }

  private emitProgress(): void {
    if (this.state) {
      this.emit('progress', { ...this.state })
    }
  }

  private buildResult(): OrchestrateResult {
    const state = this.state!
    return {
      orchestrateId: state.id,
      status: state.status === 'completed' ? 'completed' :
              state.status === 'error' ? 'error' : 'cancelled',
      summary: {
        totalStories: state.prd.metadata.totalStories,
        completedStories: state.storiesCompleted,
        failedStories: state.storyResults.filter(r => r.result === 'failed').length,
        skippedStories: state.storyResults.filter(r => r.result === 'skipped').length,
        totalTimeMs: Date.now() - state.startTime,
        commits: state.storyResults.filter(r => r.commitSha).map(r => r.commitSha!),
      },
      storyResults: state.storyResults,
      errors: state.errors,
    }
  }
}

/**
 * Create a new Orchestrator instance
 *
 * Factory function that merges provided config with defaults.
 *
 * @param sessionId - Session ID for tracking
 * @param config - Partial config to override defaults
 * @returns Configured Orchestrator instance
 *
 * @example
 * ```typescript
 * const orchestrator = createOrchestrator(sessionId, {
 *   parallelism: 5,
 *   timeoutPerStoryMs: 300000
 * })
 * ```
 */
export function createOrchestrator(
  sessionId: string,
  config?: Partial<OrchestrateConfig>
): Orchestrator {
  const fullConfig: OrchestrateConfig = {
    parallelism: config?.parallelism ?? 3,
    timeoutPerStoryMs: config?.timeoutPerStoryMs ?? 600000,
    autoCommit: config?.autoCommit ?? true,
    commitMessagePrefix: config?.commitMessagePrefix ?? 'feat',
    taskListId: config?.taskListId,
  }
  return new Orchestrator(sessionId, fullConfig)
}
