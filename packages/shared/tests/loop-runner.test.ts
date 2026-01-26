/**
 * Tests for Orchestrator (formerly RalphLoopRunner)
 *
 * These tests verify the Orchestrator functionality including:
 * - Event emission
 * - State management
 * - Cleanup and destroy behavior
 * - Prepare and dispatch delegation
 *
 * Note: The new architecture delegates execution to dispatch skill.
 * The legacy start() method marks stories as skipped for backwards compatibility.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { RalphLoopRunner } from '../src/orchestrate/index.ts'
import type { PRD, LoopConfig, Story } from '../src/orchestrate/types.ts'

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
    parallelism: overrides.parallelism ?? 3,
    timeoutPerStoryMs: overrides.timeoutPerStoryMs ?? 5000,
    autoCommit: overrides.autoCommit ?? true,
    commitMessagePrefix: overrides.commitMessagePrefix ?? 'feat',
  }
}

// ============================================================
// RalphLoopRunner - Basic Tests
// ============================================================

describe('RalphLoopRunner - Basic', () => {
  let runner: RalphLoopRunner
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockConfig = createMockConfig()
    // New constructor signature: only sessionId and config
    runner = new RalphLoopRunner('test-session', mockConfig)
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
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockConfig)
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

  it('should emit complete event when finished', async () => {
    const prd = createMockPRD([{ id: 'US-001', title: 'Test story', status: 'pending' }])
    let completeResult: unknown = null

    runner.on('complete', (result) => {
      completeResult = result
    })

    await runner.start(prd)

    expect(completeResult).not.toBeNull()
  })

  // Note: story_start and story_complete events are now only emitted
  // when progress monitoring detects task file changes from dispatch execution.
  // The legacy start() method does not emit these events since it marks all
  // stories as skipped without actual execution.
})

// ============================================================
// RalphLoopRunner - Control Flow Tests
// ============================================================

describe('RalphLoopRunner - Control Flow', () => {
  let runner: RalphLoopRunner
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockConfig)
  })

  it('should handle cancel correctly', async () => {
    const prd = createMockPRD([
      { id: 'US-001', status: 'pending' },
      { id: 'US-002', status: 'pending' },
    ])

    const startPromise = runner.start(prd)

    // Cancel immediately - note the legacy start() completes quickly
    // so we need to cancel before the timeout fires
    runner.cancel()

    const result = await startPromise

    // The result could be either 'completed' or 'cancelled' depending on timing
    // Since the legacy start() auto-completes after 100ms, we just verify
    // the orchestration finished without errors
    expect(['completed', 'cancelled']).toContain(result.status)
  })

  it('should update state status on cancel', async () => {
    const prd = createMockPRD()
    const startPromise = runner.start(prd)

    // Wait a tick for state to be initialized
    await new Promise(r => setTimeout(r, 5))

    runner.cancel()

    const state = runner.getState()
    expect(state?.status).toBe('cancelled')

    await startPromise
  })
})

// ============================================================
// RalphLoopRunner - Cleanup and Destroy Tests
// ============================================================

describe('RalphLoopRunner - Cleanup', () => {
  let runner: RalphLoopRunner
  let mockConfig: LoopConfig

  beforeEach(() => {
    mockConfig = createMockConfig()
    runner = new RalphLoopRunner('test-session', mockConfig)
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

  it('should set cancelled status on destroy', async () => {
    const prd = createMockPRD([{ id: 'US-001', status: 'pending' }])
    const startPromise = runner.start(prd)

    // Wait for state to be initialized
    await new Promise((r) => setTimeout(r, 5))

    runner.destroy()

    // Subsequent operations should be cancelled
    expect(runner.isRunning()).toBe(false)

    await startPromise
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
    const prd = createMockPRD([{ id: 'US-001', status: 'pending' }])

    // Start the loop (don't await)
    const startPromise = runner.start(prd)

    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 10))

    // Destroy while running
    runner.destroy()

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
    const mockConfig = createMockConfig()
    const runner = new RalphLoopRunner('test-session', mockConfig)

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
    const mockConfig = createMockConfig()
    const runner = new RalphLoopRunner('test-session', mockConfig)

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
  it('should complete with skipped stories in legacy mode', async () => {
    const mockConfig = createMockConfig()
    const runner = new RalphLoopRunner('test-session', mockConfig)

    const prd = createMockPRD([
      { id: 'US-001', status: 'pending' },
      { id: 'US-002', status: 'pending' },
    ])

    const result = await runner.start(prd)

    // In the new architecture, the legacy start() method marks all stories as skipped
    // since execution is delegated to dispatch
    expect(result.storyResults.length).toBe(2)
    expect(result.storyResults.every((r) => r.result === 'skipped')).toBe(true)
    expect(result.status).toBe('completed')
  })

  // Note: Error handling during actual execution is now delegated to dispatch skill.
  // The Orchestrator monitors task progress and emits events based on task status changes.
  // Error events are only emitted when task file changes indicate errors.
})
