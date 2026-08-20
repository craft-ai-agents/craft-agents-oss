import { describe, it, expect } from 'bun:test'
import {
  surfaceTabToRoute,
  surfaceTabFromRoute,
  snapshotFromUrlSearch,
  snapshotToUrlSearch,
  snapshotToPanelEntries,
  snapshotToOpenSurfaces,
  snapshotFromOpenSurfaces,
  type SurfaceLayoutSnapshot,
  type SurfaceTabLike,
} from '../layout-snapshot'

const WS = 'workspace-1'
const SAVED_AT = 1_754_400_000_000

/** Snapshot with the deterministic ids snapshotFromUrlSearch produces (panel-${index}). */
function makeSnapshot(tabs: SurfaceTabLike[], focusedIndex: number, proportions?: number[]): SurfaceLayoutSnapshot {
  return {
    version: 1,
    workspaceId: WS,
    lanes: [{ laneId: 'main', locked: false }],
    tabs: tabs.map((tab, index) => ({
      panelId: `panel-${index}`,
      laneId: 'main',
      tab,
      // Default split normalized to the URL transport's 4-decimal precision
      proportion: proportions?.[index] ?? Number((1 / tabs.length).toFixed(4)),
    })),
    focusedIndex,
    savedAt: SAVED_AT,
  }
}

const sessionTab: SurfaceTabLike = { kind: 'session', sessionId: 'session-1' }
const browserTab: SurfaceTabLike = { kind: 'browser', tabId: 'browser-embedded-7' }
const knowledgeTab: SurfaceTabLike = { kind: 'knowledge', ref: { scheme: 'siyuan', kind: 'document', id: 'doc-1' } }
const databaseTab: SurfaceTabLike = { kind: 'database', ref: { scheme: 'siyuan', kind: 'database', id: 'db-9' } }
const cloudRunTab: SurfaceTabLike = { kind: 'cloud-run', runId: 'run-42' }
const extensionTab: SurfaceTabLike = { kind: 'extension', extensionId: 'ext-1', viewId: 'mainview' }
const diffTab: SurfaceTabLike = { kind: 'diff', proposalId: 'prop-2' }

describe('layout-snapshot: tab ↔ route', () => {
  it('maps every SurfaceTab kind to its canonical route and back', () => {
    const cases: Array<[SurfaceTabLike, string]> = [
      [sessionTab, 'allSessions/session/session-1'],
      [browserTab, 'browser/instance/browser-embedded-7'],
      [knowledgeTab, 'knowledge/document/doc-1'],
      [databaseTab, 'knowledge/database/db-9'],
      [cloudRunTab, 'cloud-run/run-42'],
      [extensionTab, 'extension/ext-1/mainview'],
      [diffTab, 'diff/prop-2'],
    ]
    for (const [tab, route] of cases) {
      expect(surfaceTabToRoute(tab)).toBe(route)
      expect(surfaceTabFromRoute(route)).toEqual(tab)
    }
  })

  it('returns null for non-surface routes and surfaces without a durable ref', () => {
    expect(surfaceTabFromRoute('settings/shortcuts')).toBeNull()
    expect(surfaceTabFromRoute('sources/source/github')).toBeNull()
    expect(surfaceTabFromRoute('allSessions')).toBeNull() // filter only, no sessionId
    expect(surfaceTabFromRoute('extension/ext-1')).toBeNull() // root without viewId
    expect(surfaceTabFromRoute('action/new-session')).toBeNull()
    expect(surfaceTabFromRoute('bogus/route')).toBeNull()
  })

  it('drops degraded surface routes instead of resurrecting bogus tabs', () => {
    // Unknown ref kind degrades to allSessions at parse time (route-parser table)
    expect(surfaceTabFromRoute('knowledge/not-a-kind/xyz')).toBeNull()
  })
})

