import { describe, test, expect, beforeEach } from 'bun:test'
import { createOrchestrator, parsePRD } from '../src/orchestrate/index.ts'
import { decodeMeta } from '../src/orchestrate/meta-codec.ts'

describe('Orchestrator', () => {
  const samplePRD = `
# Test PRD

### [ ] US-001: First story
Description of first story

### [ ] US-002: Second story
Description of second story
`

  describe('createOrchestrator', () => {
    test('creates orchestrator with default config', () => {
      const orch = createOrchestrator('test-session')
      expect(orch).toBeDefined()
      expect(orch.getState()).toBeNull()
      expect(orch.isRunning()).toBe(false)
    })

    test('creates orchestrator with custom config', () => {
      const orch = createOrchestrator('test-session', {
        parallelism: 5,
        timeoutPerStoryMs: 300000,
      })
      expect(orch).toBeDefined()
    })
  })

  describe('prepare()', () => {
    test('parses PRD and creates dispatch tasks', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      const tasks = await orch.prepare(prd, 'test-list-id')

      expect(tasks).toHaveLength(2)
      expect(tasks[0].subject).toContain('US-001')
      expect(tasks[1].subject).toContain('US-002')
    })

    test('embeds metadata in task descriptions', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      const tasks = await orch.prepare(prd, 'test-list-id')

      const meta = decodeMeta(tasks[0].description)
      expect(meta).not.toBeNull()
      expect(meta?.storyId).toBe('US-001')
      expect(meta?.lineNumber).toBe(4)
    })

    test('sets state to running after prepare', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      await orch.prepare(prd, 'test-list-id')

      expect(orch.isRunning()).toBe(true)
      expect(orch.getState()?.status).toBe('running')
    })

    test('emits dispatch_ready event', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      let emittedTasks: any[] = []
      let emittedListId = ''

      orch.on('dispatch_ready', (tasks, listId) => {
        emittedTasks = tasks
        emittedListId = listId
      })

      await orch.prepare(prd, 'test-list-id')

      expect(emittedTasks).toHaveLength(2)
      expect(emittedListId).toBe('test-list-id')
    })
  })

  describe('lifecycle', () => {
    test('cancel() changes status to cancelled', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      await orch.prepare(prd, 'test-list-id')
      orch.cancel()

      expect(orch.getState()?.status).toBe('cancelled')
    })

    test('destroy() cleans up resources', async () => {
      const orch = createOrchestrator('test-session')
      const prd = parsePRD(samplePRD)

      await orch.prepare(prd, 'test-list-id')
      orch.destroy()

      expect(orch.getState()).toBeNull()
    })
  })
})
