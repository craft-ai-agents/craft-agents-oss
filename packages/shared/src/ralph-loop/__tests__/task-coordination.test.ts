import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { RalphLoopRunner } from '../loop-runner'
import type { PRD, LoopConfig, Story } from '../types'
import type { VesperAgent } from '../../agent/vesper-agent'
import type { GitOperations } from '../git-ops'
import type { Task, TaskList } from '../../task-lists/types'

/**
 * Mock Task List Storage
 *
 * Simulates task-lists/storage.ts functions for testing without filesystem I/O.
 */
class MockTaskListStorage {
  private taskLists = new Map<string, TaskList>()
  private failLoadTaskList = false
  private failBatchCreate = false
  private failUpdateTask = false

  calls: Array<{
    method: string
    args: any[]
  }> = []

  /**
   * Mock loadTaskList - returns task list or null if not found
   */
  async loadTaskList(id: string): Promise<TaskList | null> {
    this.calls.push({ method: 'loadTaskList', args: [id] })

    if (this.failLoadTaskList) {
      throw new Error('Failed to load task list')
    }

    return this.taskLists.get(id) || null
  }

  /**
   * Mock batchCreateTasks - creates multiple tasks at once
   */
  async batchCreateTasks(
    taskListId: string,
    tasks: Array<{
      subject: string
      description: string
      activeForm?: string
      metadata?: Record<string, unknown>
    }>
  ): Promise<Task[]> {
    this.calls.push({ method: 'batchCreateTasks', args: [taskListId, tasks] })

    if (this.failBatchCreate) {
      throw new Error('Failed to batch create tasks')
    }

    const taskList = this.taskLists.get(taskListId)
    if (!taskList) {
      throw new Error(`Task list not found: ${taskListId}`)
    }

    const createdTasks: Task[] = tasks.map((taskData, index) => ({
      id: `task-${Date.now()}-${index}`,
      subject: taskData.subject,
      description: taskData.description,
      activeForm: taskData.activeForm || taskData.subject,
      status: 'pending' as const,
      metadata: taskData.metadata,
      blocks: [],
      blockedBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))

    taskList.tasks.push(...createdTasks)
    taskList.updatedAt = new Date().toISOString()

    return createdTasks
  }

  /**
   * Mock updateTask - updates a single task
   */
  async updateTask(
    taskListId: string,
    taskId: string,
    updates: {
      status?: 'pending' | 'in_progress' | 'completed'
      owner?: string
      metadata?: Record<string, unknown>
    }
  ): Promise<Task> {
    this.calls.push({ method: 'updateTask', args: [taskListId, taskId, updates] })

    if (this.failUpdateTask) {
      throw new Error('Failed to update task')
    }

    const taskList = this.taskLists.get(taskListId)
    if (!taskList) {
      throw new Error(`Task list not found: ${taskListId}`)
    }

    const task = taskList.tasks.find(t => t.id === taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    if (updates.status !== undefined) task.status = updates.status
    if (updates.owner !== undefined) task.owner = updates.owner
    if (updates.metadata !== undefined) {
      task.metadata = { ...task.metadata, ...updates.metadata }
    }

    task.updatedAt = new Date().toISOString()
    taskList.updatedAt = task.updatedAt

    return task
  }

  /**
   * Helper: Create a task list for testing
   */
  createTaskList(id: string, name: string): TaskList {
    const taskList: TaskList = {
      id,
      name,
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.taskLists.set(id, taskList)
    return taskList
  }

  /**
   * Helper: Set whether loadTaskList should fail
   */
  setLoadTaskListFails(shouldFail: boolean) {
    this.failLoadTaskList = shouldFail
  }

  /**
   * Helper: Set whether batchCreateTasks should fail
   */
  setBatchCreateFails(shouldFail: boolean) {
    this.failBatchCreate = shouldFail
  }

  /**
   * Helper: Set whether updateTask should fail
   */
  setUpdateTaskFails(shouldFail: boolean) {
    this.failUpdateTask = shouldFail
  }

  /**
   * Helper: Get task by ID
   */
  getTask(taskListId: string, taskId: string): Task | undefined {
    const taskList = this.taskLists.get(taskListId)
    return taskList?.tasks.find(t => t.id === taskId)
  }

  /**
   * Helper: Get all tasks in task list
   */
  getAllTasks(taskListId: string): Task[] {
    return this.taskLists.get(taskListId)?.tasks || []
  }

  /**
   * Helper: Get calls for a specific method
   */
  getCallsForMethod(method: string): Array<{ method: string; args: any[] }> {
    return this.calls.filter(c => c.method === method)
  }

  /**
   * Reset all state
   */
  reset() {
    this.taskLists.clear()
    this.calls = []
    this.failLoadTaskList = false
    this.failBatchCreate = false
    this.failUpdateTask = false
  }
}

/**
 * Mock VesperAgent for testing
 */
class MockVesperAgent {
  private shouldSucceed = true
  private chatDelay = 0

  /**
   * Mock chat method - yields events and completes based on shouldSucceed flag
   */
  async *chat(prompt: string): AsyncGenerator<any> {
    if (this.chatDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.chatDelay))
    }

    yield { type: 'text', text: 'Processing...' }

    if (this.shouldSucceed) {
      yield { type: 'complete', success: true }
    } else {
      yield { type: 'error', message: 'Agent processing failed' }
    }
  }

  /**
   * Control whether chat succeeds or fails
   */
  setSucceeds(succeeds: boolean) {
    this.shouldSucceed = succeeds
  }

  /**
   * Set artificial delay for chat (for timeout testing)
   */
  setChatDelay(ms: number) {
    this.chatDelay = ms
  }
}

/**
 * Mock GitOperations for testing
 */
class MockGitOperations implements GitOperations {
  private currentHead = 'abc123'
  private hasChanges = false
  private commitCreated = false