describe('layout-snapshot: snapshot ↔ URL encoding', () => {
  it('round-trips a single-session layout (no panels param, like syncUrl)', () => {
    const snapshot = makeSnapshot([sessionTab], 0)
    const restored = snapshotFromUrlSearch(snapshotToUrlSearch(snapshot), WS, SAVED_AT)
    expect(restored).toEqual(snapshot)
  })

  it('round-trips a mixed 4-surface layout with focus on tab 2', () => {
    const snapshot = makeSnapshot([sessionTab, browserTab, knowledgeTab, cloudRunTab], 2)
    const search = snapshotToUrlSearch(snapshot)
    expect(search).toContain('fi=2')
    const restored = snapshotFromUrlSearch(search, WS, SAVED_AT)
    expect(restored).toEqual(snapshot)
  })

  it('round-trips a layout covering all 7 surface kinds', () => {
    const all = [sessionTab, browserTab, knowledgeTab, databaseTab, cloudRunTab, extensionTab, diffTab]
    const snapshot = makeSnapshot(all, 6)
    expect(snapshotFromUrlSearch(snapshotToUrlSearch(snapshot), WS, SAVED_AT)).toEqual(snapshot)
  })

  it('preserves non-uniform proportions at transport precision', () => {
    const snapshot = makeSnapshot([sessionTab, diffTab], 1, [0.3, 0.7])
    const restored = snapshotFromUrlSearch(snapshotToUrlSearch(snapshot), WS, SAVED_AT)
    expect(restored.tabs.map(t => t.proportion)).toEqual([0.3, 0.7])
    expect(restored.focusedIndex).toBe(1)
  })

  it('emits the exact syncUrl format (route always, panels/fi only when multi-panel)', () => {
    const single = snapshotToUrlSearch(makeSnapshot([sessionTab], 0))
    expect(single).toBe('?route=allSessions%2Fsession%2Fsession-1')

    const double = snapshotToUrlSearch(makeSnapshot([sessionTab, knowledgeTab], 1, [0.5, 0.5]))
    const params = new URLSearchParams(double)
    expect(params.get('route')).toBe('knowledge/document/doc-1')
    expect(params.get('panels')).toBe('allSessions/session/session-1:0.5000,knowledge/document/doc-1:0.5000')
    expect(params.get('fi')).toBe('1')
  })

  it('skips non-surface panels and remaps focus to the kept surface tabs', () => {
    // Stack: session panel + a settings panel (not a tab), settings focused
    const search =
      '?route=settings&panels=allSessions%2Fsession%2Fsession-1%3A0.6000%2Csettings%3A0.4000&fi=1'
    const snapshot = snapshotFromUrlSearch(search, WS, SAVED_AT)
    expect(snapshot.tabs.length).toBe(1)
    expect(snapshot.tabs[0].tab).toEqual(sessionTab)
    expect(snapshot.focusedIndex).toBe(0)
  })

  it('drops malformed surface panels without failing the rest of the stack', () => {
    const search =
      '?route=knowledge%2Fdocument%2Fdoc-1&panels=knowledge%2Fnot-a-kind%2Fxyz%3A0.5000%2Cknowledge%2Fdocument%2Fdoc-1%3A0.5000&fi=1'
    const snapshot = snapshotFromUrlSearch(search, WS, SAVED_AT)
    expect(snapshot.tabs.map(t => t.tab)).toEqual([knowledgeTab])
    expect(snapshot.focusedIndex).toBe(0)
  })

  it('reconstructs panel-stack entries for reconcilePanelStackAtom', () => {
    const snapshot = makeSnapshot([sessionTab, extensionTab], 1, [0.4, 0.6])
    const { entries, focusedIndex } = snapshotToPanelEntries(snapshot)
    expect(entries).toEqual([
      { route: 'allSessions/session/session-1', proportion: 0.4 },
      { route: 'extension/ext-1/mainview', proportion: 0.6 },
    ])
    expect(focusedIndex).toBe(1)
  })
})

describe('layout-snapshot: snapshot ↔ open surfaces', () => {
  it('round-trips through the OpenSurfaces view with deterministic defaults', () => {
    const snapshot = makeSnapshot([sessionTab, browserTab, diffTab], 2, [1 / 3, 1 / 3, 1 / 3])
    const open = snapshotToOpenSurfaces(snapshot)
    expect(open.activeId).toBe('panel-2')
    expect(open.panels).toEqual([
      'allSessions/session/session-1',
      'browser/instance/browser-embedded-7',
      'diff/prop-2',
    ])
    const restored = snapshotFromOpenSurfaces(open, {
      workspaceId: WS,
      focusedIndex: 2,
      savedAt: SAVED_AT,
    })
    expect(restored).toEqual(snapshot)
  })

  it('preserves custom ids and proportions when provided', () => {
    const open = { tabs: [knowledgeTab, cloudRunTab], activeId: 'right', panels: [] as string[] }
    const snapshot = snapshotFromOpenSurfaces(open, {
      workspaceId: WS,
      panelIds: ['left', 'right'],
      proportions: [0.25, 0.75],
      focusedIndex: 1,
      savedAt: SAVED_AT,
    })
    expect(snapshot.tabs.map(t => t.panelId)).toEqual(['left', 'right'])
    expect(snapshotToOpenSurfaces(snapshot).activeId).toBe('right')
    // …and it still flows through the URL transport unchanged
    const viaUrl = snapshotFromUrlSearch(snapshotToUrlSearch(snapshot), WS, SAVED_AT)
    expect(viaUrl.tabs.map(t => [t.tab.kind, t.proportion] as const)).toEqual([
      ['knowledge', 0.25],
      ['cloud-run', 0.75],
    ])
  })
})
