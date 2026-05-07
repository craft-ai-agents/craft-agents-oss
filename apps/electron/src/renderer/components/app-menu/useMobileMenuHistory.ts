import { useEffect, useRef } from 'react'

interface Options {
  /** Whether the sheet is currently open. */
  isOpen: boolean
  /** Number of sub-pages on the stack ABOVE the root (root counts as 0). */
  subPageDepth: number
  /** Pop the topmost sub-page; called when user triggers browser back / swipe-back. */
  pop: () => void
  /** Close the entire sheet; called when user backs out from the root page. */
  close: () => void
}

const HISTORY_STATE_MARKER = 'craftMobileMenu'

/**
 * Bridges the mobile menu's nav stack with `window.history` so that
 * iOS Safari's edge-swipe-back gesture pops a sub-page instead of navigating
 * the whole tab away.
 *
 * Strategy:
 * 1. When the sheet opens, push one history entry tagged with our marker.
 * 2. Each time `subPageDepth` increases, push another tagged entry.
 * 3. On `popstate`, if we still have our markers in the previous state, pop
 *    locally instead of letting the browser unwind further. If the user
 *    arrived back at the entry that opened the sheet, close the sheet.
 *
 * We track every entry we pushed so closing the sheet via the X button can
 * unwind them with `history.back()` — otherwise the browser back button would
 * end up pointing at "menu open" entries that no longer correspond to UI state.
 */
export function useMobileMenuHistory({ isOpen, subPageDepth, pop, close }: Options): void {
  // Stable refs so the popstate listener doesn't churn on every render.
  const popRef = useRef(pop)
  const closeRef = useRef(close)
  popRef.current = pop
  closeRef.current = close

  // Number of history entries WE pushed. Always == 1 + subPageDepth while open.
  const pushedRef = useRef(0)
  // True while we're consuming our own pushes via history.back() (programmatic close).
  const unwindingRef = useRef(false)

  // Open / close → push or unwind the base entry.
  useEffect(() => {
    if (!isOpen) {
      // Sheet closed externally (programmatically or via close X) → unwind any pushed entries.
      if (pushedRef.current > 0) {
        unwindingRef.current = true
        for (let i = 0; i < pushedRef.current; i++) {
          window.history.back()
        }
        pushedRef.current = 0
        // Settle the flag on the next tick after popstate fires.
        setTimeout(() => { unwindingRef.current = false }, 0)
      }
      return
    }
    // Sheet just opened → push the base entry.
    window.history.pushState({ [HISTORY_STATE_MARKER]: true, depth: 0 }, '')
    pushedRef.current = 1
    return () => {
      // No-op on unmount: the !isOpen branch above (or popstate handler) already cleaned up.
    }
  }, [isOpen])

  // Sub-page depth changes → push or pop additional entries to stay in sync.
  useEffect(() => {
    if (!isOpen) return
    const expected = 1 + subPageDepth
    while (pushedRef.current < expected) {
      window.history.pushState(
        { [HISTORY_STATE_MARKER]: true, depth: pushedRef.current },
        '',
      )
      pushedRef.current += 1
    }
    while (pushedRef.current > expected) {
      // Programmatic pop (e.g. user tapped the back chevron) — unwind one entry.
      unwindingRef.current = true
      window.history.back()
      pushedRef.current -= 1
      setTimeout(() => { unwindingRef.current = false }, 0)
    }
  }, [isOpen, subPageDepth])

  // Listen for browser back / swipe-back gestures.
  useEffect(() => {
    const onPopstate = () => {
      if (unwindingRef.current) {
        // We initiated this popstate; ignore.
        return
      }
      if (pushedRef.current <= 0) return

      pushedRef.current -= 1
      if (pushedRef.current === 0) {
        // Last entry (the base) was popped → close the sheet entirely.
        closeRef.current()
      } else {
        // A sub-page entry was popped → drop the top of our local stack.
        popRef.current()
      }
    }
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [])
}
