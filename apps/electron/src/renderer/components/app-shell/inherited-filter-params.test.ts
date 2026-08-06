import { describe, it, expect } from 'bun:test'
import { resolveInheritedFilterParams, type FilterMode } from './inherited-filter-params'

const m = (...entries: [string, FilterMode][]) => new Map(entries)

describe('resolveInheritedFilterParams (#970)', () => {
  it('inherits a sole include-mode status', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include']), m(), m())).toEqual({ status: 'todo' })
  })

  it('does NOT inherit an excluded status (the bug)', () => {
    // With only `Done → exclude`, a new session must fall back to the workspace
    // default, not be created as Done.
    expect(resolveInheritedFilterParams(m(['done', 'exclude']), m(), m())).toBeNull()
  })

  it('counts only includes — a single include alongside an exclude still inherits the include', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include'], ['done', 'exclude']), m(), m())).toEqual({ status: 'todo' })
  })

  it('returns null for multiple includes (ambiguous)', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include'], ['wip', 'include']), m(), m())).toBeNull()
  })

  it('inherits a sole include label or project', () => {
    expect(resolveInheritedFilterParams(m(), m(['bug', 'include']), m())).toEqual({ label: 'bug' })
    expect(resolveInheritedFilterParams(m(), m(), m(['proj1', 'include']))).toEqual({ project: 'proj1' })
  })

  it('returns null with no filters', () => {
    expect(resolveInheritedFilterParams(m(), m(), m())).toBeNull()
  })

  it('returns null for cross-dimension ambiguity (one status + one label include)', () => {
    expect(resolveInheritedFilterParams(m(['todo', 'include']), m(['bug', 'include']), m())).toBeNull()
  })
})
