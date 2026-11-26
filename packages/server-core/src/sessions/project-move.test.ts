import { describe, expect, it } from 'bun:test'
import { MAX_PROJECT_MOVE_SESSIONS } from '@craft-agent/shared/protocol'
import {
  planProjectMove,
  projectMoveDestination,
  projectMoveSelection,
  projectRestoreStates,
  type ProjectMoveNode,
} from './project-move.ts'

/** Ids the plan moves, with the marker each gets ('!' = kept apart from its parent) */
function moved(nodes: ProjectMoveNode[], selected: string[], destination: string | undefined): string[] {
  return planProjectMove(nodes, selected, destination).map(c => {
    expect(c.projectId).toBe(destination)
    return c.projectOverride ? `${c.id}!` : c.id
  })
}

describe('planProjectMove', () => {
  it('takes children and grandchildren along, whatever project they had, and nothing else', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'child', listParentId: 'parent', projectId: 'app' },
      { id: 'unassigned', listParentId: 'parent' },
      { id: 'grandchild', listParentId: 'child', projectId: 'app' },
      { id: 'unrelated', projectId: 'app' },
    ]
    expect(moved(nodes, ['parent'], 'next')).toEqual(['parent', 'child', 'unassigned', 'grandchild'])
    expect(moved(nodes, ['parent'], undefined)).toEqual(['parent', 'child', 'grandchild'])
  })

  it('leaves a child that keeps its own project, with everything under it', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'apart', listParentId: 'parent', projectId: 'docs', projectOverride: true },
      { id: 'under-apart', listParentId: 'apart', projectId: 'docs' },
      { id: 'no-project', listParentId: 'parent', projectOverride: true },
    ]
    expect(moved(nodes, ['parent'], 'next')).toEqual(['parent'])
  })

  it('treats a child in another project as kept apart when its header predates the marker', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'legacy-apart', listParentId: 'parent', projectId: 'docs' },
      // Same project as where the walk started: follows, even under an unassigned parent
      { id: 'legacy-unassigned', listParentId: 'parent' },
      { id: 'legacy-grandchild', listParentId: 'legacy-unassigned', projectId: 'app' },
    ]
    expect(moved(nodes, ['parent'], 'next')).toEqual(['parent', 'legacy-unassigned', 'legacy-grandchild'])
  })

  it('takes back a kept-apart child already in the destination: the family converged', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'apart', listParentId: 'parent', projectId: 'docs', projectOverride: true },
      { id: 'under-apart', listParentId: 'apart', projectId: 'docs' },
    ]
    // Only the marker changes on `apart`; `under-apart` is already in docs
    const plan = planProjectMove(nodes, ['parent'], 'docs')
    expect(plan).toEqual([
      { id: 'parent', projectId: 'docs', projectOverride: undefined },
      { id: 'apart', projectId: 'docs', projectOverride: undefined },
    ])
    // So the next move takes the whole family
    const after = nodes.map(n => ({ ...n, projectId: 'docs', projectOverride: undefined }))
    expect(moved(after, ['parent'], 'next')).toEqual(['parent', 'apart', 'under-apart'])
  })

  it('marks a selected chat that ends up apart from a parent that stays, and clears it when they meet again', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'child', listParentId: 'parent', projectId: 'app' },
    ]
    expect(moved(nodes, ['child'], 'docs')).toEqual(['child!'])
    expect(moved(nodes, ['child'], undefined)).toEqual(['child!'])
    const apart: ProjectMoveNode[] = [nodes[0]!, { ...nodes[1]!, projectId: 'docs', projectOverride: true }]
    expect(moved(apart, ['child'], 'app')).toEqual(['child'])
  })

  it('moves selected chats with their parent as one family, kept-apart ones included', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'parent', projectId: 'app' },
      { id: 'apart', listParentId: 'parent', projectId: 'docs', projectOverride: true },
      { id: 'under-apart', listParentId: 'apart', projectId: 'docs' },
      { id: 'other-root' },
      { id: 'other-child', listParentId: 'other-root' },
    ]
    // Selection order (a selected child first) doesn't matter
    expect(moved(nodes, ['apart', 'parent', 'other-root'], 'next'))
      .toEqual(['apart', 'under-apart', 'parent', 'other-root', 'other-child'])
  })

  it('takes branches along with the chat they were branched from (the list nests them the same way)', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'source', projectId: 'app' },
      { id: 'branch', listParentId: 'source', projectId: 'app' },
      { id: 'branch-of-branch', listParentId: 'branch', projectId: 'app' },
    ]
    expect(moved(nodes, ['source'], 'next')).toEqual(['source', 'branch', 'branch-of-branch'])
  })

  it('ignores ids it was not given (unknown, or of another workspace) and leaves chats that keep their binding out', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'a', projectId: 'next' },
      { id: 'b', listParentId: 'missing-parent' },
    ]
    expect(moved(nodes, ['ghost', 'a', 'b'], 'next')).toEqual(['b'])
  })

  it('ends a walk through a loop of parents', () => {
    const nodes: ProjectMoveNode[] = [
      { id: 'c1', listParentId: 'c2' },
      { id: 'c2', listParentId: 'c1' },
      { id: 'self', listParentId: 'self' },
    ]
    expect(moved(nodes, ['c1', 'self'], 'next').sort()).toEqual(['c1', 'c2', 'self'])
  })
})

