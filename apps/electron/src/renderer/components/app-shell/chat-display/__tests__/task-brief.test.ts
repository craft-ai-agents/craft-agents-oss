import { describe, expect, it } from 'bun:test'
import { taskBriefFromSpec } from '../task-brief'

describe('taskBriefFromSpec', () => {
  it('drops the single subtask create_task builds from the task itself', () => {
    // SessionManager createTaskFn: goal = description, one `main` node with the task's title
    const spec = {
      id: 'gitignore-the-workspace',
      title: 'Gitignore the workspace',
      goal: 'Add the Craft workspace and /reference to .gitignore.',
      acceptance_criteria: '`git status` is clean afterwards.',
      nodes: [{ id: 'main', title: 'Gitignore the workspace', prompt: 'Add the Craft workspace and /reference to .gitignore.' }],
    }
    expect(taskBriefFromSpec(spec)).toEqual({
      goal: 'Add the Craft workspace and /reference to .gitignore.',
      acceptanceCriteria: '`git status` is clean afterwards.',
      subtasks: [],
    })
  })

  it('lists every subtask of a multi-step task, falling back to the node id', () => {
    const spec = {
      title: 'Ship the release',
      goal: 'Release 1.2',
      nodes: [
        { id: 'notes', title: 'Write release notes', prompt: 'Write them' },
        { id: 'tag', prompt: 'Tag the release', depends_on: ['notes'] },
      ],
    }
    expect(taskBriefFromSpec(spec)?.subtasks).toEqual(['Write release notes', 'tag'])
  })

  it('keeps a lone subtask that differs from the task', () => {
    const spec = { title: 'Audit', goal: 'Audit the auth flow', nodes: [{ id: 'scan', title: 'Scan the handlers', prompt: 'Read every handler' }] }
    expect(taskBriefFromSpec(spec)?.subtasks).toEqual(['Scan the handlers'])
  })

  it('drops a lone subtask whose prompt is the goal, whatever its title', () => {
    const spec = { title: 'Audit', goal: 'Audit the auth flow', nodes: [{ id: 'main', title: 'Do it', prompt: '  Audit the auth flow\n' }] }
    expect(taskBriefFromSpec(spec)?.subtasks).toEqual([])
  })

  it('trims text and omits empty acceptance criteria', () => {
    const brief = taskBriefFromSpec({ goal: '  Do the thing \n', acceptance_criteria: '   ', nodes: [] })
    expect(brief).toEqual({ goal: 'Do the thing', subtasks: [] })
  })

  it('returns null without a goal to show', () => {
    expect(taskBriefFromSpec(undefined)).toBeNull()
    expect(taskBriefFromSpec('goal')).toBeNull()
    expect(taskBriefFromSpec({ title: 'No goal', nodes: [] })).toBeNull()
    expect(taskBriefFromSpec({ goal: '   ' })).toBeNull()
  })

  it('skips malformed nodes', () => {
    const spec = { title: 'T', goal: 'G', nodes: [null, 'x', { title: 'no id' }, { id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }
    expect(taskBriefFromSpec(spec)?.subtasks).toEqual(['A', 'B'])
  })
})
