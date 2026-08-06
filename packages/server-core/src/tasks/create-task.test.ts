import { describe, expect, it } from 'bun:test'
import { resolveCreateTaskProjectId } from './create-task'

describe('resolveCreateTaskProjectId', () => {
  it('inherits the invoking session project when no override is supplied', () => {
    expect(resolveCreateTaskProjectId(undefined, 'project-current')).toBe('project-current')
  })

  it('prefers an explicit project over the invoking session project', () => {
    expect(resolveCreateTaskProjectId('project-explicit', 'project-current')).toBe('project-explicit')
  })

  it('leaves tasks unbound when neither side has a project', () => {
    expect(resolveCreateTaskProjectId(undefined, undefined)).toBeUndefined()
  })
})
