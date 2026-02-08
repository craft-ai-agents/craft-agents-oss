import * as React from "react"

/**
 * Creates the gradient style for the resize indicator
 */
export function getResizeGradientStyle(mouseY: number | null): React.CSSProperties {
  return {
    transition: 'opacity 150ms ease-out',
    opacity: mouseY !== null ? 1 : 0,
    background: `radial-gradient(
      circle 66vh at 50% ${mouseY ?? 0}px,
      color-mix(in oklch, var(--foreground) 25%, transparent) 0%,
      color-mix(in oklch, var(--foreground) 12%, transparent) 30%,
      transparent 70%
    )`
  }
}

/** Delay (ms) before showing the resize gradient on hover, to avoid flashing on pass-through */
const HOVER_INTENT_DELAY = 150

/**
 * useResizeGradient - Hook for resize handle gradient that follows cursor
 *
 * Features hover-intent detection: the gradient only appears after the cursor
 * has lingered on the handle for HOVER_INTENT_DELAY ms. If the cursor is just
 * passing through, it leaves before the timer fires and no flash occurs.
 * A mousedown always shows the gradient immediately (user clearly intends to resize).
 *
 * Returns:
 * - ref: Attach to the touch area element
 * - mouseY: Current Y position (null when not hovering)
 * - handlers: onMouseMove, onMouseLeave, onMouseDown for the touch area
 * - gradientStyle: CSS style object for the visual indicator
 */
export function useResizeGradient() {
  const [mouseY, setMouseY] = React.useState<number | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingYRef = React.useRef<number | null>(null)
  const isActiveRef = React.useRef(false)

  const clearHoverTimer = React.useCallback(() => {
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  // Clean up timer on unmount
  React.useEffect(() => {
    return () => clearHoverTimer()
  }, [clearHoverTimer])

  const onMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      const y = e.clientY - rect.top

      if (isActiveRef.current) {
        // Already showing — update position immediately for smooth tracking
        setMouseY(y)
      } else {
        // Not yet showing — track position and start hover-intent delay
        pendingYRef.current = y
        if (hoverTimerRef.current === null) {
          hoverTimerRef.current = setTimeout(() => {
            hoverTimerRef.current = null
            isActiveRef.current = true
            setMouseY(pendingYRef.current)
          }, HOVER_INTENT_DELAY)
        }
      }
    }
  }, [])

  const onMouseLeave = React.useCallback(() => {
    if (!isDragging) {
      clearHoverTimer()
      pendingYRef.current = null
      isActiveRef.current = false
      setMouseY(null)
    }
  }, [isDragging, clearHoverTimer])

  const onMouseDown = React.useCallback(() => {
    // Show immediately on click — user clearly intends to resize
    clearHoverTimer()
    if (!isActiveRef.current && pendingYRef.current !== null) {
      isActiveRef.current = true
      setMouseY(pendingYRef.current)
    }
    setIsDragging(true)
  }, [clearHoverTimer])

  // Track mouse position during drag and cleanup on mouseup
  React.useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect()
        setMouseY(e.clientY - rect.top)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      isActiveRef.current = false
      setMouseY(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  return {
    ref,
    mouseY,
    isDragging,
    handlers: { onMouseMove, onMouseLeave, onMouseDown },
    gradientStyle: getResizeGradientStyle(mouseY),
  }
}
