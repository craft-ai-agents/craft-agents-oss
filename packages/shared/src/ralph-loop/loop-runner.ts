/**
 * Ralph Loop Runner
 *
 * Orchestrates the execution of a Ralph Loop - processing user stories
 * from a PRD document sequentially, with iteration control and progress tracking.
 */

import { EventEmitter } from 'events'
import type { VesperAgent } from '../agent/vesper-agent.ts'
import type { AgentEvent } from '@vesper/core/types'
import type {
  PRD,
  Story,
  LoopConfig,
  LoopState,
  LoopResult,
  LoopError,
  StoryResult,
  LoopRunnerEvent,
  DEFAULT_LOOP_CONFIG,
} from './types.ts'
import {
  parsePRD,
  getNextPendingStory,
  markStoryComplete,
  markStoryFailed,
  markStorySkipped,
  generateStoryPrompt,
  getStoryIndex,
} from './prd-parser.ts'
import { createGitOperations, type GitOperations } from './git-ops.ts'
import { loadTaskList, batchCreateTasks, updateTask } from '../task-lists/index.ts'

/**
 * Generate a unique loop ID
 */
function generateLoopId(): string {
  return `loop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Type-safe event emitter for loop events
 */
export interface RalphLoopRunnerEvents {
  progress: (state: LoopState) => void
  story_start: (story: Story) => void
  story_complete: (story: Story, result: StoryResult) => void
  iteration: (iteration: number, story: Story) => void
  error: (error: LoopError) => void
  complete: (result: LoopResult) => void
  paused: (state: LoopState) => void
  resumed: (state: LoopState) => void
  /** Agent events forwarded from VesperAgent during story processing */
  agent_event: (event: AgentEvent) => void
}

/**
 * RalphLoopRunner - Executes autonomous coding loops
 *
 * Processes PRD stories sequentially, with:
 * - Configurable iteration limits per story
 * - Timeout handling
 * - Auto-commit when agent doesn't commit
 * - Pause/resume/cancel support
 * - Progress event emission
 */
export class RalphLoopRunner extends EventEmitter {
  private state: LoopState | null = null
  private isPaused: boolean = false
  private isCancelled: boolean = false
  private currentAbortController: AbortController | null = null

  constructor(
    private sessionId: string,
    private agent: VesperAgent,
    private gitOps: GitOperations,
    private config: LoopConfig
  ) {
    super()
  }

  /**
   * Get current loop state
   */
  getState(): LoopState | null {
    return this.state
  }

  /**
   * Check if a loop is currently running
   */
  isRunning(): boolean {
    return this.state !== null && this.state.status === 'running'
  }

  /**
   * Start the loop execution
   *
   * @param prd - Parsed PRD to process
   * @returns Final loop result
   */
  async start(prd: PRD): Promise<LoopResult> {
    if (this.state?.status === 'running') {
      throw new Error('Loop is already running')
    }

    // Initialize state
    const loopId = generateLoopId()
    const startTime = Date.now()
    this.state = {
      id: loopId,
      sessionId: this.sessionId,
      prd,
      config: this.config,
      currentStory: null,
      currentIteration: 0,
      status: 'running',
      startTime,
      storiesCompleted: 0,
      errors: [],
      storyResults: [],
    }

    this.isPaused = false
    this.isCancelled = false

    // Create tasks upfront if task list is configured
    if (this.config.taskListId && this.config.autoCreateTasks !== false) {
      try {
        // Validate task list exists
        const taskList = await loadTaskList(this.config.taskListId)
        if (!taskList) {
          throw new Error(`Task list not found: ${this.config.taskListId}`)
        }

        // Prepare task data from PRD stories
        const tasksToCreate = prd.stories.map(story => ({
          subject: story.title,
          description: story.content,
          activeForm: `Processing ${story.title}`,
          metadata: {
            storyId: story.id,
            loopId: loopId,
            lineNumber: story.lineNumber,
          },
        }))

        // Batch create all tasks at once
        const createdTasks = await batchCreateTasks(this.config.taskListId, tasksToCreate)

        // Build mapping of story ID -> task ID
        const taskIds: Record<string, string> = {}
        createdTasks.forEach((task, index) => {
          const story = prd.stories[index]
          if (story) {
            taskIds[story.id] = task.id
          }
        })

        // Update state with task list info
        if (this.state) {
          this.state.taskListId = this.config.taskListId
          this.state.taskIds = taskIds
        }

        console.log(`[Ralph Loop] Created ${createdTasks.length} tasks in task list ${this.config.taskListId}`)
      } catch (error) {
        console.error('[Ralph Loop] Failed to create tasks:', error)
        // Don't fail the loop, just log the error and continue without task tracking
      }
    }

    this.emitProgress()

    try {
      await this.runLoop()
    } catch (error) {
      // Guard against state being null (e.g., if destroy() was called during execution)
      if (this.state) {
        const loopError: LoopError = {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: 'unknown',
          timestamp: Date.now(),
        }
        this.state.errors.push(loopError)
        this.state.status = 'error'
        this.emit('error', loopError)
      }
    }

    // If state was cleared by destroy(), return a minimal cancelled result
    if (!this.state) {
      return {
        loopId: loopId,
        status: 'cancelled',
        summary: {
          totalStories: prd.metadata.totalStories,
          completedStories: 0,
          failedStories: 0,
          skippedStories: 0,
          totalTimeMs: Date.now() - startTime,
          commits: [],
        },
        storyResults: [],
        errors: [],
      }
    }

    return this.buildResult()
  }

  /**
   * Pause the loop after current story completes
   */
  pause(): void {
    if (this.state?.status === 'running') {
      this.isPaused = true
      // Don't change status until story completes
    }
  }

  /**
   * Resume a paused loop
   */
  async resume(): Promise<void> {
    if (this.state?.status === 'paused') {
      this.isPaused = false
      this.state.status = 'running'
      this.emit('resumed', this.state)
      this.emitProgress()
      await this.runLoop()
    }
  }

  /**
   * Cancel the loop immediately
   */
  cancel(): void {
    this.isCancelled = true
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }
    if (this.state) {
      this.state.status = 'cancelled'
      this.emitProgress()
    }
  }

  /**
   * Destroy the loop runner and release all resources.
   * Call this when the loop runner is no longer needed (session deletion, app shutdown).
   *
   * Ensures:
   * - All event listeners are removed (prevents memory leaks)
   * - AbortController is cancelled (stops in-flight operations)
   * - State is cleared (releases memory)
   * - No further events will be emitted
   */
  destroy(): void {
    // Cancel any in-flight operations
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }

    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners()

    // Clear state to release memory
    this.state = null
    this.isPaused = false
    this.isCancelled = true
  }

  /**
   * Main loop execution
   */
  private async runLoop(): Promise<void> {
    while (!this.isCancelled && !this.isPaused) {
      // Get next pending story
      const story = getNextPendingStory(this.state!.prd)

      if (!story) {
        // All stories complete
        this.state!.status = 'completed'
        break
      }

      // Process this story
      const result = await this.processStory(story)
      this.state!.storyResults.push(result)

      // Update PRD based on result
      if (result.result === 'success') {
        this.state!.prd = markStoryComplete(this.state!.prd, story.id)
        this.state!.storiesCompleted++
      } else if (result.result === 'failed' || result.result === 'timeout') {
        this.state!.prd = markStoryFailed(this.state!.prd, story.id)
      } else if (result.result === 'skipped') {
        this.state!.prd = markStorySkipped(this.state!.prd, story.id)
      }

      this.emit('story_complete', story, result)
      this.emitProgress()

      // Check for pause
      if (this.isPaused) {
        this.state!.status = 'paused'
        this.emit('paused', this.state!)
        break
      }
    }

    if (this.isCancelled) {
      this.state!.status = 'cancelled'
    }

    this.state!.currentStory = null
    this.emitProgress()
    this.emit('complete', this.buildResult())
  }

  /**
   * Process a single story with iteration control
   */
  private async processStory(story: Story): Promise<StoryResult> {
    const startTime = Date.now()
    let iterations = 0

    this.state!.currentStory = story
    this.state!.currentIteration = 0
    this.emit('story_start', story)
    this.emitProgress()

    // Update task status to in_progress (non-fatal)
    if (this.state!.taskListId && this.state!.taskIds) {
      const taskId = this.state!.taskIds[story.id]
      if (taskId) {
        try {
          await updateTask(this.state!.taskListId, taskId, {
            status: 'in_progress',
            owner: this.sessionId,
          })
        } catch (error) {
          console.error('[Ralph Loop] Failed to update task status to in_progress:', error)
          // Continue processing even if task update fails
        }
      }
    }

    // Capture git HEAD before processing
    let beforeHead: string
    try {
      beforeHead = await this.gitOps.getCurrentHead()
    } catch {
      beforeHead = ''
    }

    for (let i = 1; i <= this.config.maxIterationsPerStory && !this.isCancelled; i++) {
      iterations = i
      this.state!.currentIteration = i
      this.emit('iteration', i, story)
      this.emitProgress()

      try {
        // Run agent with timeout
        const success = await this.runAgentIteration(story, i)

        if (success) {
          // Check if commit was created
          let commitSha: string | undefined
          try {
            const commitCreated = await this.gitOps.verifyCommitCreated(beforeHead)
            if (commitCreated) {
              commitSha = await this.gitOps.getCurrentHead()
            } else if (this.config.autoCommit) {
              // Auto-commit if agent didn't create one
              const hasChanges = await this.gitOps.hasUncommittedChanges()
              if (hasChanges) {
                commitSha = await this.gitOps.createAutoCommit(story.id, story.title)
              }
            }
          } catch {
            // Git errors are non-fatal for story completion
          }

          // Update task status to completed (non-fatal)
          if (this.state!.taskListId && this.state!.taskIds) {
            const taskId = this.state!.taskIds[story.id]
            if (taskId) {
              try {
                await updateTask(this.state!.taskListId, taskId, {
                  status: 'completed',
                  metadata: {
                    completedAt: new Date().toISOString(),
                    iterations,
                    commitSha,
                  },
                })
              } catch (error) {
                console.error('[Ralph Loop] Failed to update task status to completed:', error)
                // Continue processing even if task update fails
              }
            }
          }

          return {
            storyId: story.id,
            result: 'success',
            commitSha,
            iterations,
            durationMs: Date.now() - startTime,
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        // Check if it was a timeout
        if (errorMessage.includes('timeout') || errorMessage.includes('aborted')) {
          const loopError: LoopError = {
            storyId: story.id,
            message: `Story timed out after ${this.config.timeoutPerStoryMs}ms`,
            code: 'timeout',
            timestamp: Date.now(),
          }
          this.state!.errors.push(loopError)
          this.emit('error', loopError)

          // Update task metadata with timeout info (keep status as in_progress)
          if (this.state!.taskListId && this.state!.taskIds) {
            const taskId = this.state!.taskIds[story.id]
            if (taskId) {
              try {
                await updateTask(this.state!.taskListId, taskId, {
                  metadata: {
                    timeout: true,
                    timedOutAt: new Date().toISOString(),
                    iterations,
                    error: loopError.message,
                  },
                })
              } catch (error) {
                console.error('[Ralph Loop] Failed to update task metadata for timeout:', error)
                // Continue processing even if task update fails
              }
            }
          }

          return {
            storyId: story.id,
            result: 'timeout',
            iterations,
            durationMs: Date.now() - startTime,
            error: loopError.message,
          }
        }

        // Log error but continue to next iteration
        const loopError: LoopError = {
          storyId: story.id,
          message: errorMessage,
          code: 'agent_error',
          timestamp: Date.now(),
        }
        this.state!.errors.push(loopError)
        this.emit('error', loopError)
      }
    }

    // Exhausted iterations without success
    // Update task metadata with failure info (keep status as in_progress)
    if (this.state!.taskListId && this.state!.taskIds) {
      const taskId = this.state!.taskIds[story.id]
      if (taskId) {
        try {
          await updateTask(this.state!.taskListId, taskId, {
            metadata: {
              failed: true,
              failedAt: new Date().toISOString(),
              iterations,
              error: `Failed after ${iterations} iterations`,
            },
          })
        } catch (error) {
          console.error('[Ralph Loop] Failed to update task metadata for failed story:', error)
          // Continue processing even if task update fails
        }
      }
    }

    return {
      storyId: story.id,
      result: 'failed',
      iterations,
      durationMs: Date.now() - startTime,
      error: `Failed after ${iterations} iterations`,
    }
  }

  /**
   * Run a single agent iteration for a story
   * Returns true if the agent completed successfully
   */
  private async runAgentIteration(story: Story, iteration: number): Promise<boolean> {
    const prompt = generateStoryPrompt(story)

    // Create abort controller for timeout
    this.currentAbortController = new AbortController()

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.currentAbortController?.abort()
    }, this.config.timeoutPerStoryMs)

    try {
      // Run the agent
      for await (const event of this.agent.chat(prompt)) {
        // Forward agent events
        this.emit('agent_event', event)

        // Check for cancellation
        if (this.isCancelled) {
          break
        }

        // Check for completion
        if (event.type === 'complete') {
          return true
        }

        // Check for errors
        if (event.type === 'error') {
          throw new Error(event.message || 'Agent error')
        }
      }

      return true
    } finally {
      clearTimeout(timeoutId)
      this.currentAbortController = null
    }
  }

  /**
   * Emit a progress event with current state
   */
  private emitProgress(): void {
    if (this.state) {
      this.emit('progress', { ...this.state })
    }
  }

  /**
   * Build the final loop result
   */
  private buildResult(): LoopResult {
    const state = this.state!
    const totalTimeMs = Date.now() - state.startTime

    return {
      loopId: state.id,
      status: state.status === 'completed' ? 'completed' : state.status === 'error' ? 'error' : 'cancelled',
      summary: {
        totalStories: state.prd.metadata.totalStories,
        completedStories: state.storiesCompleted,
        failedStories: state.storyResults.filter((r) => r.result === 'failed' || r.result === 'timeout').length,
        skippedStories: state.storyResults.filter((r) => r.result === 'skipped').length,
        totalTimeMs,
        commits: state.storyResults.filter((r) => r.commitSha).map((r) => r.commitSha!),
      },
      storyResults: state.storyResults,
      errors: state.errors,
    }
  }
}

/**
 * Create a RalphLoopRunner instance
 *
 * @param sessionId - Session ID for this loop
 * @param agent - VesperAgent instance to use for processing
 * @param workingDirectory - Git working directory
 * @param config - Loop configuration (optional, uses defaults)
 * @returns Configured RalphLoopRunner
 */
export function createLoopRunner(
  sessionId: string,
  agent: VesperAgent,
  workingDirectory: string,
  config?: Partial<LoopConfig>
): RalphLoopRunner {
  const gitOps = createGitOperations(workingDirectory)

  const fullConfig: LoopConfig = {
    maxIterationsPerStory: config?.maxIterationsPerStory ?? 5,
    timeoutPerStoryMs: config?.timeoutPerStoryMs ?? 600000,
    autoCommit: config?.autoCommit ?? true,
    commitMessagePrefix: config?.commitMessagePrefix ?? 'feat',
  }

  return new RalphLoopRunner(sessionId, agent, gitOps, fullConfig)
}
