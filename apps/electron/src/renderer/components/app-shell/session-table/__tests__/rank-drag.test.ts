import { describe, expect, it } from 'bun:test'
import { crossGroupDropAction } from '../table-drag'

describe('table rank drag group moves', () => {
  it('allows only writable status, priority, and project group moves', () => {
    expect(crossGroupDropAction('status', 'status:todo')).not.toBeNull()
    expect(crossGroupDropAction('priority', 'priority:urgent')).not.toBeNull()
    expect(crossGroupDropAction('project', 'project:project-1')).not.toBeNull()
    expect(crossGroupDropAction('label', 'label:urgent')).toBeNull()
    expect(crossGroupDropAction('dueDate', 'due:today')).toBeNull()
    expect(crossGroupDropAction('none', '__all__')).toBeNull()
  })

  it('maps a target bucket to exactly one writable session command', () => {
    expect(crossGroupDropAction('status', 'status:in-progress')).toEqual({
      metadataPatch: { sessionStatus: 'in-progress' },
      command: { type: 'setSessionStatus', state: 'in-progress' },
    })
    expect(crossGroupDropAction('priority', 'priority:urgent')).toEqual({
      metadataPatch: { priority: 'urgent' },
      command: { type: 'setPriority', priority: 'urgent' },
    })
    expect(crossGroupDropAction('project', 'project:project-1')).toEqual({
      metadataPatch: { projectId: 'project-1' },
      command: { type: 'setProjectId', projectId: 'project-1' },
    })
    expect(crossGroupDropAction('project', 'project:')).toEqual({
      metadataPatch: { projectId: undefined },
      command: { type: 'setProjectId', projectId: null },
    })
  })

  it('rejects label, due-date, and malformed target buckets', () => {
    expect(crossGroupDropAction('label', 'label:urgent')).toBeNull()
    expect(crossGroupDropAction('dueDate', 'due:today')).toBeNull()
    expect(crossGroupDropAction('status', 'priority:urgent')).toBeNull()
  })
})
