import { useState, useCallback, useEffect, useMemo } from "react"
import { isToday, isYesterday, format, startOfDay } from "date-fns"
import { useAction } from "@/actions"
import { Inbox, Archive } from "lucide-react"

import type { LabelConfig } from "@craft-agent/shared/labels"
import { flattenLabels } from "@craft-agent/shared/labels"
import * as MultiSelect from "@/hooks/useMultiSelect"
import { Spinner } from "@craft-agent/ui"
import { EntityListEmptyScreen } from "@/components/ui/entity-list-empty"
import { EntityList, type EntityListGroup } from "@/components/ui/entity-list"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { SessionSearchHeader } from "./SessionSearchHeader"
import { SessionItem } from "./SessionItem"
import { SessionListProvider, type SessionListContextValue } from "@/context/SessionListContext"
import { useSessionSelection, useSessionSelectionStore } from "@/hooks/useSession"
import { useSessionSearch, type FilterMode } from "@/hooks/useSessionSearch"
import { useSessionActions } from "@/hooks/useSessionActions"
import { useEntityListInteractions } from "@/hooks/useEntityListInteractions"
import { useFocusZone } from "@/hooks/keyboard"
import { useEscapeInterrupt } from "@/context/EscapeInterruptContext"
import { useNavigation, useNavigationState, routes, isSessionsNavigation } from "@/contexts/NavigationContext"
import { useFocusContext } from "@/context/FocusContext"
import type { SessionMeta } from "@/atoms/sessions"
import type { ViewConfig } from "@craft-agent/shared/views"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import {
  buildSessionBlocks,
  flattenSessionBlocks,
  groupSearchBlocks,
  type SessionListRow,
} from "./session-list-hierarchy"

interface SessionListProps {
  items: SessionMeta[]
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onRename: (sessionId: string, name: string) => void
  /** Called when Enter is pressed to focus chat input */
  onFocusChatInput?: () => void
  /** Called when a session is selected */
  onSessionSelect?: (session: SessionMeta) => void
  /** Called when user wants to open a session in a new window */
  onOpenInNewWindow?: (session: SessionMeta) => void
  /** Called to navigate to a specific view (e.g., 'allSessions', 'flagged') */
  onNavigateToView?: (view: 'allSessions' | 'flagged') => void
  /** Unified session options per session (real-time state) */
  sessionOptions?: Map<string, import('../../hooks/useSessionOptions').SessionOptions>
  /** Whether search mode is active */
  searchActive?: boolean
  /** Current search query */
  searchQuery?: string
  /** Called when search query changes */
  onSearchChange?: (query: string) => void
  /** Called when search is closed */
  onSearchClose?: () => void
  /** Dynamic todo states from workspace config */
  sessionStatuses?: SessionStatus[]
  /** View evaluator — evaluates a session and returns matching view configs */
  evaluateViews?: (meta: SessionMeta) => ViewConfig[]
  /** Label configs for resolving session label IDs to display info */
  labels?: LabelConfig[]
  /** Callback when session labels are toggled (for labels submenu in SessionMenu) */
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Workspace ID for content search (optional - if not provided, content search is disabled) */
  workspaceId?: string
  /** Secondary status filter (status chips in "All Sessions" view) - for search result grouping */
  statusFilter?: Map<string, FilterMode>
  /** Secondary label filter (label chips) - for search result grouping */
  labelFilterMap?: Map<string, FilterMode>
  /** Override which session is highlighted (for multi-panel focused panel tracking) */
  focusedSessionId?: string | null
  /** Override navigation target (for multi-panel: focuses existing panel or navigates focused panel) */
  onNavigateToSession?: (sessionId: string) => void
}

// Re-export SessionStatusId for use by parent components
export type { SessionStatusId }

function formatDateGroupLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMM d')
}

/**
 * SessionList - Scrollable list of session cards with keyboard navigation
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Navigate and select sessions (immediate selection)
 * - Arrow Left/Right: Navigate between zones
 * - Enter: Focus chat input
 * - Home/End: Jump to first/last session
 */
