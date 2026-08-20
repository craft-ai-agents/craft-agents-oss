import { describe, it, expect } from 'bun:test'
import { routes } from '../routes'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('route-parser: canonical Notes routes', () => {
  it('builds canonical local Notes routes and round-trips nested note ids', () => {
    const noteId = 'folder/my note.md'
    const route = routes.view.notes(noteId)
    expect(routes.view.notes()).toBe('notes')
    expect(route).toBe(`notes/note/${encodeURIComponent(noteId)}`)

    const compound = parseCompoundRoute(route)
    expect(compound).toEqual({
      navigator: 'notes',
      details: { type: 'note', id: noteId },
    })
    expect(buildCompoundRoute(compound!)).toBe(route)

    const state = parseRouteToNavigationState(route)
    expect(state).toEqual({
      navigator: 'notes',
      details: { type: 'note', noteId },
    })
    expect(buildRouteFromNavigationState(state!)).toBe(route)
  })

  it('does not expose retired legacy Notes routes', () => {
    expect(isCompoundRoute('notes-legacy')).toBe(false)
    expect(parseCompoundRoute('notes-legacy/note/foo')).toBeNull()
    expect(parseRouteToNavigationState('notes-legacy/note/foo')).toBeNull()
    expect(parseNavigationStateKey('notes-legacy/note/foo')).toBeNull()
  })

  it('uses canonical Notes navigation-state keys', () => {
    const state = {
      navigator: 'notes' as const,
      details: { type: 'note' as const, noteId: 'folder/foo' },
    }
    expect(getNavigationStateKey(state)).toBe('notes/note/folder%2Ffoo')
    expect(parseNavigationStateKey('notes/note/folder%2Ffoo')).toEqual(state)
  })
})
