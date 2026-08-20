/**
 * Surface layout snapshot (spec S-02 §3.10) — transport-derived, NOT a second
 * persistence channel.
 *
 * The canonical encoding of an open-surfaces layout is the URL encoding that
 * `NavigationContext.syncUrl` already writes (`?route=`, `?panels=<route>:<prop>,…`,
 * `?fi=<focusedIndex>`) and `reconcileFromUrlParams` reads back. This module
 * only derives `SurfaceLayoutSnapshot` from that encoding and re-encodes
 * snapshots into it; `KEYS.workspaceUrl` remains the source of truth and wins
 * on conflict (S-02 §3.10). No layout data is persisted in a snapshot-only
 * format.
 *
 * Tab identity (S-02 §3.7): a tab carries only its DURABLE ref (sessionId,
 * runId, KnowledgeRef, proposalId, extensionId+viewId). Ephemeral instance ids
 * (e.g. browser `browser-embedded-N`) and the navigator filter the tab was
 * opened under are navigation context, not tab identity — a session tab
 * re-emits on its canonical `allSessions/session/{id}` route.
 *
 * Non-surface panels (settings/sources/skills/… navigator views) are NOT tabs
 * (S-02 §3.5) and are dropped from snapshots; full mixed stacks keep round-
 * tripping through the URL channel itself, untouched by this module.
 *
 * Degradation (matches the table in shared/route-parser.ts): malformed surface
 * routes degrade to sessions/allSessions at parse time and therefore surface
 * here as a session tab with no sessionId → dropped (null) rather than
 * resurrected as a bogus surface. Until W2/W5, renderers resolve surface
 * states through `degradeSurfaceNavigationState`.
 *
 * Transport precision: proportions are encoded via `Number.toFixed(4)`
 * (syncUrl's format), so they round-trip exactly when stored at ≤4 decimal
 * places; finer values are normalized on encode.
 */

import { routes } from '../../shared/routes'
import type { ViewRoute } from '../../shared/routes'
import { parseRouteToNavigationState } from '../../shared/route-parser'
import type { KnowledgeRefKind } from '../../shared/types'

// =============================================================================
// Surface tab model (structural twin of S-02 §3.1 SurfaceTab)
// =============================================================================

/**
 * SiYuan ref as serialized in a surface tab. Kept structurally identical to
 * the Knowledge Provider contract (K-03 §3.1); apps/electron does not import
 * @craft-agent/core's knowledge module, so the shape is declared locally.
 */
export interface SurfaceKnowledgeRef {
  scheme: 'siyuan'
  kind: KnowledgeRefKind
  id: string
}

export type SurfaceTabLike =
  | { kind: 'session'; sessionId: string }
  | { kind: 'knowledge'; ref: SurfaceKnowledgeRef }
  | { kind: 'browser'; tabId: string }
  | { kind: 'database'; ref: SurfaceKnowledgeRef }
  | { kind: 'cloud-run'; runId: string }
  | { kind: 'extension'; extensionId: string; viewId: string }
  | { kind: 'diff'; proposalId: string }

// =============================================================================
// Snapshot model (S-02 §3.10)
// =============================================================================

export interface SurfaceLayoutTab {
  panelId: string
  laneId: 'main'
  tab: SurfaceTabLike
  proportion: number
  scrollState?: unknown
}

export interface SurfaceLayoutSnapshot {
  version: 1
  workspaceId: string
  /** W1: always [{ laneId: 'main', locked: false }] (multi-lane is M4). */
  lanes: Array<{ laneId: 'main'; locked: boolean }>
  tabs: SurfaceLayoutTab[]
  focusedIndex: number
  savedAt: number
}

/**
 * Flat "open surfaces" view: the tabs, the active panel id and the panels as
 * route strings — the shape layout consumers (tab strip, host.restore) work in.
 */
export interface OpenSurfaces {
  tabs: SurfaceTabLike[]
  activeId: string | null
  panels: string[]
}

const SURFACE_LANES: SurfaceLayoutSnapshot['lanes'] = [{ laneId: 'main', locked: false }]

// =============================================================================
// Tab ↔ route
// =============================================================================

