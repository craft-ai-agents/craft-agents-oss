import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import { DeepResearchRunner, type DeepResearchRunnerEvent } from './DeepResearchRunner.ts'

let workspaceRoot = ''

afterEach(() => {
  if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = ''
})

async function waitFor(pred: () => boolean, maxMs = 2000): Promise<void> {
  const start = Date.now()
  while (!pred() && Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  if (!pred()) throw new Error(`waitFor timed out after ${maxMs}ms`)
}

describe('DeepResearchRunner', () => {
  test('auto mode uses safe permissions, accepts native web tools, and deletes hidden step sessions', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'deep-research-runner-'))
    const created: Array<{ id: string; options: CreateSessionOptions }> = []
    const deleted: string[] = []
    const outputs = new Map<string, string>()
    const events: DeepResearchRunnerEvent[] = []

    const runner = new DeepResearchRunner({
      createSession: async (_workspaceId, options) => {
        const id = `dr-sess-${created.length + 1}`
        created.push({ id, options })
        outputs.set(id, `output ${created.length}`)
        return { id }
      },
      sendMessage: async () => {},
      getLastAssistantText: (sessionId) => outputs.get(sessionId) ?? '',
      getSessionToolUseSummary: () => ({ count: 1, names: ['web_search'] }),
      abortSession: async () => {},
      deleteSession: async (sessionId) => {
        deleted.push(sessionId)
      },
      getWorkspaceRootPath: () => workspaceRoot,
      resolveSourceReadiness: () => ({ requested: ['exa'], usable: ['exa'], missing: [], unusable: [] }),
      resolveSourceProfiles: () => [{
        slug: 'exa',
        name: 'Exa',
        provider: 'exa',
        type: 'api',
        capabilities: ['search'],
      }],
      emit: (event) => events.push(event),
    })

    const started = runner.start('workspace-1', {
      topic: 'native web search',
      sourceSlugs: ['exa'],
      planPolicy: 'auto',
      depth: 'quick',
    })

    await waitFor(() => events.some((event) => event.type === 'run.completed'))
    const completedEvent = [...events].reverse().find((event) => event.type === 'run.completed')
    if (completedEvent?.type !== 'run.completed') {
      throw new Error('Expected deep research run to complete')
    }
    const completed = completedEvent.run

    expect(started.state).toBe('running')
    expect(completed.state).toBe('succeeded')
    expect(created.map((item) => item.options.permissionMode)).toEqual(['safe', 'safe', 'safe'])
    expect(deleted).toEqual(['dr-sess-1', 'dr-sess-2', 'dr-sess-3'])
  })
})
