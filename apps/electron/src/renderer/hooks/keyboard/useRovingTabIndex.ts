import { useState, useCallback, useRef, useEffect } from "react"

interface UseRovingTabIndexOptions<T> {
  /** List of items to navigate */
  items: T[]
  /** Get unique ID for each item (item, index) => id */
  getId: (item: T, index: number) => string
  /** Navigation direction (affects arrow key behavior) */
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Wrap around at ends */
  wrap?: boolean
  /** Called when active item changes (immediate selection) */
  onActiveChange?: (item: T, index: number) => void
  /** Called when Enter is pressed on active item */
  onEnter?: (item: T, index: number) => void
  /** Called when Delete/Backspace is pressed */
  onDelete?: (item: T, index: number) => void
  /** Initial active index */
  initialIndex?: number
  /** Whether navigation is enabled (typically when zone is focused) */
  enabled?: boolean
  /** Called to open context menu on focused item */
  onContextMenu?: (item: T, index: number, element: HTMLElement) => void
  /** Whether to move focus to items on navigation (default: true). Set false to keep focus elsewhere (e.g., search input) */
  moveFocus?: boolean
}

interface UseRovingTabIndexReturn<T> {
  /** Currently active index */
  activeIndex: number
  /** Set active index programmatically */
  setActiveIndex: (index: number) => void
  /** Get props to spread on each item */
  getItemProps: (item: T, index: number) => {
    id: string
    tabIndex: number
    ref: (el: HTMLElement | null) => void
    onKeyDown: (e: React.KeyboardEvent) => void
    onFocus: () => void
    onClick: () => void
    'aria-selected': boolean
    role: string
  }
  /** Get props for the container */
  getContainerProps: () => {
    role: string
    'aria-activedescendant': string | undefined
    onKeyDown: (e: React.KeyboardEvent) => void
  }
  /** Focus the currently active item */
  focusActiveItem: () => void
}

/**
 * Implements roving tabindex pattern for list navigation.
 *
 * Features:
 * - Only active item has tabIndex=0, others have tabIndex=-1
 * - Arrow keys navigate and immediately select (onActiveChange)
 * - Tab exits the list to next zone
 * - Enter triggers onEnter callback
 * - Home/End jump to first/last item
 * - Context menu key (or Shift+F10) opens context menu
 */
