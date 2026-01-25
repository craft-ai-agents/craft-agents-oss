/**
 * Tests for Ralph Loop Runner
 *
 * These tests verify the RalphLoopRunner functionality including:
 * - Event emission
 * - State management
 * - Cleanup and destroy behavior
 * - Pause/resume/cancel operations
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { RalphLoopRunner } from '../src/ralph-loop/loop-runner.ts'
import type { PRD, LoopConfig, Story } from '../src/ralph-loop/types.ts'
import type { GitOperations } from '../src/ralph-loop/git-ops.ts'
import type { VesperAgent } from '../agent/vesper-agent.ts'

// ============================================================
// Mock Factories
// ============================================================

function createMockPRD(stories: Partial<Story>[] = []): PRD {
  const defaultStories: Story[] = stories.length
    ? (stories.map((s, i) => ({
        id: s.id || `US-${String(i + 1).padStart(3, '0')}`,
        title: s.title || `Story ${i + 1}`,
        lineNumber: s.lineNumber || i + 1,
        content: s.content || 'Story content',
        status: s.status || 'pending',
      })) as Story[])
    : [
        {
          id: 'US-001',
          title: 'Test Story 1',
          lineNumber: 1,
          content: 'First story content',
          status: 'pending',
        },
        {
          id: 'US-002',
          title: 'Test Story 2',
          lineNumber: 5,
          content: 'Second story content',
          status: 'pending',
        },
      ]

  return {
    source: '# Test PRD',
    stories: defaultStories,
    metadata: {
      totalStories: defaultStories.length,
      completedStories: defaultStories.filter((s) => s.status === 'completed').length,
      pendingStories: defaultStories.filter((s) => s.status === 'pending').length,
      failedStories: defaultStories.filter((s) => s.status === 'failed').length,
    },
  }
}

function createMockConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    maxIterationsPerStory: overrides.maxIterationsPerStory ?? 3,
    timeoutPerStoryMs: overrides.timeoutPerStoryMs ?? 5000,
    autoCommit: overrides.autoCommit ?? true,
    commitMessagePrefix: overrides.commitMessagePrefix ?? 'feat',
  }
}

function createMockGitOps(): GitOperations {
  let currentHead = 'abc123def456'

  return {
    getCurrentHead: mock(async () => currentHead),
    hasUncommittedChanges: mock(async () => false),
    getChangesSummary: mock(async () => ({
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      changedFiles: [],
    })),
    createAutoCommit: mock(async (storyId: string, _title: string) => {
      currentHead = `commit-${storyId}-${Date.now()}`
      return currentHead
    }),
    verifyCommitCreated: mock(async () => true),
    getLastCommitMessage: mock(async () => 'Test commit'),
    isGitRepository: mock(async () => true),
  }
}

function createMockAgent(): VesperAgent {
  // Create a simple async generator for chat
  async function* mockChat(_prompt: string) {
    yield { type: 'complete' as const }
  }

  return {
    chat: mock(mockChat),
    dispose: mock(() => {}),
  } as unknown as VesperAgent
}

// ============================================================
// RalphLoopRunner - Basic Tests
// ============================================================

describe('RalphLoopRunner - Basic', () => {
  let runner: RalphLoopRunner
  let mockAgent: VesperAgent
  let mockGitOps: GitOperations
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockAgent = createMockAgent()
    mockGitOps = createMockGitOps()
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)
  })

  it('should initialize with null state', () => {
    expect(runner.getState()).toBeNull()
    expect(runner.isRunning()).toBe(false)
  })

  it('should throw when starting while already running', async () => {
    const prd = createMockPRD()

    // Start the loop
    const startPromise = runner.start(prd)

    // Try to start again while running
    await expect(runner.start(prd)).rejects.toThrow('Loop is already running')

    // Cancel to cleanup
    runner.cancel()
    await startPromise
  })
})

// ============================================================
// RalphLoopRunner - Event Emission Tests
// ============================================================

describe('RalphLoopRunner - Events', () => {
  let runner: RalphLoopRunner
  let mockAgent: VesperAgent
  let mockGitOps: GitOperations
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockAgent = createMockAgent()
    mockGitOps = createMockGitOps()
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)
  })

  it('should emit progress events', async () => {
    const prd = createMockPRD([{ id: 'US-001', title: 'Single story', status: 'pending' }])
    const progressEvents: unknown[] = []

    runner.on('progress', (state) => {
      progressEvents.push(state)
    })

    await runner.start(prd)

    expect(progressEvents.length).toBeGreaterThan(0)
  })

  it('should emit story_start events', async () => {
    const prd = createMockPRD([{ id: 'US-001', title: 'Test story', status: 'pending' }])
    const storyStartEvents: Story[] = []

    runner.on('story_start', (story) => {
      storyStartEvents.push(story)
    })

    await runner.start(prd)

    expect(storyStartEvents.length).toBe(1)
    expect(storyStartEvents[0]!.id).toBe('US-001')
  })

  it('should emit story_complete events', async () => {
    const prd = createMockPRD([{ id: 'US-001', title: 'Test story', status: 'pending' }])
    const completedStories: { story: Story; result: unknown }[] = []

    runner.on('story_complete', (story, result) => {
      completedStories.push({ story, result })
    })

    await runner.start(prd)

    expect(completedStories.length).toBe(1)
    expect(completedStories[0]!.story.id).toBe('US-001')
  })

  it('should emit complete event when finished', async () => {
    const prd = createMockPRD([{ id: 'US-001', title: 'Test story', status: 'pending' }])
    let completeResult: unknown = null

    runner.on('complete', (result) => {
      completeResult = result
    })

    await runner.start(prd)

    expect(completeResult).not.toBeNull()
  })
})

// ============================================================
// RalphLoopRunner - Pause/Resume/Cancel Tests
// ============================================================

describe('RalphLoopRunner - Control Flow', () => {
  let runner: RalphLoopRunner
  let mockAgent: VesperAgent
  let mockGitOps: GitOperations
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockAgent = createMockAgent()
    mockGitOps = createMockGitOps()
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)
  })

  it('should handle cancel correctly', async () => {
    const prd = createMockPRD([
      { id: 'US-001', status: 'pending' },
      { id: 'US-002', status: 'pending' },
    ])

    const startPromise = runner.start(prd)

    // Cancel immediately
    runner.cancel()

    const result = await startPromise

    expect(result.status).toBe('cancelled')
  })

  it('should update state status on cancel', () => {
    const prd = createMockPRD()
    runner.start(prd)

    runner.cancel()

    const state = runner.getState()
    expect(state?.status).toBe('cancelled')
  })
})

// ============================================================
// RalphLoopRunner - Cleanup and Destroy Tests
// ============================================================

describe('RalphLoopRunner - Cleanup', () => {
  let runner: RalphLoopRunner
  let mockAgent: VesperAgent
  let mockGitOps: GitOperations
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockAgent = createMockAgent()
    mockGitOps = createMockGitOps()
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)
  })

  it('should remove all event listeners on destroy', () => {
    // Register multiple listeners
    runner.on('progress', () => {})
    runner.on('story_complete', () => {})
    runner.on('error', () => {})
    runner.on('complete', () => {})
    runner.on('paused', () => {})

    // Verify listeners are registered
    expect(runner.listenerCount('progress')).toBe(1)
    expect(runner.listenerCount('story_complete')).toBe(1)
    expect(runner.listenerCount('error')).toBe(1)
    expect(runner.eventNames().length).toBeGreaterThan(0)

    // Destroy
    runner.destroy()

    // Verify all listeners removed
    expect(runner.listenerCount('progress')).toBe(0)
    expect(runner.listenerCount('story_complete')).toBe(0)
    expect(runner.listenerCount('error')).toBe(0)
    expect(runner.eventNames().length).toBe(0)
  })

  it('should clear state on destroy', async () => {
    const prd = createMockPRD([{ id: 'US-001', status: 'pending' }])

    // Start the loop (don't await, just let it begin)
    const startPromise = runner.start(prd)

    // Wait a tick for state to be set
    await new Promise((r) => setTimeout(r, 5))

    // State should be set
    expect(runner.getState()).not.toBeNull()

    // Destroy
    runner.destroy()

    // State should be null
    expect(runner.getState()).toBeNull()

    // Wait for start to complete
    await startPromise
  })

  it('should set isCancelled flag on destroy', () => {
    runner.destroy()

    // Subsequent operations should be cancelled
    expect(runner.isRunning()).toBe(false)
  })

  it('should handle destroy when not running', () => {
    // Should not throw when destroying without starting
    expect(() => runner.destroy()).not.toThrow()
  })

  it('should handle multiple destroy calls', () => {
    // First destroy
    runner.destroy()

    // Second destroy should not throw
    expect(() => runner.destroy()).not.toThrow()
  })

  it('should prevent new events after destroy', async () => {
    const events: string[] = []

    runner.on('progress', () => events.push('progress'))
    runner.on('complete', () => events.push('complete'))

    // Destroy before starting
    runner.destroy()

    // Emit should not trigger listeners
    runner.emit('progress', {})
    runner.emit('complete', {})

    expect(events.length).toBe(0)
  })

  it('should handle destroy during loop execution', async () => {
    // Create a slow agent that takes time to process
    let resolveChat: (() => void) | null = null
    const slowAgent = {
      chat: mock(async function* (_prompt: string) {
        // Wait for external signal
        await new Promise<void>((resolve) => {
          resolveChat = resolve
        })
        yield { type: 'complete' as const }
      }),
      dispose: mock(() => {}),
    } as unknown as VesperAgent

    const slowRunner = new RalphLoopRunner('test-session', slowAgent, mockGitOps, mockConfig)

    const prd = createMockPRD([{ id: 'US-001', status: 'pending' }])

    // Start the loop (don't await)
    const startPromise = slowRunner.start(prd)

    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 10))

    // Destroy while running
    slowRunner.destroy()

    // Resolve the chat to let it finish
    if (resolveChat) resolveChat()

    // Should complete (cancelled state)
    const result = await startPromise
    expect(result.status).toBe('cancelled')
  })
})

// ============================================================
// RalphLoopRunner - Memory Leak Prevention Tests
// ============================================================

describe('RalphLoopRunner - Memory Management', () => {
  it('should not accumulate listeners across multiple runs', async () => {
    const mockAgent = createMockAgent()
    const mockGitOps = createMockGitOps()
    const mockConfig = createMockConfig()

    const runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)

    // Register a listener
    runner.on('progress', () => {})

    expect(runner.listenerCount('progress')).toBe(1)

    // Destroy and verify cleanup
    runner.destroy()
    expect(runner.listenerCount('progress')).toBe(0)

    // Register again (simulating reuse scenario - though not recommended)
    runner.on('progress', () => {})
    expect(runner.listenerCount('progress')).toBe(1)

    runner.destroy()
    expect(runner.listenerCount('progress')).toBe(0)
  })

  it('should release PRD reference on destroy', async () => {
    const mockAgent = createMockAgent()
    const mockGitOps = createMockGitOps()
    const mockConfig = createMockConfig()

    const runner = new RalphLoopRunner('test-session', mockAgent, mockGitOps, mockConfig)

    // Create a PRD with single story for faster test
    const prd = createMockPRD([
      {
        id: 'US-001',
        title: 'Story 1',
        content: 'x'.repeat(1000),
        status: 'pending' as const,
      },
    ])

    // Start (will initialize state with PRD reference)
    const startPromise = runner.start(prd)

    // Wait a tick for state to be set
    await new Promise((r) => setTimeout(r, 5))

    // State should hold PRD reference
    expect(runner.getState()?.prd).toBeDefined()

    // Destroy should clear reference
    runner.destroy()
    expect(runner.getState()).toBeNull()

    // Wait for start to complete
    await startPromise
  })
})

// ============================================================
// RalphLoopRunner - Error Handling Tests
// ============================================================

describe('RalphLoopRunner - Error Handling', () => {
  it('should emit error events for agent errors', async () => {
    const errorAgent = {
      chat: mock(async function* (_prompt: string) {
        yield { type: 'error' as const, message: 'Agent error' }
      }),
      dispose: mock(() => {}),
    } as unknown as VesperAgent

    const mockGitOps = createMockGitOps()
    const mockConfig = createMockConfig({ maxIterationsPerStory: 1 })

    const runner = new RalphLoopRunner('test-session', errorAgent, mockGitOps, mockConfig)

    const errors: unknown[] = []
    runner.on('error', (error) => errors.push(error))

    const prd = createMockPRD([{ id: 'US-001', status: 'pending' }])
    await runner.start(prd)

    expect(errors.length).toBeGreaterThan(0)
  })

  it('should continue to next story after max iterations', async () => {
    // Agent that always throws errors
    const failingAgent = {
      chat: mock(async function* (_prompt: string) {
        yield { type: 'error' as const, message: 'Agent failed' }
      }),
      dispose: mock(() => {}),
    } as unknown as VesperAgent

    const mockGitOps = createMockGitOps()
    // Set low max iterations to speed up test
    const mockConfig = createMockConfig({ maxIterationsPerStory: 1 })

    const runner = new RalphLoopRunner('test-session', failingAgent, mockGitOps, mockConfig)

    // Add error listener to prevent unhandled error
    const errors: unknown[] = []
    runner.on('error', (error) => errors.push(error))

    const prd = createMockPRD([
      { id: 'US-001', status: 'pending' },
      { id: 'US-002', status: 'pending' },
    ])

    const result = await runner.start(prd)

    // Both stories should have been attempted and failed
    expect(result.storyResults.length).toBe(2)
    // Both should be marked as failed (exhausted iterations due to errors)
    expect(result.storyResults.every((r) => r.result === 'failed')).toBe(true)
    // Errors should have been emitted
    expect(errors.length).toBeGreaterThan(0)
  })
})
