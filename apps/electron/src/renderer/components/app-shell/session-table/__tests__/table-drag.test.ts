import { describe, expect, it } from 'bun:test'
import { crossGroupDropAction } from '../table-drag'

describe('crossGroupDropAction', () => {
  it('maps status, priority, and project buckets to their writable command', () => {
    expect(crossGroupDropAction('status', 'status:done')).toEqual({
      metadataPatch: { sessionStatus: 'done' },
      command: { type: 'setSessionStatus', state: 'done' },
    })
    expect(crossGroupDropAction('priority', 'priority:high')).toEqual({
      metadataPatch: { priority: 'high' },
      command: { type: 'setPriority', priority: 'high' },
    })
    expect(crossGroupDropAction('project', 'project:project-1')).toEqual({
      metadataPatch: { projectId: 'project-1' },
      command: { type: 'setProjectId', projectId: 'project-1' },
    })
  })

  it('maps the no-project bucket to a null project command', () => {
    expect(crossGroupDropAction('project', 'project:')).toEqual({
      metadataPatch: { projectId: undefined },
      command: { type: 'setProjectId', projectId: null },
    })
  })

  it('does not invent writes for label, derived due-date, or ungrouped buckets', () => {
    expect(crossGroupDropAction('label', 'label:urgent')).toBeNull()
    expect(crossGroupDropAction('dueDate', 'due:today')).toBeNull()
    expect(crossGroupDropAction('none', '__all__')).toBeNull()
  })
})
