import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { startOfDay } from "date-fns"

import { searchLog } from "@/lib/logger"
import { parseLabelEntry, matchesLabelFilter } from "@craft-agent/shared/labels"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { fuzzyScore } from "@craft-agent/shared/search"
import { getSessionTitle, getSessionStatus } from "@/utils/session"
import { buildSessionFamilies, flatRow, flattenFamilies, type SessionFamily, type SessionListRow } from "@/utils/session-tree"
import type { SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@craft-agent/shared/views"
import type { SessionFilter } from "@/contexts/NavigationContext"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_DISPLAY_LIMIT = 50
const BATCH_SIZE = 50
const MAX_SEARCH_RESULTS = 100
const NO_COLLAPSED_FAMILIES: ReadonlySet<string> = new Set()

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
export type FilterMode = 'include' | 'exclude'

export interface ContentSearchResult {
  matchCount: number
  snippet: string
}

/** Metadata for a collapsed group — emitted by the data pipeline so the renderer can show header-only groups */
export interface CollapsedGroupMeta {
  key: string
  count: number
}

export type SessionGroupingMode = 'date' | 'status' | 'unread' | 'project'

export interface UseSessionSearchOptions {
  items: SessionMeta[]
  searchActive: boolean
  searchQuery: string
  workspaceId?: string
  currentFilter?: SessionFilter
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  statusFilter?: Map<string, FilterMode>
  labelFilterMap?: Map<string, FilterMode>
  /** Workspace label tree — label filters match descendants through it (shared matchesLabelFilter). */
  labelConfigs?: LabelConfig[]
  /** Collapsed group keys — collapsed items are excluded from pagination and rows */
  collapsedGroups?: Set<string>
  /** Sessions whose sub-sessions are hidden */
  collapsedFamilies?: ReadonlySet<string>
  /** Grouping mode — needed to compute group keys for collapse-aware pagination */
  groupingMode?: SessionGroupingMode
  /** Ref to the ScrollArea viewport element — used for scroll-based pagination */
  scrollViewportRef?: React.RefObject<HTMLDivElement>
}

export interface UseSessionSearchResult {
  // Search state
  isSearchMode: boolean
  highlightQuery: string | undefined
  isSearchingContent: boolean
  /** Whether the search service is unavailable (e.g. ripgrep not found on remote server) */
  isSearchUnavailable: boolean
  /** Raw content search results — needed by SessionItem for `chatMatchCount` */
  contentSearchResults: Map<string, ContentSearchResult>

  // Filtered + grouped results
  matchingFilterItems: SessionMeta[]
  otherResultItems: SessionMeta[]
  exceededSearchLimit: boolean

  // Render-ready outputs
  /** Visible rows: the paginated families minus the sessions under collapsed rows, or the flat search results */
  rows: SessionListRow[]
  /** Every family of the filtered list, paginated or not (empty in search mode) */
  families: SessionFamily[]

  // Pagination
  hasMore: boolean
  /** Metadata for collapsed groups (key + item count) — used to build header-only placeholder groups */
  collapsedGroupsMeta: CollapsedGroupMeta[]

  // Refs
  searchInputRef: React.RefObject<HTMLInputElement>
}

// ---------------------------------------------------------------------------
// Pure helpers (moved from SessionList)
// ---------------------------------------------------------------------------

function getCollapseGroupKey(item: SessionMeta, groupingMode?: SessionGroupingMode): string {
  if (groupingMode === 'status') return `status-${getSessionStatus(item)}`
  if (groupingMode === 'unread') return item.hasUnread ? 'unread-yes' : 'unread-no'
  if (groupingMode === 'project') return `project-${(item as { projectId?: string }).projectId ?? '__none__'}`
  return startOfDay(new Date(item.lastMessageAt || 0)).toISOString()
}

/**
 * Date groups follow the newest-first order of the list, so one global window that grows on
 * scroll shows every group in turn. Status, unread and project groups don't: an old To-do sits
 * past the window and vanished from its group until the user scrolled far enough (#501). Those
 * modes window each group separately, so small groups show in full and big ones (Done) stay
 * bounded; `displayLimit` still grows on scroll.
 */
function paginatesPerGroup(groupingMode?: SessionGroupingMode): boolean {
  return groupingMode === 'status' || groupingMode === 'unread' || groupingMode === 'project'
}

/** How many sessions an item stands for (a family view: the family's size) */
type WeightOf = (item: SessionMeta) => number
const ONE_SESSION: WeightOf = () => 1

/**
 * Items up to `limit` sessions, or up to `limit` sessions of each group. An item is never split:
 * the one that crosses the limit is shown whole. Keeps the order of `items`.
 */
function windowItems(
  items: SessionMeta[],
  limit: number,
  groupingMode: SessionGroupingMode | undefined,
  weightOf: WeightOf,
): { visible: SessionMeta[]; hasMore: boolean } {
  const perGroup = paginatesPerGroup(groupingMode)
  const shownPerGroup = new Map<string, number>()
  const visible: SessionMeta[] = []
  let hasMore = false
  for (const item of items) {
    const key = perGroup ? getCollapseGroupKey(item, groupingMode) : ''
    const shown = shownPerGroup.get(key) ?? 0
    if (shown < limit) {
      visible.push(item)
      shownPerGroup.set(key, shown + weightOf(item))
    } else {
      hasMore = true
      if (!perGroup) break
    }
  }
  return { visible, hasMore }
}

export interface CollapsedPaginationResult {
  paginatedItems: SessionMeta[]
  hasMore: boolean
  collapsedGroupsMeta: CollapsedGroupMeta[]
}

/** `weightOf` counts sessions per item, for family views; collapsed-group counts are in sessions too. */
export function computeCollapsedPagination(
  items: SessionMeta[],
  displayLimit: number,
  collapsedGroups?: Set<string>,
  groupingMode?: SessionGroupingMode,
  weightOf: WeightOf = ONE_SESSION,
): CollapsedPaginationResult {
  const effectiveCollapsedKeys = new Set<string>()
  if (collapsedGroups && collapsedGroups.size > 0) {
    const groupKeysInView = new Set(items.map(item => getCollapseGroupKey(item, groupingMode)))
    // Safety guard: don't allow collapse state to hide the entire list when only one
    // group exists in the current filtered view (there would be no meaningful collapse UX).
    if (groupKeysInView.size > 1) {
      for (const key of collapsedGroups) {
        if (groupKeysInView.has(key)) effectiveCollapsedKeys.add(key)
      }
    }
  }

  if (effectiveCollapsedKeys.size === 0) {
    const { visible, hasMore } = windowItems(items, displayLimit, groupingMode, weightOf)
    return { paginatedItems: visible, hasMore, collapsedGroupsMeta: [] }
  }

  const expandedItems: SessionMeta[] = []
  const collapsedCounts = new Map<string, number>()

  for (const item of items) {
    const groupKey = getCollapseGroupKey(item, groupingMode)

    if (effectiveCollapsedKeys.has(groupKey)) {
      collapsedCounts.set(groupKey, (collapsedCounts.get(groupKey) || 0) + weightOf(item))
    } else {
      expandedItems.push(item)
    }
  }

  const meta: CollapsedGroupMeta[] = Array.from(collapsedCounts.entries()).map(
    ([key, count]) => ({ key, count })
  )

  const { visible, hasMore } = windowItems(expandedItems, displayLimit, groupingMode, weightOf)
  return { paginatedItems: visible, hasMore, collapsedGroupsMeta: meta }
}

export interface FamilyPage {
  rows: SessionListRow[]
  hasMore: boolean
  collapsedGroupsMeta: CollapsedGroupMeta[]
}

/**
 * The list outside search: families are grouped and paginated whole, by their views, then
 * flattened into rows without the sessions under collapsed rows.
 */
export function paginateFamilies(
  families: SessionFamily[],
  displayLimit: number,
  collapsedGroups: Set<string> | undefined,
  groupingMode: SessionGroupingMode | undefined,
  collapsedFamilies: ReadonlySet<string>,
): FamilyPage {
  const familyById = new Map(families.map(family => [family.view.id, family]))
  const { paginatedItems, hasMore, collapsedGroupsMeta } = computeCollapsedPagination(
    families.map(family => family.view),
    displayLimit,
    collapsedGroups,
    groupingMode,
    view => familyById.get(view.id)!.members.length,
  )
  const rows = flattenFamilies(paginatedItems.map(view => familyById.get(view.id)!), collapsedFamilies)
  return { rows, hasMore, collapsedGroupsMeta }
}

interface FilterMatchOptions {
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  statusFilter?: Map<string, 'include' | 'exclude'>
  labelFilterMap?: Map<string, 'include' | 'exclude'>
  labelConfigs?: LabelConfig[]
}

export function sessionMatchesCurrentFilter(
  session: SessionMeta,
  currentFilter: SessionFilter | undefined,
  options: FilterMatchOptions = {}
): boolean {
  const { evaluateViews, statusFilter, labelFilterMap, labelConfigs } = options

  const passesStatusFilter = (): boolean => {
    if (!statusFilter || statusFilter.size === 0) return true
    const sessionState = (session.sessionStatus || 'todo') as string

    let hasIncludes = false
    let matchesInclude = false
    for (const [stateId, mode] of statusFilter) {
      if (mode === 'exclude' && sessionState === stateId) return false
      if (mode === 'include') {
        hasIncludes = true
        if (sessionState === stateId) matchesInclude = true
      }
    }
    return !hasIncludes || matchesInclude
  }

  const passesLabelFilter = (): boolean => {
    if (!labelFilterMap || labelFilterMap.size === 0) return true
    const sessionLabelIds = session.labels?.map(l => parseLabelEntry(l).id) || []

    let hasIncludes = false
    let matchesInclude = false
    for (const [labelId, mode] of labelFilterMap) {
      if (mode === 'exclude' && sessionLabelIds.includes(labelId)) return false
      if (mode === 'include') {
        hasIncludes = true
        if (sessionLabelIds.includes(labelId)) matchesInclude = true
      }
    }
    return !hasIncludes || matchesInclude
  }

  if (!passesStatusFilter() || !passesLabelFilter()) return false

  if (!currentFilter) return true

  switch (currentFilter.kind) {
    case 'allSessions':
      return session.isArchived !== true

    case 'flagged':
      return session.isFlagged === true && session.isArchived !== true

    case 'archived':
      return session.isArchived === true

    case 'state':
      return (session.sessionStatus || 'todo') === currentFilter.stateId && session.isArchived !== true

    case 'label': {
      if (session.isArchived === true) return false
      // Shared predicate (descendant-aware + optional project scope) — keep in
      // sync with AppShell's filtered set by construction, not by copy.
      return matchesLabelFilter(session, currentFilter, labelConfigs ?? [])
    }

    case 'view':
      if (session.isArchived === true) return false
      if (!evaluateViews) return true
      const matched = evaluateViews(session)
      if (currentFilter.viewId === '__all__') return matched.length > 0
      return matched.some(v => v.id === currentFilter.viewId)

    default:
      const _exhaustive: never = currentFilter
      return true
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionSearch({
  items,
  searchActive,
  searchQuery,
  workspaceId,
  currentFilter,
  evaluateViews,
  statusFilter,
  labelFilterMap,
  labelConfigs,
  collapsedGroups,
  collapsedFamilies,
  groupingMode,
  scrollViewportRef,
}: UseSessionSearchOptions): UseSessionSearchResult {

  const [contentSearchResults, setContentSearchResults] = useState<Map<string, ContentSearchResult>>(new Map())
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  const [isSearchUnavailable, setIsSearchUnavailable] = useState(false)
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Search mode is active when search is open AND query has 2+ characters
  const isSearchMode = searchActive && searchQuery.length >= 2
  const highlightQuery = isSearchMode ? searchQuery : undefined

  // --- Content search (ripgrep IPC with debounce + cancellation) ---

  useEffect(() => {
    if (!workspaceId || !isSearchMode) {
      setContentSearchResults(new Map())
      return
    }

    const searchId = Date.now().toString(36)
    searchLog.info('query:change', { searchId, query: searchQuery })

    let cancelled = false
    setIsSearchingContent(true)
    setIsSearchUnavailable(false)

    const timer = setTimeout(async () => {
      try {
        searchLog.info('ipc:call', { searchId })
        const ipcStart = performance.now()

        const results = await window.electronAPI.searchSessionContent(workspaceId, searchQuery, searchId)

        if (cancelled) return

        searchLog.info('ipc:received', {
          searchId,
          durationMs: Math.round(performance.now() - ipcStart),
          resultCount: results.length,
        })

        const resultMap = new Map<string, ContentSearchResult>()
        for (const result of results) {
          resultMap.set(result.sessionId, {
            matchCount: result.matchCount,
            snippet: result.matches[0]?.snippet || '',
          })
        }
        setContentSearchResults(resultMap)

        requestAnimationFrame(() => {
          searchLog.info('render:complete', { searchId, sessionsDisplayed: resultMap.size })
        })
      } catch (error) {
        if (cancelled) return
        // Detect search unavailable (ripgrep not found) vs transient errors
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('SearchUnavailableError') || message.includes('ripgrep')) {
          console.warn('[useSessionSearch] Search unavailable:', message)
          setIsSearchUnavailable(true)
        } else {
          console.error('[useSessionSearch] Content search error:', error)
        }
        setContentSearchResults(new Map())
      } finally {
        if (!cancelled) {
          setIsSearchingContent(false)
        }
      }
    }, 100)

    return () => {
      cancelled = true
      clearTimeout(timer)
      setIsSearchingContent(false)
    }
  }, [workspaceId, isSearchMode, searchQuery])

  // --- Focus search input when search activates ---

  useEffect(() => {
    if (searchActive) {
      searchInputRef.current?.focus()
    }
  }, [searchActive])

  // --- Data pipeline ---

  // Filter out hidden sessions before any processing
  const visibleItems = useMemo(() => items.filter(item => !item.hidden), [items])

  // Sort by most recent activity first
  const sortedItems = useMemo(() =>
    [...visibleItems].sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)),
    [visibleItems]
  )

  // Filter items by search query or current filter
  const searchFilteredItems = useMemo(() => {
    if (!isSearchMode) {
      return sortedItems.filter(item =>
        sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews, statusFilter, labelFilterMap, labelConfigs })
      )
    }

    return sortedItems
      .filter(item => contentSearchResults.has(item.id))
      .sort((a, b) => {
        const aScore = fuzzyScore(getSessionTitle(a), searchQuery)
        const bScore = fuzzyScore(getSessionTitle(b), searchQuery)

        if (aScore > 0 && bScore === 0) return -1
        if (aScore === 0 && bScore > 0) return 1
        if (aScore !== bScore) return bScore - aScore

        const countA = contentSearchResults.get(a.id)?.matchCount || 0
        const countB = contentSearchResults.get(b.id)?.matchCount || 0
        return countB - countA
      })
  }, [sortedItems, isSearchMode, searchQuery, contentSearchResults, currentFilter, evaluateViews, statusFilter, labelFilterMap, labelConfigs])

  // Split search results: matching current filter vs others
  const { matchingFilterItems, otherResultItems, exceededSearchLimit } = useMemo(() => {
    const hasActiveFilters =
      (currentFilter && currentFilter.kind !== 'allSessions') ||
      (statusFilter && statusFilter.size > 0) ||
      (labelFilterMap && labelFilterMap.size > 0)

    if (searchQuery.trim() && searchFilteredItems.length > 0) {
      searchLog.info('search:grouping', {
        searchQuery,
        currentFilterKind: currentFilter?.kind,
        currentFilterStateId: currentFilter?.kind === 'state' ? currentFilter.stateId : undefined,
        hasActiveFilters,
        statusFilterSize: statusFilter?.size ?? 0,
        labelFilterSize: labelFilterMap?.size ?? 0,
        itemCount: searchFilteredItems.length,
      })
    }

    const totalCount = searchFilteredItems.length
    const exceeded = totalCount > MAX_SEARCH_RESULTS

    if (!isSearchMode || !hasActiveFilters) {
      const limitedItems = searchFilteredItems.slice(0, MAX_SEARCH_RESULTS)
      return { matchingFilterItems: limitedItems, otherResultItems: [] as SessionMeta[], exceededSearchLimit: exceeded }
    }

    const matching: SessionMeta[] = []
    const others: SessionMeta[] = []

    for (const item of searchFilteredItems) {
      if (matching.length + others.length >= MAX_SEARCH_RESULTS) break

      const matches = sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews, statusFilter, labelFilterMap, labelConfigs })
      if (matches) {
        matching.push(item)
      } else {
        others.push(item)
      }
    }

    if (searchFilteredItems.length > 0) {
      searchLog.info('search:grouping:result', {
        matchingCount: matching.length,
        othersCount: others.length,
        exceeded,
      })
    }

    return { matchingFilterItems: matching, otherResultItems: others, exceededSearchLimit: exceeded }
  }, [searchFilteredItems, currentFilter, evaluateViews, isSearchMode, statusFilter, labelFilterMap, labelConfigs, searchQuery])

  // --- Pagination ---

  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
  }, [searchQuery])

  // Outside search a sub-session sits under its parent, and the family is placed, grouped and
  // paginated as a whole by its view. Search results stay flat.
  const families = useMemo(
    () => isSearchMode ? [] : buildSessionFamilies(searchFilteredItems),
    [isSearchMode, searchFilteredItems]
  )

  // Collapse-aware pagination: collapsed items are excluded entirely from
  // rows (and therefore keyboard nav). Their counts are returned as
  // collapsedGroupsMeta so the renderer can show header-only groups.
  const { rows, hasMore, collapsedGroupsMeta } = useMemo((): FamilyPage => {
    if (isSearchMode) {
      const { hasMore, collapsedGroupsMeta } = computeCollapsedPagination(searchFilteredItems, displayLimit, collapsedGroups, groupingMode)
      return { rows: [...matchingFilterItems, ...otherResultItems].map(flatRow), hasMore, collapsedGroupsMeta }
    }
    return paginateFamilies(families, displayLimit, collapsedGroups, groupingMode, collapsedFamilies ?? NO_COLLAPSED_FAMILIES)
  }, [isSearchMode, searchFilteredItems, matchingFilterItems, otherResultItems, families, displayLimit, collapsedGroups, groupingMode, collapsedFamilies])

  const loadMore = useCallback(() => {
    setDisplayLimit(prev => Math.min(prev + BATCH_SIZE, searchFilteredItems.length))
  }, [searchFilteredItems.length])

  // Scroll-based pagination: listen for scroll on the actual ScrollArea viewport
  // (IntersectionObserver with root=null doesn't detect scroll inside Radix ScrollArea)
  useEffect(() => {
    if (!hasMore) return
    const viewport = scrollViewportRef?.current
    if (!viewport) return

    const check = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore()
      }
    }

    check() // fill viewport on mount / after group expand / after a family collapses
    viewport.addEventListener('scroll', check, { passive: true })
    return () => viewport.removeEventListener('scroll', check)
  }, [hasMore, loadMore, displayLimit, collapsedFamilies, scrollViewportRef])

  return {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    isSearchUnavailable,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    rows,
    families,
    hasMore,
    collapsedGroupsMeta,
    searchInputRef,
  }
}