/** Canonical route for a surface tab (durable ref only, S-02 §3.7). */
export function surfaceTabToRoute(tab: SurfaceTabLike): string {
  switch (tab.kind) {
    case 'session':
      return routes.view.allSessions(tab.sessionId)
    case 'browser':
      return routes.view.browser(tab.tabId)
    case 'knowledge':
      return routes.view.siyuan({ kind: tab.ref.kind, id: tab.ref.id })
    case 'database':
      return routes.view.siyuan({ kind: 'database', id: tab.ref.id })
    case 'cloud-run':
      return routes.view.cloudRun(tab.runId)
    case 'extension':
      return routes.view.extension(tab.extensionId, tab.viewId)
    case 'diff':
      return routes.view.proposal(tab.proposalId)
  }
}

/**
 * Extract a surface tab from a route, or null when the route is not a surface
 * with a concrete durable ref (navigator-only views, filter-only session
 * routes, extension roots without viewId, degraded malformed surface routes).
 */
export function surfaceTabFromRoute(route: string): SurfaceTabLike | null {
  const state = parseRouteToNavigationState(route)
  if (!state) return null

  switch (state.navigator) {
    case 'sessions':
      return state.details?.type === 'session'
        ? { kind: 'session', sessionId: state.details.sessionId }
        : null
    case 'browser':
      return state.details?.type === 'browser'
        ? { kind: 'browser', tabId: state.details.id }
        : null
    case 'knowledge': {
      if (state.details?.type !== 'knowledge') return null
      const ref: SurfaceKnowledgeRef = { scheme: 'siyuan', kind: state.details.kind, id: state.details.id }
      return state.details.kind === 'database'
        ? { kind: 'database', ref }
        : { kind: 'knowledge', ref }
    }
    case 'cloud-run':
      return state.details?.type === 'cloud-run'
        ? { kind: 'cloud-run', runId: state.details.runId }
        : null
    case 'extension':
      // A SurfaceTab extension always names its view (S-02 §3.1); view-less
      // extension roots parse at state level but are not tabs.
      return state.details?.type === 'extension' && state.details.viewId
        ? { kind: 'extension', extensionId: state.details.extensionId, viewId: state.details.viewId }
        : null
    case 'diff':
      return state.details?.type === 'diff'
        ? { kind: 'diff', proposalId: state.details.proposalId }
        : null
    default:
      return null
  }
}

// =============================================================================
// Snapshot ↔ URL encoding (transport = NavigationContext's ?panels= format)
// =============================================================================

/**
 * Parse the URL panel-stack encoding (`panels` entries joined by ',', each
 * `<route>:<proportion.toFixed(4)>`) into raw stack entries. Mirrors
 * NavigationContext.reconcileFromUrlParams: missing/invalid proportions get an
 * equal split; non-unit totals are rescaled.
 */
function decodePanelEntries(panelsParam: string): Array<{ route: string; proportion: number }> {
  const entries = panelsParam.split(',').filter(Boolean).map(entry => {
    const colonIdx = entry.lastIndexOf(':')
    if (colonIdx > 0) {
      const proportion = parseFloat(entry.slice(colonIdx + 1))
      if (!isNaN(proportion) && proportion > 0 && proportion < 1) {
        return { route: entry.slice(0, colonIdx), proportion }
      }
    }
    return { route: entry, proportion: 0 }
  })

  const hasProportions = entries.some(e => e.proportion > 0)
  if (!hasProportions) {
    const equal = 1 / entries.length
    entries.forEach(e => { e.proportion = equal })
  } else {
    const total = entries.reduce((s, e) => s + e.proportion, 0)
    if (total > 0 && Math.abs(total - 1) > 0.001) {
      entries.forEach(e => { e.proportion = e.proportion / total })
    }
  }
  return entries
}

/**
 * Derive a snapshot from a URL search string (`?route=…&panels=…&fi=…`).
 * Non-surface panels are skipped (see header); `focusedIndex` is remapped to
 * the kept tabs (0 when the focused panel was not a surface tab).
 */
