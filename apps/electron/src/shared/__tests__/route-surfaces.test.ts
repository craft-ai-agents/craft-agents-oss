import { describe, it, expect } from 'bun:test'
import { routes } from '../routes'
import {
  parseRoute,
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
  degradeSurfaceNavigationState,
} from '../route-parser'
import type { NavigationState } from '../types'

/**
 * W1 unified-shell surface routes (spec S-02 §3.6):
 * every SurfaceTab kind round-trips parse ↔ build through BOTH the compound
 * pair and the NavigationState pair; malformed surface routes and consumers
 * without surface handlers degrade to the nearest existing view (table at the
 * top of route-parser.ts).
 */
describe('route-parser: unified shell surfaces', () => {
  // ------------------------------------------------------------------
  // Round-trip: all 7 SurfaceTab kinds (NavigationState pair)
  // ------------------------------------------------------------------
  const surfaceRoutes: Array<[string, string]> = [
    // [label, canonical route produced by the routes.view builder]
    ['session', routes.view.allSessions('session-1')],
    ['browser', routes.view.browser('browser-embedded-7')],
    ['knowledge', routes.view.siyuan({ kind: 'document', id: 'doc-1' })],
    ['database', routes.view.siyuan({ kind: 'database', id: 'db-9' })],
    ['cloud-run', routes.view.cloudRun('run-42')],
    ['extension', routes.view.extension('ext-1', 'mainview')],
    ['diff', routes.view.proposal('prop-2')],
  ]

  for (const [label, route] of surfaceRoutes) {
    it(`round-trips ${label} via NavigationState: ${route}`, () => {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(buildRouteFromNavigationState(state!)).toBe(route)
    })

    it(`round-trips ${label} via ParsedCompoundRoute: ${route}`, () => {
      const compound = parseCompoundRoute(route)
      expect(compound).not.toBeNull()
      expect(buildCompoundRoute(compound!)).toBe(route)
    })
  }

  it('parses knowledge route into knowledge navigator with ref kind + id', () => {
    const state = parseRouteToNavigationState('knowledge/document/doc-1')!
    expect(state.navigator).toBe('knowledge')
    expect(state.navigator === 'knowledge' && state.details).toEqual({
      type: 'knowledge',
      kind: 'document',
      id: 'doc-1',
    })
  })

  it('parses database route as knowledge navigator with kind "database"', () => {
    const state = parseRouteToNavigationState('knowledge/database/db-9')!
    expect(state.navigator).toBe('knowledge')
    expect(state.navigator === 'knowledge' && state.details).toEqual({
      type: 'knowledge',
      kind: 'database',
      id: 'db-9',
    })
  })

  it('parses cloud-run extension and diff into their own navigators', () => {
    const run = parseRouteToNavigationState('cloud-run/run-42')!
    expect(run.navigator).toBe('cloud-run')
    expect(run.navigator === 'cloud-run' && run.details).toEqual({ type: 'cloud-run', runId: 'run-42' })

    const ext = parseRouteToNavigationState('extension/ext-1/mainview')!
    expect(ext.navigator).toBe('extension')
    expect(ext.navigator === 'extension' && ext.details).toEqual({
      type: 'extension',
      extensionId: 'ext-1',
      viewId: 'mainview',
    })

    const diff = parseRouteToNavigationState('diff/prop-2')!
    expect(diff.navigator).toBe('diff')
    expect(diff.navigator === 'diff' && diff.details).toEqual({ type: 'diff', proposalId: 'prop-2' })
  })

  it('decodes percent-encoded ids (slashes/spaces survive the round-trip)', () => {
    const route = routes.view.siyuan({ kind: 'document', id: 'doc/with space' })
    expect(route).toBe('knowledge/document/doc%2Fwith%20space')
    const state = parseRouteToNavigationState(route)!
    expect(state.navigator === 'knowledge' && state.details?.type === 'knowledge' && state.details.id).toBe('doc/with space')
    expect(buildRouteFromNavigationState(state)).toBe(route)
  })

  it('builds exact route strings (compat pins for the new builders)', () => {
    expect(routes.view.siyuan({ kind: 'block', id: 'b-1' })).toBe('knowledge/block/b-1')
    expect(routes.view.knowledgeView('research-needs-review')).toBe(
      'knowledge/view/research-needs-review',
    )
    expect(routes.view.cloudRun('r 1')).toBe('cloud-run/r%201')
    expect(routes.view.extension('e/1', 'v 2')).toBe('extension/e%2F1/v%202')
    expect(routes.view.proposal('p#3')).toBe('diff/p%233')
  })

  it('parses knowledge/view/{viewId} into knowledge-view details and round-trips', () => {
    const route = routes.view.knowledgeView('research-needs-review')
    const state = parseRouteToNavigationState(route)!
    expect(state.navigator).toBe('knowledge')
    expect(state.navigator === 'knowledge' && state.details).toEqual({
      type: 'knowledge-view',
      viewId: 'research-needs-review',
    })
    expect(buildRouteFromNavigationState(state)).toBe(route)
  })

  // ------------------------------------------------------------------
  // Degradation paths (until W2/W5 hosts exist)
  // ------------------------------------------------------------------
  it('degrades knowledge route with unknown ref kind to sessions/allSessions', () => {
    const state = parseRouteToNavigationState('knowledge/not-a-kind/doc-1')!
    expect(state.navigator).toBe('sessions')
    expect(state.navigator === 'sessions' && state.details).toBeNull()
    expect(buildRouteFromNavigationState(state)).toBe('allSessions')
  })

  it('degrades knowledge route missing its id to sessions/allSessions', () => {
    const state = parseRouteToNavigationState('knowledge/document')!
    expect(state.navigator).toBe('sessions')
    expect(buildRouteFromNavigationState(state)).toBe('allSessions')
  })

  it('keeps bare surface roots as navigator-only states that rebuild exactly', () => {
    for (const root of ['knowledge', 'cloud-run', 'extension', 'diff'] as const) {
      const state = parseRouteToNavigationState(root)!
      expect(state.navigator).toBe(root)
      expect('details' in state && state.details).toBeNull()
      expect(buildRouteFromNavigationState(state)).toBe(root)
    }
  })

  it('degrades legacy parseRoute() of a surface route to the allSessions view', () => {
    const parsed = parseRoute(routes.view.siyuan({ kind: 'document', id: 'doc-1' }))
    expect(parsed).toEqual({ type: 'view', name: 'allSessions', params: {} })
  })

  it('maps surface states to nearest existing views via degradeSurfaceNavigationState', () => {
    const knowledge: NavigationState = {
      navigator: 'knowledge',
      details: { type: 'knowledge', kind: 'document', id: 'doc-1' },
    }
    expect(degradeSurfaceNavigationState(knowledge)).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    })

    const cloudRun: NavigationState = { navigator: 'cloud-run', details: { type: 'cloud-run', runId: 'run-42' } }
    expect(degradeSurfaceNavigationState(cloudRun).navigator).toBe('sessions')

    const diff: NavigationState = { navigator: 'diff', details: { type: 'diff', proposalId: 'prop-2' } }
    expect(degradeSurfaceNavigationState(diff).navigator).toBe('sessions')

    const extension: NavigationState = {
      navigator: 'extension',
      details: { type: 'extension', extensionId: 'ext-1', viewId: 'mainview' },
    }
    expect(degradeSurfaceNavigationState(extension)).toEqual({ navigator: 'settings', subpage: null })
  })

  it('is identity for pre-W1 states', () => {
    const sessions: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: 's1' },
    }
    expect(degradeSurfaceNavigationState(sessions)).toBe(sessions)
  })

  // ------------------------------------------------------------------
  // Regression pins: pre-existing route strings are unchanged end-to-end
  // ------------------------------------------------------------------
  const preExistingRoutes = [
    'allSessions',
    'flagged',
    'archived',
    'board',
    'table',
    'memory',
    'allSessions/session/abc123',
    'flagged/session/abc123',
    'state/todo/session/abc123',
    'label/work/session/abc123',
    'sources',
    'sources/api',
    'sources/api/source/gmail',
    'sources/source/github',
    'skills',
    'skills/skill/skill-1',
    'notes',
    'notes/note/note-1',
    'automations',
    'automations/scheduled',
    'automations/scheduled/automation/auto-1',
    'projects',
    'projects/project/proj-1',
    'settings',
    'settings/shortcuts',
    'browser/instance/browser-embedded-1',
  ]

  for (const route of preExistingRoutes) {
    it(`keeps pre-existing route intact: ${route}`, () => {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(buildRouteFromNavigationState(state!)).toBe(route)
    })
  }

  it('parses table route into sessions viewMode table and round-trips', () => {
    expect(routes.view.table()).toBe('table')
    const state = parseRouteToNavigationState('table')
    expect(state).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
      viewMode: 'table',
    })
    expect(buildRouteFromNavigationState(state!)).toBe('table')
    const compound = parseCompoundRoute('table')
    expect(compound).toEqual({
      navigator: 'sessions',
      sessionFilter: { kind: 'allSessions' },
      viewMode: 'table',
      details: null,
    })
    expect(buildCompoundRoute(compound!)).toBe('table')
  })
})