describe('project move input checks', () => {
  it('takes the command session first, then the additional ids, once each', () => {
    expect(projectMoveSelection('a', undefined)).toEqual(['a'])
    expect(projectMoveSelection('a', null)).toEqual(['a'])
    expect(projectMoveSelection('a', ['b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('refuses anything but an array of ids (a string used to be spread into characters)', () => {
    expect(() => projectMoveSelection('a', 'bc')).toThrow('additionalSessionIds must be an array')
    expect(() => projectMoveSelection('a', ['b', 3])).toThrow('additionalSessionIds must be an array')
    expect(() => projectMoveSelection('a', ['b', ''])).toThrow('additionalSessionIds must be an array')
    expect(() => projectMoveSelection('a', { 0: 'b' })).toThrow('additionalSessionIds must be an array')
    expect(() => projectMoveSelection('', [])).toThrow('session id')
    expect(() => projectMoveSelection(undefined, [])).toThrow('session id')
  })

  it(`caps a command at ${MAX_PROJECT_MOVE_SESSIONS} chats`, () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`)
    expect(projectMoveSelection('a', ids(MAX_PROJECT_MOVE_SESSIONS - 1))).toHaveLength(MAX_PROJECT_MOVE_SESSIONS)
    expect(() => projectMoveSelection('a', ids(MAX_PROJECT_MOVE_SESSIONS))).toThrow(`at most ${MAX_PROJECT_MOVE_SESSIONS}`)
  })

  it('takes a project id or null as the destination', () => {
    expect(projectMoveDestination('proj_1')).toBe('proj_1')
    expect(projectMoveDestination(null)).toBeNull()
    expect(() => projectMoveDestination(undefined)).toThrow('project id or null')
    expect(() => projectMoveDestination('')).toThrow('project id or null')
    expect(() => projectMoveDestination(['proj_1'])).toThrow('project id or null')
  })

  it('checks every restore entry', () => {
    const entry = { id: 'a', projectId: 'proj_1', projectOverride: true }
    expect(projectRestoreStates([entry, { id: 'b', projectId: null, projectOverride: false }])).toEqual([
      entry,
      { id: 'b', projectId: null, projectOverride: false },
    ])
    expect(() => projectRestoreStates('a')).toThrow('must be an array')
    expect(() => projectRestoreStates([{ ...entry, projectOverride: 'yes' }])).toThrow('boolean projectOverride')
    expect(() => projectRestoreStates([{ ...entry, projectId: undefined }])).toThrow('projectId (or null)')
    expect(() => projectRestoreStates([null])).toThrow('each entry')
    expect(() => projectRestoreStates(Array.from({ length: MAX_PROJECT_MOVE_SESSIONS + 1 }, () => entry))).toThrow('at most')
  })
})
