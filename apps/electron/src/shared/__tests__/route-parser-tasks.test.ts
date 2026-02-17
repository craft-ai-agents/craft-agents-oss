import { describe, it, expect } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute } from '../route-parser'

describe('route-parser: tasks routes', () => {
  it('parses "tasks" as tasks navigator with no filter or details', () => {
    const result = parseCompoundRoute('tasks')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.details).toBeNull()
    expect(result!.taskFilter).toBeUndefined()
  })

  it('parses "tasks/scheduled" as tasks with scheduled filter', () => {
    const result = parseCompoundRoute('tasks/scheduled')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.taskFilter).toEqual({ kind: 'type', taskType: 'scheduled' })
    expect(result!.details).toBeNull()
  })

  it('parses "tasks/event" as tasks with event filter', () => {
    const result = parseCompoundRoute('tasks/event')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.taskFilter).toEqual({ kind: 'type', taskType: 'event' })
    expect(result!.details).toBeNull()
  })

  it('parses "tasks/agentic" as tasks with agentic filter', () => {
    const result = parseCompoundRoute('tasks/agentic')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.taskFilter).toEqual({ kind: 'type', taskType: 'agentic' })
    expect(result!.details).toBeNull()
  })

  it('parses "tasks/scheduled/task/hook-1" as filtered + details', () => {
    const result = parseCompoundRoute('tasks/scheduled/task/hook-1')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.taskFilter).toEqual({ kind: 'type', taskType: 'scheduled' })
    expect(result!.details).toEqual({ type: 'task', id: 'hook-1' })
  })

  it('parses "tasks/task/hook-1" as unfiltered + details', () => {
    const result = parseCompoundRoute('tasks/task/hook-1')
    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('tasks')
    expect(result!.taskFilter).toBeUndefined()
    expect(result!.details).toEqual({ type: 'task', id: 'hook-1' })
  })

  it('roundtrips tasks (no filter, no details)', () => {
    const parsed = parseCompoundRoute('tasks')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('tasks')
  })

  it('roundtrips tasks with scheduled filter', () => {
    const parsed = parseCompoundRoute('tasks/scheduled')!
    // buildCompoundRoute only outputs the details suffix when details are present
    // For filter-only, it returns just the base
    expect(parsed.navigator).toBe('tasks')
    expect(parsed.taskFilter?.taskType).toBe('scheduled')
  })

  it('roundtrips tasks/scheduled/task/hook-1', () => {
    const parsed = parseCompoundRoute('tasks/scheduled/task/hook-1')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('tasks/scheduled/task/hook-1')
  })

  it('roundtrips tasks/task/hook-1', () => {
    const parsed = parseCompoundRoute('tasks/task/hook-1')!
    const built = buildCompoundRoute(parsed)
    expect(built).toBe('tasks/task/hook-1')
  })
})
