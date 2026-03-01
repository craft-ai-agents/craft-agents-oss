import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { isToday, isYesterday, format, startOfDay } from "date-fns"

import { searchLog } from "@/lib/logger"
import { parseLabelEntry } from "@craft-agent/shared/labels"
import { fuzzyScore } from "@craft-agent/shared/search"
import { getSessionTitle } from "@/utils/session"
import type { SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@craft-agent/shared/views"
import type { SessionFilter } from "@/contexts/NavigationContext"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_DISPLAY_LIMIT = 20
const BATCH_SIZE = 20
const MAX_SEARCH_RESULTS = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter mode for tri-state filtering: include shows only matching, exclude hides matching */
export type FilterMode = 'include' | 'exclude'

export interface DateGroup {
  date: Date
  label: string
  sessions: SessionMeta[]
}

export interface ContentSearchResult {
  matchCount: number
  snippet: string
}

export interface UseSessionSearchOptions {
  items: SessionMeta[]
  searchActive: boolean
  searchQuery: string
  workspaceId?: string
  currentFilter?: SessionFilter
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  statusFilter?: Map<string, FilterMode>
  labelFilterMap?: Map<string, FilterMode>
}

export interface UseSessionSearchResult {
  // Search state
  isSearchMode: boolean
  highlightQuery: string | undefined
  isSearchingContent: boolean
  /** Raw content search results — needed by SessionItem for `chatMatchCount` */
  contentSearchResults: Map<string, ContentSearchResult>

  // Filtered + grouped results
  matchingFilterItems: SessionMeta[]
  otherResultItems: SessionMeta[]
  exceededSearchLimit: boolean

  // Render-ready outputs
  flatItems: SessionMeta[]
  dateGroups: DateGroup[]
  sessionIndexMap: Map<string, number>
  childSessionsByParent: Map<string, SessionMeta[]>

  // Pagination
  hasMore: boolean
  sentinelRef: React.RefObject<HTMLDivElement>

  // Refs
  searchInputRef: React.RefObject<HTMLInputElement>
}

// ---------------------------------------------------------------------------
// Pure helpers (moved from SessionList)
// ---------------------------------------------------------------------------

function formatDateHeader(date: Date): string {
  if (isToday(date)) return "Today"
  if (isYesterday(date)) return "Yesterday"
  return format(date, "MMM d")
}

function groupSessionsByDate(sessions: SessionMeta[]): DateGroup[] {
  const groups = new Map<string, { date: Date; sessions: SessionMeta[] }>()

  for (const session of sessions) {
    const timestamp = session.lastMessageAt || 0
    const date = startOfDay(new Date(timestamp))
    const key = date.toISOString()

    if (!groups.has(key)) {
      groups.set(key, { date, sessions: [] })
    }
    groups.get(key)!.sessions.push(session)
  }

  return Array.from(groups.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map(group => ({
      ...group,
      label: formatDateHeader(group.date),
    }))
}

function sortChildSessions(children: SessionMeta[]): SessionMeta[] {
  const hasExplicitOrder = children.some(s => s.siblingOrder !== undefined)

  return [...children].sort((a, b) => {
    if (hasExplicitOrder) {
      return (a.siblingOrder ?? Number.POSITIVE_INFINITY) - (b.siblingOrder ?? Number.POSITIVE_INFINITY)
    }
    return (a.createdAt || 0) - (b.createdAt || 0)
  })
}

interface FilterMatchOptions {
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  statusFilter?: Map<string, 'include' | 'exclude'>
  labelFilterMap?: Map<string, 'include' | 'exclude'>
}

export function sessionMatchesCurrentFilter(
  session: SessionMeta,
  currentFilter: SessionFilter | undefined,
  options: FilterMatchOptions = {}
): boolean {
  const { evaluateViews, statusFilter, labelFilterMap } = options

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
      if (!session.labels?.length) return false
      if (session.isArchived === true) return false
      if (currentFilter.labelId === '__all__') return true
      const labelIds = session.labels.map(l => parseLabelEntry(l).id)
      return labelIds.includes(currentFilter.labelId)
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
}: UseSessionSearchOptions): UseSessionSearchResult {

  const [contentSearchResults, setContentSearchResults] = useState<Map<string, ContentSearchResult>>(new Map())
  const [isSearchingContent, setIsSearchingContent] = useState(false)
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

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
        console.error('[useSessionSearch] Content search error:', error)
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

  // Map parent session ID -> sorted child sessions
  const childSessionsByParent = useMemo(() => {
    const byParent = new Map<string, SessionMeta[]>()
    for (const session of visibleItems) {
      if (!session.parentSessionId) continue
      const current = byParent.get(session.parentSessionId) ?? []
      current.push(session)
      byParent.set(session.parentSessionId, current)
    }

    for (const [parentId, children] of byParent) {
      byParent.set(parentId, sortChildSessions(children))
    }

    return byParent
  }, [visibleItems])

  // Filter items by search query or current filter
  const searchFilteredItems = useMemo(() => {
    if (!isSearchMode) {
      return sortedItems.filter(item =>
        sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews, statusFilter, labelFilterMap })
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
  }, [sortedItems, isSearchMode, searchQuery, contentSearchResults, currentFilter, evaluateViews, statusFilter, labelFilterMap])

  // Normal mode: deduplicate child sessions shown via parent dropdowns
  const normalModeTopLevelItems = useMemo(() => {
    if (isSearchMode) return searchFilteredItems

    const presentIds = new Set(searchFilteredItems.map(item => item.id))
    return searchFilteredItems.filter(item => {
      if (!item.parentSessionId) return true
      return !presentIds.has(item.parentSessionId)
    })
  }, [isSearchMode, searchFilteredItems])

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

      const matches = sessionMatchesCurrentFilter(item, currentFilter, { evaluateViews, statusFilter, labelFilterMap })
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
  }, [searchFilteredItems, currentFilter, evaluateViews, isSearchMode, statusFilter, labelFilterMap, searchQuery])

  // --- Pagination ---

  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
  }, [searchQuery])

  const paginatedItems = useMemo(() => {
    const source = isSearchMode ? searchFilteredItems : normalModeTopLevelItems
    return source.slice(0, displayLimit)
  }, [isSearchMode, searchFilteredItems, normalModeTopLevelItems, displayLimit])

  const hasMore = displayLimit < (isSearchMode ? searchFilteredItems.length : normalModeTopLevelItems.length)

  const loadMore = useCallback(() => {
    const total = isSearchMode ? searchFilteredItems.length : normalModeTopLevelItems.length
    setDisplayLimit(prev => Math.min(prev + BATCH_SIZE, total))
  }, [isSearchMode, searchFilteredItems.length, normalModeTopLevelItems.length])

  useEffect(() => {
    if (!hasMore || !sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '100px' }
    )

    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [hasMore, loadMore, displayLimit])

  // --- Derived render data ---

  const dateGroups = useMemo(() => groupSessionsByDate(paginatedItems), [paginatedItems])

  const flatItems = useMemo(() => {
    if (isSearchMode) {
      return [...matchingFilterItems, ...otherResultItems]
    }
    return dateGroups.flatMap(group => group.sessions)
  }, [isSearchMode, matchingFilterItems, otherResultItems, dateGroups])

  const sessionIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatItems.forEach((item, index) => map.set(item.id, index))
    return map
  }, [flatItems])

  return {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    flatItems,
    dateGroups,
    sessionIndexMap,
    childSessionsByParent,
    hasMore,
    sentinelRef,
    searchInputRef,
  }
}