export function snapshotFromUrlSearch(
  search: string,
  workspaceId: string,
  savedAt: number = Date.now(),
): SurfaceLayoutSnapshot {
  const params = new URLSearchParams(search)
  const panelsParam = params.get('panels')
  const focusedParam = params.get('fi')

  let rawEntries: Array<{ route: string; proportion: number }> = []
  if (panelsParam) {
    rawEntries = decodePanelEntries(panelsParam)
  } else {
    const route = params.get('route')
    if (route) rawEntries = [{ route, proportion: 1 }]
  }

  const rawFocused = focusedParam != null ? (parseInt(focusedParam, 10) || 0) : 0

  const tabs: SurfaceLayoutTab[] = []
  let focusedIndex = 0
  rawEntries.forEach((entry, rawIndex) => {
    const tab = surfaceTabFromRoute(entry.route)
    if (!tab) return
    if (rawIndex === rawFocused) focusedIndex = tabs.length
    tabs.push({ panelId: `panel-${rawIndex}`, laneId: 'main', tab, proportion: entry.proportion })
  })

  return { version: 1, workspaceId, lanes: SURFACE_LANES, tabs, focusedIndex, savedAt }
}

/**
 * Re-encode a snapshot into the URL panel-stack encoding. Emits `route` for
 * the focused tab; emits `panels`/`fi` only for multi-tab layouts — the exact
 * shape syncUrl produces, so a workspace URL built from a snapshot is
 * indistinguishable from one the live shell wrote.
 */
export function snapshotToUrlSearch(snapshot: SurfaceLayoutSnapshot): string {
  const params = new URLSearchParams()
  const focusedIndex = snapshot.tabs.length > 0
    ? Math.min(Math.max(snapshot.focusedIndex, 0), snapshot.tabs.length - 1)
    : 0

  if (snapshot.tabs.length > 0) {
    params.set('route', surfaceTabToRoute(snapshot.tabs[focusedIndex].tab))
  }
  if (snapshot.tabs.length > 1) {
    const encoded = snapshot.tabs
      .map(t => `${surfaceTabToRoute(t.tab)}:${t.proportion.toFixed(4)}`)
      .join(',')
    params.set('panels', encoded)
    params.set('fi', String(focusedIndex))
  }
  const str = params.toString()
  return str ? `?${str}` : ''
}

/**
 * Stack entries for `reconcilePanelStackAtom` — restore path (S-02 §3.10 step 1:
 * key-preserving reconcile keeps existing panel ids / sessions alive).
 */
export function snapshotToPanelEntries(
  snapshot: SurfaceLayoutSnapshot,
): { entries: Array<{ route: ViewRoute; proportion: number }>; focusedIndex: number } {
  return {
    entries: snapshot.tabs.map(t => ({
      route: surfaceTabToRoute(t.tab) as ViewRoute,
      proportion: t.proportion,
    })),
    focusedIndex: snapshot.focusedIndex,
  }
}

// =============================================================================
// Snapshot ↔ OpenSurfaces
// =============================================================================

/** Flat view of a snapshot for tab-strip/host consumers. */
export function snapshotToOpenSurfaces(snapshot: SurfaceLayoutSnapshot): OpenSurfaces {
  const focused = snapshot.tabs[snapshot.focusedIndex]
  return {
    tabs: snapshot.tabs.map(t => t.tab),
    activeId: focused ? focused.panelId : null,
    panels: snapshot.tabs.map(t => surfaceTabToRoute(t.tab)),
  }
}

/**
 * Build an equal-split snapshot from a flat open-surfaces view. Deterministic
 * defaults (`panel-${index}` ids, equal proportions, focus 0) make
 * snapshotToOpenSurfaces → snapshotFromOpenSurfaces round-trips exact for
 * snapshots that used the same defaults; pass the options to preserve custom
 * ids, proportions, focus or timestamps.
 */
export function snapshotFromOpenSurfaces(
  open: OpenSurfaces,
  options: {
    workspaceId: string
    panelIds?: string[]
    proportions?: number[]
    focusedIndex?: number
    savedAt?: number
  },
): SurfaceLayoutSnapshot {
  return {
    version: 1,
    workspaceId: options.workspaceId,
    lanes: SURFACE_LANES,
    tabs: open.tabs.map((tab, index) => ({
      panelId: options.panelIds?.[index] ?? `panel-${index}`,
      laneId: 'main',
      tab,
      proportion: options.proportions?.[index] ?? (open.tabs.length > 0 ? 1 / open.tabs.length : 1),
    })),
    focusedIndex: options.focusedIndex ?? 0,
    savedAt: options.savedAt ?? Date.now(),
  }
}
