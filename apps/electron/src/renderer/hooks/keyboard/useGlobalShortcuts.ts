import { useEffect, useRef } from "react"
import { isMac } from "@/lib/platform"

interface Shortcut {
  /** Key to match (e.g., '1', 'n', 'b', '/') */
  key: string
  /** Require Cmd (Mac) / Ctrl (Windows/Linux) */
  cmd?: boolean
  /** Require Shift */
  shift?: boolean
  /** Require Alt/Option */
  alt?: boolean
  /** Action to perform */
  action: () => void
  /** Optional condition - shortcut only works when this returns true */
  when?: () => boolean
}

interface UseGlobalShortcutsOptions {
  /** List of shortcuts to register */
  shortcuts: Shortcut[]
  /** Disable all shortcuts (e.g., when modal is open) */
  disabled?: boolean
}

/**
 * Hook for registering global keyboard shortcuts.
 * Shortcuts work anywhere in the app unless disabled.
 *
 * Note: Shortcuts with cmd modifier use Cmd on Mac, Ctrl on Windows/Linux.
 */
export function useGlobalShortcuts({ shortcuts, disabled = false }: UseGlobalShortcutsOptions) {
  // Use ref to avoid recreating handler on shortcut changes
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return

      // Don't trigger shortcuts when typing in inputs (unless it's a meta shortcut)
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable

      const cmdKey = isMac ? e.metaKey : e.ctrlKey

      for (const shortcut of shortcutsRef.current) {
        // Check modifiers
        const cmdMatch = shortcut.cmd ? cmdKey : !cmdKey
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey
        const altMatch = shortcut.alt ? e.altKey : !e.altKey

        // Check key (case-insensitive)
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (cmdMatch && shiftMatch && altMatch && keyMatch) {
          // Skip non-meta shortcuts in inputs, EXCEPT Tab (zone navigation) and Escape (cancel)
          const isTabKey = e.key.toLowerCase() === 'tab'
          const isEscapeKey = e.key.toLowerCase() === 'escape'
          if (isInput && !shortcut.cmd && !isTabKey && !isEscapeKey) continue

          // Check condition
          if (shortcut.when && !shortcut.when()) continue

          e.preventDefault()
          e.stopPropagation()
          shortcut.action()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])
}

/**
 * Helper to create a shortcut definition
 */
export function shortcut(
  key: string,
  action: () => void,
  options?: { cmd?: boolean; shift?: boolean; alt?: boolean; when?: () => boolean }
): Shortcut {
  return { key, action, ...options }
}