export function SessionList({
  items,
  onDelete,
  onFlag,
  onUnflag,
  onArchive,
  onUnarchive,
  onMarkUnread,
  onSessionStatusChange,
  onRename,
  onFocusChatInput,
  onOpenInNewWindow,
  sessionOptions,
  searchActive,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  sessionStatuses = [],
  evaluateViews,
  labels = [],
  onLabelsChange,
  workspaceId,
  statusFilter,
  labelFilterMap,
  focusedSessionId,
  onNavigateToSession,
}: SessionListProps) {
  // --- Selection (atom-backed, shared with ChatDisplay + BatchActionPanel) ---
  const {
    select: selectSession,
    toggle: toggleSession,
    selectRange,
    isMultiSelectActive,
  } = useSessionSelection()
  const selectionStore = useSessionSelectionStore()

  const { navigate, navigateToSession: navigateToSessionPrimary } = useNavigation()
  const navigateToSession = onNavigateToSession ?? navigateToSessionPrimary
  const navState = useNavigationState()
  const { showEscapeOverlay } = useEscapeInterrupt()

  // Pre-flatten label tree once for efficient ID lookups in each SessionItem
  const flatLabels = useMemo(() => flattenLabels(labels), [labels])

  // Get current filter from navigation state (for preserving context in tab routes)
  const currentFilter = isSessionsNavigation(navState) ? navState.filter : undefined

  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null)
  const [renameName, setRenameName] = useState("")
  const [expandedParentIds, setExpandedParentIds] = useState<Set<string>>(new Set())
  const [collapsedForcedParentIds, setCollapsedForcedParentIds] = useState<Set<string>>(new Set())
  // Track if search input has actual DOM focus (for proper keyboard navigation gating)
  const [isSearchInputFocused, setIsSearchInputFocused] = useState(false)

  // --- Data pipeline (search, filtering, pagination, grouping) ---
  const {
    isSearchMode,
    highlightQuery,
    isSearchingContent,
    contentSearchResults,
    matchingFilterItems,
    otherResultItems,
    exceededSearchLimit,
    flatItems,
    childSessionsByParent,
    hasMore,
    sentinelRef,
    searchInputRef,
  } = useSessionSearch({
    items,
    searchActive: searchActive ?? false,
    searchQuery,
    workspaceId,
    currentFilter,
    evaluateViews,
    statusFilter,
    labelFilterMap,
  })

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionMeta>()
    for (const item of items) {
      if (!item.hidden) {
        map.set(item.id, item)
      }
    }
    return map
  }, [items])

  const candidateItems = useMemo(
    () => (isSearchMode ? [...matchingFilterItems, ...otherResultItems] : flatItems),
    [isSearchMode, matchingFilterItems, otherResultItems, flatItems]
  )

  const hierarchy = useMemo(
    () => buildSessionBlocks({
      orderedItems: candidateItems,
      sessionById,
      childSessionsByParent,
      childVisibility: isSearchMode ? 'candidate-only' : 'all',
    }),
    [candidateItems, sessionById, childSessionsByParent, isSearchMode]
  )

  const matchingSessionIds = useMemo(
    () => new Set(matchingFilterItems.map(item => item.id)),
    [matchingFilterItems]
  )

  const selectedChildParentId = useMemo(() => {
    const selectedId = selectionStore.state.selected
    if (!selectedId) return null
    return sessionById.get(selectedId)?.parentSessionId ?? null
  }, [selectionStore.state.selected, sessionById])

  useEffect(() => {
    setCollapsedForcedParentIds((prev) => {
      const next = new Set<string>()
      for (const parentId of prev) {
        if (hierarchy.parentIdsWithCandidateChildren.has(parentId)) {
          next.add(parentId)
        }
      }
      return next
    })
  }, [hierarchy.parentIdsWithCandidateChildren])

  const forcedMatchExpandedParentIds = useMemo(() => {
    const forced = new Set<string>()
    for (const parentId of hierarchy.parentIdsWithCandidateChildren) {
      if (!collapsedForcedParentIds.has(parentId)) {
        forced.add(parentId)
      }
    }
    return forced
  }, [hierarchy.parentIdsWithCandidateChildren, collapsedForcedParentIds])

  const forcedExpandedParentIds = useMemo(() => {
    const forced = new Set<string>(forcedMatchExpandedParentIds)
    if (selectedChildParentId) {
      forced.add(selectedChildParentId)
    }
    return forced
  }, [forcedMatchExpandedParentIds, selectedChildParentId])

  const rowData = useMemo(() => {
    if (isSearchMode) {
      const groupedBlocks = groupSearchBlocks(hierarchy.blocks, matchingSessionIds)
      const matchingRows = flattenSessionBlocks({
        blocks: groupedBlocks.matching,
        expandedParentIds,
        forcedExpandedParentIds,
      })
      const otherRows = flattenSessionBlocks({
        blocks: groupedBlocks.other,
        expandedParentIds,
        forcedExpandedParentIds,
      })

      const visibleChildIdsByParent = new Map<string, string[]>()
      for (const [parentId, ids] of matchingRows.visibleChildIdsByParent) {
        visibleChildIdsByParent.set(parentId, ids)
      }
      for (const [parentId, ids] of otherRows.visibleChildIdsByParent) {
        visibleChildIdsByParent.set(parentId, ids)
      }

      const groups: EntityListGroup<SessionListRow>[] = []
      if (matchingRows.rows.length > 0) {
        groups.push({ key: 'matching', label: 'In Current View', items: matchingRows.rows })
      }
      if (otherRows.rows.length > 0) {
        groups.push({ key: 'other', label: 'Other Conversations', items: otherRows.rows })
      }

      return {
        rows: [...matchingRows.rows, ...otherRows.rows],
        groups,
        visibleChildIdsByParent,
      }
    }

    const flattened = flattenSessionBlocks({
      blocks: hierarchy.blocks,
      expandedParentIds,
      forcedExpandedParentIds,
    })

    const groupsByKey = new Map<string, EntityListGroup<SessionListRow>>()
    const orderedGroups: EntityListGroup<SessionListRow>[] = []
    let currentGroupKey: string | null = null

    for (const row of flattened.rows) {
      if (row.depth === 0) {
        const day = startOfDay(new Date(row.item.lastMessageAt || 0))
        currentGroupKey = day.toISOString()

        if (!groupsByKey.has(currentGroupKey)) {
          const group: EntityListGroup<SessionListRow> = {
            key: currentGroupKey,
            label: formatDateGroupLabel(day),
            items: [],
          }
          groupsByKey.set(currentGroupKey, group)
          orderedGroups.push(group)
        }
      }

      if (!currentGroupKey) continue
      groupsByKey.get(currentGroupKey)?.items.push(row)
    }

    return {
      rows: flattened.rows,
      groups: orderedGroups,
      visibleChildIdsByParent: flattened.visibleChildIdsByParent,
    }
  }, [
    isSearchMode,
    hierarchy.blocks,
    matchingSessionIds,
    expandedParentIds,
    forcedExpandedParentIds,
  ])

  const flatRows = rowData.rows

  const rowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    flatRows.forEach((row, index) => {
      map.set(row.item.id, index)
    })
    return map
  }, [flatRows])

  const handleToggleChildren = useCallback((parentId: string) => {
    const isExpanded = expandedParentIds.has(parentId) || forcedExpandedParentIds.has(parentId)

    if (!isExpanded) {
      setCollapsedForcedParentIds((prev) => {
        if (!prev.has(parentId)) return prev
        const next = new Set(prev)
        next.delete(parentId)
        return next
      })
      setExpandedParentIds((prev) => {
        const next = new Set(prev)
        next.add(parentId)
        return next
      })
      return
    }

    if (forcedMatchExpandedParentIds.has(parentId)) {
      setCollapsedForcedParentIds((prev) => {
        if (prev.has(parentId)) return prev
        const next = new Set(prev)
        next.add(parentId)
        return next
      })
    }

    const hiddenChildIds = rowData.visibleChildIdsByParent.get(parentId) ?? []
    const selectedId = selectionStore.state.selected
    const selectedWillBeHidden = selectedId ? hiddenChildIds.includes(selectedId) : false

    if (hiddenChildIds.length > 0) {
      selectionStore.setState((prev) => {
        const hasHiddenSelection = hiddenChildIds.some(id => prev.selectedIds.has(id))
        if (!hasHiddenSelection) return prev

        const stripped = MultiSelect.removeFromSelection(prev, hiddenChildIds)
        if (!selectedWillBeHidden) {
          return stripped
        }

        const selectedIds = new Set(stripped.selectedIds)
        selectedIds.add(parentId)

        return {
          selected: parentId,
          selectedIds,
          anchorId: parentId,
          anchorIndex: rowIndexMap.get(parentId) ?? 0,
        }
      })

      if (selectedWillBeHidden) {
        navigateToSession(parentId)
      }
    }

    setExpandedParentIds((prev) => {
      if (!prev.has(parentId)) return prev
      const next = new Set(prev)
      next.delete(parentId)
      return next
    })
  }, [
    expandedParentIds,
    forcedExpandedParentIds,
    forcedMatchExpandedParentIds,
    rowData.visibleChildIdsByParent,
    selectionStore,
    rowIndexMap,
    navigateToSession,
  ])

  // --- Action handlers with toast feedback ---
  const {
    handleFlagWithToast,
    handleUnflagWithToast,
    handleArchiveWithToast,
    handleUnarchiveWithToast,
    handleDeleteWithToast,
  } = useSessionActions({ onFlag, onUnflag, onArchive, onUnarchive, onDelete })

  // --- Focus zone ---
  const { focusZone } = useFocusContext()
  const { zoneRef, isFocused, shouldMoveDOMFocus } = useFocusZone({ zoneId: 'navigator' })

  // Keyboard eligibility: zone-focused OR search input focused (for arrow navigation)
  const isKeyboardEligible = isFocused || (searchActive && isSearchInputFocused)

  // --- Interactions (keyboard navigation + selection via shared atom) ---
  const interactions = useEntityListInteractions<SessionListRow>({
    items: flatRows,
    getId: (row) => row.item.id,
    keyboard: {
      onNavigate: useCallback((row: SessionListRow) => {
        navigateToSession(row.item.id)
      }, [navigateToSession]),
      onActivate: useCallback((row: SessionListRow) => {
        // Only navigate when not in multi-select (matches original behavior)
        if (!MultiSelect.isMultiSelectActive(selectionStore.state)) {
          navigateToSession(row.item.id)
        }
        onFocusChatInput?.()
      }, [selectionStore.state, navigateToSession, onFocusChatInput]),
      enabled: isKeyboardEligible,
      virtualFocus: searchActive ?? false,
    },
    multiSelect: true,
    selectionStore,
    selectedIdOverride: focusedSessionId,
  })

  // Sync activeIndex when selection changes externally (e.g. from ChatDisplay)
  useEffect(() => {
    const newIndex = flatRows.findIndex(row => row.item.id === selectionStore.state.selected)
    if (newIndex >= 0 && newIndex !== interactions.keyboard.activeIndex) {
      interactions.keyboard.setActiveIndex(newIndex)
    }
  }, [selectionStore.state.selected, flatRows, interactions.keyboard])

  // Focus active item when zone gains keyboard focus
  useEffect(() => {
    if (shouldMoveDOMFocus && flatRows.length > 0 && !(searchActive ?? false)) {
      interactions.keyboard.focusActiveItem()
    }
  }, [shouldMoveDOMFocus, flatRows.length, searchActive, interactions.keyboard])

  // --- Global keyboard shortcuts ---
  const isFocusWithinZone = () => zoneRef.current?.contains(document.activeElement) ?? false

  useAction('navigator.selectAll', () => {
    interactions.selection.selectAll()
  }, {
    enabled: isFocusWithinZone,
  }, [interactions.selection])

  useAction('navigator.clearSelection', () => {
    const selectedId = selectionStore.state.selected
    interactions.selection.clear()
    if (selectedId) navigateToSession(selectedId)
  }, {
    enabled: () => isMultiSelectActive && !showEscapeOverlay,
  }, [isMultiSelectActive, showEscapeOverlay, interactions.selection, selectionStore.state.selected, navigateToSession])

  // --- Click handlers ---
  const handleSelectSession = useCallback((row: SessionListRow, index: number) => {
    selectSession(row.item.id, index)
    navigateToSession(row.item.id)
  }, [selectSession, navigateToSession])

  const handleSelectSessionById = useCallback((sessionId: string) => {
    const index = rowIndexMap.get(sessionId) ?? -1
    if (index >= 0) {
      selectSession(sessionId, index)
    } else {
      selectSession(sessionId, 0)
    }
    navigateToSession(sessionId)
  }, [rowIndexMap, selectSession, navigateToSession])

  const handleToggleSelect = useCallback((row: SessionListRow, index: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    toggleSession(row.item.id, index)
  }, [focusZone, toggleSession])

  const handleRangeSelect = useCallback((toIndex: number) => {
    focusZone('navigator', { intent: 'click', moveFocus: false })
    const allIds = flatRows.map(row => row.item.id)
    selectRange(toIndex, allIds)
  }, [focusZone, flatRows, selectRange])

  // Arrow key shortcuts for zone navigation (left → sidebar, right → chat)
  const handleKeyDown = useCallback((e: React.KeyboardEvent, _item: SessionMeta) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focusZone('sidebar', { intent: 'keyboard' })
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      focusZone('chat', { intent: 'keyboard' })
      return
    }
  }, [focusZone])

  // --- Rename dialog ---
  const handleRenameClick = useCallback((sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId)
    setRenameName(currentName)
    requestAnimationFrame(() => {
      setRenameDialogOpen(true)
    })
  }, [])

  const handleRenameSubmit = () => {
    if (renameSessionId && renameName.trim()) {
      onRename(renameSessionId, renameName.trim())
    }
    setRenameDialogOpen(false)
    setRenameSessionId(null)
    setRenameName("")
  }

  // --- Search input key handler ---
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      searchInputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onFocusChatInput?.()
      return
    }
    // Forward arrow keys via interactions
    interactions.searchInputProps.onKeyDown(e)
  }, [searchInputRef, onFocusChatInput, interactions.searchInputProps])

  // --- Context value (shared across all SessionItems) ---
  const handleFocusZone = useCallback(() => focusZone('navigator', { intent: 'click', moveFocus: false }), [focusZone])
  const handleOpenInNewWindow = useCallback((item: SessionMeta) => onOpenInNewWindow?.(item), [onOpenInNewWindow])
  const resolvedSearchQuery = isSearchMode ? highlightQuery : searchQuery

  const listContext = useMemo((): SessionListContextValue => ({
    onRenameClick: handleRenameClick,
    onSessionStatusChange,
    onFlag: onFlag ? handleFlagWithToast : undefined,
    onUnflag: onUnflag ? handleUnflagWithToast : undefined,
    onArchive: onArchive ? handleArchiveWithToast : undefined,
    onUnarchive: onUnarchive ? handleUnarchiveWithToast : undefined,
    onMarkUnread,
    onDelete: handleDeleteWithToast,
    onLabelsChange,
    onSelectSessionById: handleSelectSessionById,
    onOpenInNewWindow: handleOpenInNewWindow,
    onFocusZone: handleFocusZone,
    onKeyDown: handleKeyDown,
    sessionStatuses,
    flatLabels,
    labels,
    searchQuery: resolvedSearchQuery,
    selectedSessionId: focusedSessionId !== undefined ? focusedSessionId : selectionStore.state.selected,
    isMultiSelectActive,
    sessionOptions,
    contentSearchResults,
  }), [
    handleRenameClick, onSessionStatusChange,
    onFlag, handleFlagWithToast, onUnflag, handleUnflagWithToast,
    onArchive, handleArchiveWithToast, onUnarchive, handleUnarchiveWithToast,
    onMarkUnread, handleDeleteWithToast, onLabelsChange,
    handleSelectSessionById, handleOpenInNewWindow, handleFocusZone, handleKeyDown,
    sessionStatuses, flatLabels, labels, resolvedSearchQuery,
    focusedSessionId, selectionStore.state.selected, isMultiSelectActive,
    sessionOptions, contentSearchResults,
  ])

  // --- Empty state (non-search) — render before EntityList ---
  if (flatRows.length === 0 && !searchActive) {
    if (currentFilter?.kind === 'archived') {
      return (
        <EntityListEmptyScreen
          icon={<Archive />}
          title="No archived sessions"
          description="Sessions you archive will appear here. Archive sessions to keep your list tidy while preserving conversations."
          className="h-full"
        />
      )
    }

    return (
      <EntityListEmptyScreen
        icon={<Inbox />}
        title="No sessions yet"
        description="Sessions with your agent appear here. Start one to get going."
        className="h-full"
      >
        <button
          onClick={() => {
            const params: { status?: string; label?: string } = {}
            if (currentFilter?.kind === 'state') params.status = currentFilter.stateId
            else if (currentFilter?.kind === 'label') params.label = currentFilter.labelId
            navigate(routes.action.newSession(Object.keys(params).length > 0 ? params : undefined))
          }}
          className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
        >
          New Session
        </button>
      </EntityListEmptyScreen>
    )
  }

  // --- Render ---
  return (
    <div className="flex flex-col h-screen">
      <SessionListProvider value={listContext}>
      <EntityList<SessionListRow>
        groups={rowData.groups}
        getKey={(row) => row.item.id}
        renderItem={(row, _indexInGroup, isFirstInGroup) => {
          const flatIndex = rowIndexMap.get(row.item.id) ?? 0
          const rowProps = interactions.getRowProps(row, flatIndex)
          return (
            <SessionItem
              item={row.item}
              index={flatIndex}
              itemProps={rowProps.buttonProps as Record<string, unknown>}
              isSelected={rowProps.isSelected}
              isFirstInGroup={isFirstInGroup}
              isInMultiSelect={rowProps.isInMultiSelect ?? false}
              depth={row.depth}
              childCount={row.childCount}
              isParentExpanded={row.isParentExpanded}
              isFirstChild={row.isFirstChild}
              isLastChild={row.isLastChild}
              onToggleChildren={row.depth === 0 && row.childCount > 0 ? () => handleToggleChildren(row.item.id) : undefined}
              onSelect={() => handleSelectSession(row, flatIndex)}
              onToggleSelect={() => handleToggleSelect(row, flatIndex)}
              onRangeSelect={() => handleRangeSelect(flatIndex)}
            />
          )
        }}
        header={
          <>
            {searchActive && (
              <SessionSearchHeader
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                onSearchClose={onSearchClose}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setIsSearchInputFocused(true)}
                onBlur={() => setIsSearchInputFocused(false)}
                isSearching={isSearchingContent}
                resultCount={matchingFilterItems.length + otherResultItems.length}
                exceededLimit={exceededSearchLimit}
                inputRef={searchInputRef}
              />
            )}
            {isSearchMode && matchingFilterItems.length === 0 && otherResultItems.length > 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                No results in current filter
              </div>
            )}
          </>
        }
        emptyState={
          isSearchMode && !isSearchingContent ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <p className="text-sm text-muted-foreground">No sessions found</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Searched titles and message content
              </p>
              <button
                onClick={() => onSearchChange?.('')}
                className="text-xs text-foreground hover:underline mt-2"
              >
                Clear search
              </button>
            </div>
          ) : undefined
        }
        footer={
          hasMore ? (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Spinner className="text-muted-foreground" />
            </div>
          ) : undefined
        }
        containerRef={zoneRef}
        containerProps={{
          'data-focus-zone': 'navigator',
          role: 'listbox',
          'aria-label': 'Sessions',
        }}
        scrollAreaClassName="select-none mask-fade-top-short"
      />
      </SessionListProvider>

      {/* Rename Dialog */}
      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title="Rename Session"
        value={renameName}
        onValueChange={setRenameName}
        onSubmit={handleRenameSubmit}
        placeholder="Enter session name..."
      />
    </div>
  )
}