export function useRovingTabIndex<T>({
  items,
  getId,
  orientation = 'vertical',
  wrap = true,
  onActiveChange,
  onEnter,
  onDelete,
  initialIndex = 0,
  enabled = true,
  onContextMenu,
  moveFocus = true,
}: UseRovingTabIndexOptions<T>): UseRovingTabIndexReturn<T> {
  const [activeIndex, setActiveIndexState] = useState(() =>
    Math.min(initialIndex, Math.max(0, items.length - 1))
  )
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map())

  // Reset active index if items change and current index is out of bounds
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndexState(0)
    } else if (activeIndex >= items.length) {
      const newIndex = Math.max(0, items.length - 1)
      setActiveIndexState(newIndex)
      onActiveChange?.(items[newIndex], newIndex)
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveIndex = useCallback((index: number) => {
    if (index >= 0 && index < items.length) {
      setActiveIndexState(index)
      onActiveChange?.(items[index], index)
    }
  }, [items, onActiveChange])

  const focusActiveItem = useCallback(() => {
    const item = items[activeIndex]
    if (item) {
      const id = getId(item, activeIndex)
      const element = itemRefs.current.get(id)
      element?.focus()
    }
  }, [activeIndex, items, getId])

  const navigateToIndex = useCallback((nextIndex: number) => {
    if (nextIndex >= 0 && nextIndex < items.length && nextIndex !== activeIndex) {
      setActiveIndexState(nextIndex)
      onActiveChange?.(items[nextIndex], nextIndex)
      // Focus new item after state update (unless moveFocus is false)
      if (moveFocus) {
        requestAnimationFrame(() => {
          const id = getId(items[nextIndex], nextIndex)
          itemRefs.current.get(id)?.focus()
        })
      }
    }
  }, [items, activeIndex, getId, onActiveChange, moveFocus])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!enabled || items.length === 0) return

    const isVertical = orientation === 'vertical' || orientation === 'both'
    const isHorizontal = orientation === 'horizontal' || orientation === 'both'

    let nextIndex = activeIndex
    let handled = false

    switch (e.key) {
      case 'ArrowDown':
        if (isVertical) {
          nextIndex = wrap
            ? (activeIndex + 1) % items.length
            : Math.min(activeIndex + 1, items.length - 1)
          handled = true
        }
        break

      case 'ArrowUp':
        if (isVertical) {
          nextIndex = wrap
            ? (activeIndex - 1 + items.length) % items.length
            : Math.max(activeIndex - 1, 0)
          handled = true
        }
        break

      case 'ArrowRight':
        if (isHorizontal) {
          nextIndex = wrap
            ? (activeIndex + 1) % items.length
            : Math.min(activeIndex + 1, items.length - 1)
          handled = true
        }
        break

      case 'ArrowLeft':
        if (isHorizontal) {
          nextIndex = wrap
            ? (activeIndex - 1 + items.length) % items.length
            : Math.max(activeIndex - 1, 0)
          handled = true
        }
        break

      case 'Home':
        nextIndex = 0
        handled = true
        break

      case 'End':
        nextIndex = items.length - 1
        handled = true
        break

      case 'Enter':
        e.preventDefault()
        onEnter?.(items[activeIndex], activeIndex)
        handled = true
        break

      case 'Delete':
      case 'Backspace':
        if (onDelete) {
          e.preventDefault()
          onDelete(items[activeIndex], activeIndex)
          handled = true
        }
        break

      // Context menu via keyboard (F10 or ContextMenu key)
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) break // Only Shift+F10 triggers context menu
        if (onContextMenu) {
          e.preventDefault()
          const item = items[activeIndex]
          const id = getId(item, activeIndex)
          const element = itemRefs.current.get(id)
          if (element) {
            onContextMenu(item, activeIndex, element)
          }
          handled = true
        }
        break
    }

    if (handled) {
      e.preventDefault()
      e.stopPropagation()
      if (nextIndex !== activeIndex) {
        navigateToIndex(nextIndex)
      }
    }
  }, [enabled, items, activeIndex, orientation, wrap, onEnter, onDelete, onContextMenu, getId, navigateToIndex])

  const getItemProps = useCallback((item: T, index: number) => {
    const id = getId(item, index)
    const isActive = index === activeIndex

    return {
      id: `item-${id}`,
      tabIndex: isActive ? 0 : -1,
      ref: (el: HTMLElement | null) => {
        if (el) {
          itemRefs.current.set(id, el)
        } else {
          itemRefs.current.delete(id)
        }
      },
      onKeyDown: handleKeyDown,
      onFocus: () => {
        // Sync active index when item is focused (e.g., via tab navigation)
        if (index !== activeIndex) {
          setActiveIndexState(index)
          onActiveChange?.(item, index)
        }
      },
      onClick: () => {
        // Always trigger selection on click, even if already active
        setActiveIndexState(index)
        onActiveChange?.(item, index)
      },
      'aria-selected': isActive,
      role: 'option' as const,
    }
  }, [activeIndex, getId, handleKeyDown, onActiveChange])

  const getContainerProps = useCallback(() => ({
    role: 'listbox' as const,
    'aria-activedescendant': items[activeIndex] ? `item-${getId(items[activeIndex], activeIndex)}` : undefined,
    onKeyDown: handleKeyDown,
  }), [items, activeIndex, getId, handleKeyDown])

  return {
    activeIndex,
    setActiveIndex,
    getItemProps,
    getContainerProps,
    focusActiveItem,
  }
}
