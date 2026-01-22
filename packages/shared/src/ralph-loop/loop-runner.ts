/**
 * Ralph Loop Runner
 *
 * Orchestrates the execution of a Ralph Loop - processing user stories
 * from a PRD document sequentially, with iteration control and progress tracking.
 */

import { EventEmitter } from 'events'
import type { CraftAgent } from '../agent/craft-agent.ts'
import type { AgentEvent } from '@craft-agent/core/types'
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
  /** Agent events forwarded from CraftAgent during story processing */
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
    private agent: CraftAgent,
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
    this.state = {
      id: loopId,
      sessionId: this.sessionId,
      prd,
      config: this.config,
      currentStory: null,
      currentIteration: 0,
      status: 'running',
      startTime: Date.now(),
      storiesCompleted: 0,
      errors: [],
      storyResults: [],
    }

    this.isPaused = false
    this.isCancelled = false

    this.emitProgress()

    try {
      await this.runLoop()
    } catch (error) {
      const loopError: LoopError = {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: 'unknown',
        timestamp: Date.now(),
      }
      this.state.errors.push(loopError)
      this.state.status = 'error'
      this.emit('error', loopError)
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
 * @param agent - CraftAgent instance to use for processing
 * @param workingDirectory - Git working directory
 * @param config - Loop configuration (optional, uses defaults)
 * @returns Configured RalphLoopRunner
 */
export function createLoopRunner(
  sessionId: string,
  agent: CraftAgent,
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
