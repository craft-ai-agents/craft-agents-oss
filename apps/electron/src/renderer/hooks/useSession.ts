import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import {
  type MultiSelectState,
  createInitialState,
  singleSelect,
  toggleSelect,
  rangeSelect,
  selectAll,
  clearMultiSelect,
  removeFromSelection,
  isMultiSelectActive,
  getSelectionCount,
  isItemSelected,
} from './useMultiSelect'

/**
 * Session selection atom - manages both single and multi-select state.
 *
 * The state includes:
 * - selected: The currently active/focused session ID
 * - selectedIds: Set of all selected session IDs (for multi-select)
 * - anchorId/anchorIndex: For shift+click range selection
 */
const sessionSelectionAtom = atom<MultiSelectState>(createInitialState())

/**
 * Legacy type alias for backward compatibility
 */
type Config = {
  selected: string | null
}

/**
 * Legacy hook - maintains backward compatibility with existing code.
 * Returns [{ selected }, setSession] tuple.
 *
 * @deprecated Use useSessionSelection() for full multi-select support
 */
export function useSession(): [Config, (config: Config) => void] {
  const [state, setState] = useAtom(sessionSelectionAtom)

  const legacySetSession = useCallback((config: Config) => {
    if (config.selected === null) {
      setState(createInitialState())
    } else {
      // When using legacy setter, treat it as single select
      // We don't know the index, so we set it to -1 (will be updated on next interaction)
      setState(singleSelect(config.selected, -1))
    }
  }, [setState])

  // Return legacy-compatible shape
  return [{ selected: state.selected }, legacySetSession]
}

/**
 * Full multi-select hook - provides complete control over selection state.
 */
export function useSessionSelection() {
  const [state, setState] = useAtom(sessionSelectionAtom)

  const actions = useMemo(() => ({
    /**
     * Single select - clears multi-select and selects one item
     */
    select: (id: string, index: number) => {
      setState(singleSelect(id, index))
    },

    /**
     * Toggle select - add/remove item from selection (cmd/ctrl+click)
     */
    toggle: (id: string, index: number) => {
      setState(prev => toggleSelect(prev, id, index))
    },

    /**
     * Range select - select all items between anchor and target (shift+click)
     */
    selectRange: (toIndex: number, items: string[]) => {
      setState(prev => rangeSelect(prev, toIndex, items))
    },

    /**
     * Select all items
     */
    selectAll: (items: string[]) => {
      setState(selectAll(items))
    },

    /**
     * Clear multi-select, keeping only the active item
     */
    clearMultiSelect: () => {
      setState(prev => clearMultiSelect(prev))
    },

    /**
     * Remove items from selection (when items are deleted)
     */
    removeFromSelection: (ids: string[]) => {
      setState(prev => removeFromSelection(prev, ids))
    },

    /**
     * Reset to initial empty state
     */
    reset: () => {
      setState(createInitialState())
    },
  }), [setState])

  return {
    state,
    ...actions,
    isMultiSelectActive: isMultiSelectActive(state),
    selectionCount: getSelectionCount(state),
    isSelected: (id: string) => isItemSelected(state, id),
  }
}

/**
 * Explicit select mode atom — toggled via UI button.
 * When true, checkboxes appear on all sessions.
 */
const selectModeAtom = atom(false)

/**
 * Hook for managing explicit select mode (checkbox UI).
 * Separate from multi-select state — select mode shows checkboxes,
 * while multi-select tracks actual selections.
 */
export function useSelectMode() {
  const [selectMode, setSelectMode] = useAtom(selectModeAtom)
  return {
    selectMode,
    enterSelectMode: useCallback(() => setSelectMode(true), [setSelectMode]),
    exitSelectMode: useCallback(() => setSelectMode(false), [setSelectMode]),
    toggleSelectMode: useCallback(() => setSelectMode(p => !p), [setSelectMode]),
  }
}

/**
 * Read-only hook for checking if multi-select is active
 */
export function useIsMultiSelectActive(): boolean {
  const state = useAtomValue(sessionSelectionAtom)
  return isMultiSelectActive(state)
}

/**
 * Read-only hook for getting selected IDs
 */
export function useSelectedIds(): Set<string> {
  const state = useAtomValue(sessionSelectionAtom)
  return state.selectedIds
}

/**
 * Read-only hook for getting selection count
 */
export function useSelectionCount(): number {
  const state = useAtomValue(sessionSelectionAtom)
  return getSelectionCount(state)
}
