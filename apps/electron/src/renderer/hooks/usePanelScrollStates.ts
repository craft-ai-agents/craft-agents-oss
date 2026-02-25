/**
 * usePanelScrollStates
 *
 * Monitors horizontal scroll position of the panel stack container
 * and computes a visual state for each panel:
 *
 * - "resting": Panel is fully visible at its natural flex position
 * - "overlay": Panel is overlapping a previous panel (sticky active), gets box-shadow
 * - "obscured": Panel is scrolled past, only the peek strip (vertical label) is visible
 *
 * Supports variable-width panels (sidebar, navigator have different widths
 * than content panels). Threshold calculations use cumulative widths.
 *
 * Based on the Andy Matuschak stacked notes scroll state machine.
 */

import { useState, useEffect, useCallback, type RefObject } from 'react'

export type PanelScrollState = 'resting' | 'overlay' | 'obscured'

/** Default content panel width in px */
export const PANEL_WIDTH = 625
/** Width of the peek strip when a panel is pinned/obscured */
export const PEEK_WIDTH = 40
/** Minimum width for any stacked panel */
export const PANEL_MIN_WIDTH = 440

function arraysEqual(a: PanelScrollState[], b: PanelScrollState[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Compute scroll states for a set of variable-width panels.
 *
 * @param scrollRef - Ref to the horizontal scroll container
 * @param panelWidths - Array of pixel widths for each panel in order
 *   e.g. [sidebarWidth, navigatorWidth, 625, 625]
 */
export function usePanelScrollStates(
  scrollRef: RefObject<HTMLDivElement | null>,
  panelWidths: number[]
): PanelScrollState[] {
  const [states, setStates] = useState<PanelScrollState[]>([])

  // Stable key for panelWidths to use in dependency arrays
  const widthsKey = panelWidths.join(',')

  const compute = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const scrollX = el.scrollLeft
    const count = panelWidths.length

    const newStates: PanelScrollState[] = panelWidths.map((width, n) => {
      // Single panel is always resting
      if (count <= 1) return 'resting'

      // Compute effective width for this panel (width minus peek)
      const effectiveWidth = width - PEEK_WIDTH

      // Cumulative effective widths for threshold calculation
      // The "overlay" threshold for panel N = sum of effective widths of panels 0..N-2
      // The "obscured" threshold for panel N = sum of effective widths of panels 0..N, minus a buffer
      let cumulativeBefore = 0
      for (let i = 0; i < n - 1; i++) {
        cumulativeBefore += panelWidths[i] - PEEK_WIDTH
      }

      let cumulativeThrough = 0
      for (let i = 0; i <= n; i++) {
        cumulativeThrough += panelWidths[i] - PEEK_WIDTH
      }

      // First panel: no overlay state (nothing behind it)
      if (n === 0) {
        const obscuredThreshold = effectiveWidth - 80
        if (scrollX > obscuredThreshold) return 'obscured'
        return 'resting'
      }

      const overlayThreshold = cumulativeBefore
      const obscuredThreshold = cumulativeThrough - 80

      if (scrollX > obscuredThreshold) return 'obscured'
      if (scrollX > overlayThreshold) return 'overlay'
      return 'resting'
    })

    setStates(prev => arraysEqual(prev, newStates) ? prev : newStates)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthsKey, scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    compute()
    el.addEventListener('scroll', compute, { passive: true })
    return () => el.removeEventListener('scroll', compute)
  }, [compute])

  // Recompute when panel widths change
  useEffect(() => {
    compute()
  }, [widthsKey, compute])

  return states
}
