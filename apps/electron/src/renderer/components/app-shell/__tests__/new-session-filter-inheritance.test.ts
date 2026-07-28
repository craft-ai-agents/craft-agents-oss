import { describe, expect, it } from 'bun:test'
import {
  resolveInheritedNewSessionParams,
  type FilterMode,
} from '../new-session-filter-inheritance'

const filter = (...entries: Array<[string, FilterMode]>): Map<string, FilterMode> => new Map(entries)
const emptyFilter = (): Map<string, FilterMode> => filter()

describe('new session filter inheritance', () => {
  it('inherits a sole included status, label, or project', () => {
    expect(resolveInheritedNewSessionParams(
      filter(['in-progress', 'include']),
      emptyFilter(),
      emptyFilter(),
    )).toEqual({ status: 'in-progress' })

    expect(resolveInheritedNewSessionParams(
      emptyFilter(),
      filter(['urgent', 'include']),
      emptyFilter(),
    )).toEqual({ label: 'urgent' })

    expect(resolveInheritedNewSessionParams(
      emptyFilter(),
      emptyFilter(),
      filter(['project-1', 'include']),
    )).toEqual({ project: 'project-1' })
  })

  it('does not inherit an excluded status, label, or project', () => {
    expect(resolveInheritedNewSessionParams(
      filter(['done', 'exclude']),
      emptyFilter(),
      emptyFilter(),
    )).toBeNull()

    expect(resolveInheritedNewSessionParams(
      emptyFilter(),
      filter(['blocked', 'exclude']),
      emptyFilter(),
    )).toBeNull()

    expect(resolveInheritedNewSessionParams(
      emptyFilter(),
      emptyFilter(),
      filter(['project-1', 'exclude']),
    )).toBeNull()
  })

  it('ignores excluded filters when resolving a sole included filter', () => {
    expect(resolveInheritedNewSessionParams(
      filter(['done', 'exclude']),
      filter(['urgent', 'include'], ['blocked', 'exclude']),
      filter(['project-1', 'exclude']),
    )).toEqual({ label: 'urgent' })
  })

  it('falls back to defaults when there are no included filters', () => {
    expect(resolveInheritedNewSessionParams(
      emptyFilter(),
      emptyFilter(),
      emptyFilter(),
    )).toBeNull()
  })

  it('falls back to defaults when multiple included filters are active', () => {
    expect(resolveInheritedNewSessionParams(
      filter(['todo', 'include'], ['in-progress', 'include']),
      emptyFilter(),
      emptyFilter(),
    )).toBeNull()

    expect(resolveInheritedNewSessionParams(
      filter(['todo', 'include']),
      filter(['urgent', 'include']),
      emptyFilter(),
    )).toBeNull()
  })
})