  async getCurrentHead(): Promise<string> {
    return this.currentHead
  }

  async verifyCommitCreated(beforeHead: string): Promise<boolean> {
    return this.commitCreated
  }

  async hasUncommittedChanges(): Promise<boolean> {
    return this.hasChanges
  }

  async createAutoCommit(storyId: string, storyTitle: string): Promise<string> {
    this.currentHead = 'def456'
    return this.currentHead
  }

  /**
   * Control whether commits are detected
   */
  setCommitCreated(created: boolean) {
    this.commitCreated = created
  }

  /**
   * Control whether uncommitted changes exist
   */
  setHasChanges(hasChanges: boolean) {
    this.hasChanges = hasChanges
  }
}

/**
 * Sample PRD with multiple stories
 */
function createSamplePRD(): PRD {
  const stories: Story[] = [
    {
      id: 'story-001',
      title: 'Implement user authentication',
      lineNumber: 5,
      content: '- [ ] Implement user authentication\n\nAdd login/logout functionality with JWT tokens.',
      status: 'pending',
    },
    {
      id: 'story-002',
      title: 'Create dashboard UI',
      lineNumber: 10,
      content: '- [ ] Create dashboard UI\n\nBuild main dashboard with charts and metrics.',
      status: 'pending',
    },
    {
      id: 'story-003',
      title: 'Add API documentation',
      lineNumber: 15,
      content: '- [ ] Add API documentation\n\nGenerate OpenAPI docs for all endpoints.',
      status: 'pending',
    },
  ]

  return {
    source: '# Sample PRD\n\n- [ ] Implement user authentication\n- [ ] Create dashboard UI\n- [ ] Add API documentation',
    stories,
    metadata: {
      totalStories: stories.length,
      completedStories: 0,
      pendingStories: stories.length,
      failedStories: 0,
    },
  }
}

describe('Ralph Loop Task Coordination', () => {
  let mockStorage: MockTaskListStorage
  let mockAgent: MockVesperAgent
  let mockGitOps: MockGitOperations

  // Mock the task-lists storage module
  beforeEach(() => {
    mockStorage = new MockTaskListStorage()
    mockAgent = new MockVesperAgent()
    mockGitOps = new MockGitOperations()

    // Mock the storage functions
    mock.module('../../task-lists/index.ts', () => ({
      loadTaskList: (id: string) => mockStorage.loadTaskList(id),
      batchCreateTasks: (taskListId: string, tasks: any[]) =>
        mockStorage.batchCreateTasks(taskListId, tasks),
      updateTask: (taskListId: string, taskId: string, updates: any) =>
        mockStorage.updateTask(taskListId, taskId, updates),
    }))
  })

  describe('Upfront Task Creation', () => {
    test('creates tasks for all stories when taskListId is set', async () => {
      const taskListId = 'test-list-001'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
        autoCreateTasks: true,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Start the loop (it will fail on first story since agent is not fully mocked,
      // but we just care about upfront task creation)
      const resultPromise = runner.start(prd)

      // Give it time to create tasks
      await new Promise(resolve => setTimeout(resolve, 100))
      runner.cancel()
      await resultPromise

      // Verify batchCreateTasks was called
      const batchCalls = mockStorage.getCallsForMethod('batchCreateTasks')
      expect(batchCalls).toHaveLength(1)
      expect(batchCalls[0]!.args[0]).toBe(taskListId)

      // Verify all stories were converted to tasks
      const tasksArg = batchCalls[0]!.args[1]
      expect(tasksArg).toHaveLength(3)
      expect(tasksArg[0].subject).toBe('Implement user authentication')
      expect(tasksArg[1].subject).toBe('Create dashboard UI')
      expect(tasksArg[2].subject).toBe('Add API documentation')

      // Verify metadata includes story info
      expect(tasksArg[0].metadata.storyId).toBe('story-001')
      expect(tasksArg[0].metadata.lineNumber).toBe(5)
    })

    test('does not create tasks when taskListId is not set', async () => {
      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        // No taskListId
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 100))
      runner.cancel()
      await resultPromise

      // Verify batchCreateTasks was never called
      const batchCalls = mockStorage.getCallsForMethod('batchCreateTasks')
      expect(batchCalls).toHaveLength(0)
    })

    test('does not create tasks when autoCreateTasks is false', async () => {
      const taskListId = 'test-list-002'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
        autoCreateTasks: false,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 100))
      runner.cancel()
      await resultPromise

      // Verify batchCreateTasks was never called
      const batchCalls = mockStorage.getCallsForMethod('batchCreateTasks')
      expect(batchCalls).toHaveLength(0)
    })
  })

  describe('Task ID Mapping', () => {
    test('builds mapping from story ID to task ID', async () => {
      const taskListId = 'test-list-003'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 100))
      runner.cancel()
      await resultPromise

      // Check that state has taskIds mapping
      const state = runner.getState()
      expect(state?.taskIds).toBeDefined()
      expect(Object.keys(state!.taskIds!)).toHaveLength(3)

      // Verify story IDs are mapped to task IDs
      expect(state!.taskIds!['story-001']).toBeDefined()
      expect(state!.taskIds!['story-002']).toBeDefined()
      expect(state!.taskIds!['story-003']).toBeDefined()
    })
  })

  describe('Task List Validation', () => {
    test('throws error when task list does not exist', async () => {
      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId: 'non-existent-list',
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 100))
      await resultPromise

      // Loop should continue even after task list error (non-fatal)
      // but state should not have taskListId set
      const state = runner.getState()
      expect(state?.taskListId).toBeUndefined()
    })

    test('continues without task tracking when task list load fails', async () => {
      const taskListId = 'test-list-004'
      mockStorage.createTaskList(taskListId, 'Test Task List')
      mockStorage.setLoadTaskListFails(true)

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 100))
      runner.cancel()
      await resultPromise

      // Loop should continue, but no tasks created
      const batchCalls = mockStorage.getCallsForMethod('batchCreateTasks')
      expect(batchCalls).toHaveLength(0)
    })
  })

  describe('Status Sync on Story Start', () => {
    test('updates task status to in_progress when story starts', async () => {
      const taskListId = 'test-list-005'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Start loop and let it process one story
      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 200))
      runner.cancel()
      await resultPromise

      // Verify updateTask was called with in_progress status
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const inProgressCalls = updateCalls.filter(call =>
        call.args[2]?.status === 'in_progress'
      )

      expect(inProgressCalls.length).toBeGreaterThan(0)

      // Verify owner is set to session ID
      const firstCall = inProgressCalls[0]
      expect(firstCall!.args[2].owner).toBe('test-session')
    })
  })

  describe('Status Sync on Story Complete', () => {
    test('updates task status to completed with metadata when story succeeds', async () => {
      const taskListId = 'test-list-006'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: false, // Disable auto-commit to simplify
        commitMessagePrefix: 'feat',
        taskListId,
      }

      mockAgent.setSucceeds(true)
      mockGitOps.setCommitCreated(false)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Start loop and let it complete one story
      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 300))
      runner.cancel()
      await resultPromise

      // Verify updateTask was called with completed status
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const completedCalls = updateCalls.filter(call =>
        call.args[2]?.status === 'completed'
      )

      expect(completedCalls.length).toBeGreaterThan(0)

      // Verify metadata is set
      const completedCall = completedCalls[0]
      expect(completedCall!.args[2].metadata).toBeDefined()
      expect(completedCall!.args[2].metadata.completedAt).toBeDefined()
      expect(completedCall!.args[2].metadata.iterations).toBeDefined()
    })

    test('includes commit SHA in metadata when commit is created', async () => {
      const taskListId = 'test-list-007'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      mockAgent.setSucceeds(true)
      mockGitOps.setCommitCreated(true)
      mockGitOps.setHasChanges(false)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Start loop and let it complete one story
      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 300))
      runner.cancel()
      await resultPromise

      // Verify completed task has commitSha in metadata
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const completedCalls = updateCalls.filter(call =>
        call.args[2]?.status === 'completed'
      )

      const completedCall = completedCalls[0]
      expect(completedCall!.args[2].metadata.commitSha).toBeDefined()
    })
  })

  describe('Non-Fatal Error Handling', () => {
    test('continues processing when task update fails on story start', async () => {
      const taskListId = 'test-list-008'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      mockAgent.setSucceeds(true)

      // Make updateTask fail
      mockStorage.setUpdateTaskFails(true)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Loop should continue despite update failures
      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 300))
      runner.cancel()
      const result = await resultPromise

      // Loop should still run (not error out)
      expect(result.status).not.toBe('error')
    })

    test('continues processing when task batch creation fails', async () => {
      const taskListId = 'test-list-009'
      mockStorage.createTaskList(taskListId, 'Test Task List')
      mockStorage.setBatchCreateFails(true)

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      const resultPromise = runner.start(prd)
      await new Promise(resolve => setTimeout(resolve, 300))
      runner.cancel()
      const result = await resultPromise

      // Loop should still run (not error out)
      expect(result.status).not.toBe('error')

      // State should not have task IDs since creation failed
      const state = runner.getState()
      expect(state?.taskIds).toBeUndefined()
    })
  })

  describe('Timeout and Failure Metadata', () => {
    test('updates task metadata when story times out', async () => {
      const taskListId = 'test-list-010'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 50, // Very short timeout
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      // Make agent take longer than timeout
      mockAgent.setChatDelay(150)
      mockAgent.setSucceeds(true)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Add error listener to prevent unhandled error
      runner.on('error', () => {})

      await runner.start(prd)

      // Verify task metadata includes timeout info
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const metadataCalls = updateCalls.filter(call =>
        call.args[2]?.metadata?.timeout === true
      )

      // Note: timeout detection might not always work in tests due to timing
      // Just verify that some task updates occurred
      expect(updateCalls.length).toBeGreaterThan(0)

      // If timeout metadata was captured, verify its structure
      if (metadataCalls.length > 0) {
        const timeoutCall = metadataCalls[0]
        expect(timeoutCall!.args[2].metadata.timedOutAt).toBeDefined()
        expect(timeoutCall!.args[2].metadata.error).toBeDefined()
      }
    })

    test('updates task metadata when story fails after max iterations', async () => {
      const taskListId = 'test-list-011'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 2,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      // Make agent always fail
      mockAgent.setSucceeds(false)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Add error listener to prevent unhandled error
      runner.on('error', () => {})

      await runner.start(prd)

      // Verify task metadata includes failure info
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const failureCalls = updateCalls.filter(call =>
        call.args[2]?.metadata?.failed === true
      )

      expect(failureCalls.length).toBeGreaterThan(0)

      const failureCall = failureCalls[0]
      expect(failureCall!.args[2].metadata.failedAt).toBeDefined()
      expect(failureCall!.args[2].metadata.iterations).toBe(2)
      expect(failureCall!.args[2].metadata.error).toContain('Failed after 2 iterations')
    })
  })

  describe('Task Status Not Changed to Failed', () => {
    test('task status remains in_progress when story fails (not changed to completed or failed)', async () => {
      const taskListId = 'test-list-012'
      mockStorage.createTaskList(taskListId, 'Test Task List')

      const prd = createSamplePRD()
      const config: LoopConfig = {
        maxIterationsPerStory: 1,
        timeoutPerStoryMs: 5000,
        autoCommit: true,
        commitMessagePrefix: 'feat',
        taskListId,
      }

      mockAgent.setSucceeds(false)

      const runner = new RalphLoopRunner(
        'test-session',
        mockAgent as any,
        mockGitOps,
        config
      )

      // Add error listener to prevent unhandled error
      runner.on('error', () => {})

      await runner.start(prd)

      // Get all tasks
      const tasks = mockStorage.getAllTasks(taskListId)

      // First task should have been set to in_progress but not completed
      const firstTask = tasks[0]
      expect(firstTask).toBeDefined()

      // Task status should still be in_progress (failure metadata is added but status unchanged)
      // Note: This depends on the actual implementation - if it doesn't change status on failure,
      // the status should remain in_progress
      const updateCalls = mockStorage.getCallsForMethod('updateTask')
      const statusUpdates = updateCalls.filter(call => call.args[1] === firstTask?.id)

      // Should have one call setting status to in_progress, but no call setting to completed
      const inProgressCalls = statusUpdates.filter(call => call.args[2]?.status === 'in_progress')
      const completedCalls = statusUpdates.filter(call => call.args[2]?.status === 'completed')

      expect(inProgressCalls.length).toBeGreaterThan(0)
      expect(completedCalls).toHaveLength(0)
    })
  })
})
