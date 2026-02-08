import * as React from "react"

/**
 * Creates the gradient style for a horizontal resize indicator.
 * The gradient follows the cursor along the X-axis of the handle.
 */
export function getHorizontalResizeGradientStyle(mouseX: number | null): React.CSSProperties {
  return {
    transition: 'opacity 150ms ease-out',
    opacity: mouseX !== null ? 1 : 0,
    // Horizontal gradient that follows cursor along the X-axis
    background: `radial-gradient(
      circle 66vw at ${mouseX ?? 0}px 50%,
      color-mix(in oklch, var(--foreground) 25%, transparent) 0%,
      color-mix(in oklch, var(--foreground) 12%, transparent) 30%,
      transparent 70%
    )`
  }
}

/** Delay (ms) before showing the resize gradient on hover, to avoid flashing on pass-through */
const HOVER_INTENT_DELAY = 150

/**
 * useHorizontalResizeGradient - Hook for horizontal resize handle gradient that follows cursor
 *
 * Similar to useResizeGradient but tracks X position for horizontal (row) resizing.
 * Includes hover-intent detection: the gradient only appears after the cursor
 * has lingered on the handle for HOVER_INTENT_DELAY ms.
 *
 * Returns:
 * - ref: Attach to the touch area element
 * - mouseX: Current X position (null when not hovering)
 * - isDragging: Whether currently dragging
 * - handlers: onMouseMove, onMouseLeave, onMouseDown for the touch area
 * - gradientStyle: CSS style object for the visual indicator
 */
export function useHorizontalResizeGradient() {
  const [mouseX, setMouseX] = React.useState<number | null>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingXRef = React.useRef<number | null>(null)
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
      const x = e.clientX - rect.left

      if (isActiveRef.current) {
        // Already showing — update position immediately for smooth tracking
        setMouseX(x)
      } else {
        // Not yet showing — track position and start hover-intent delay
        pendingXRef.current = x
        if (hoverTimerRef.current === null) {
          hoverTimerRef.current = setTimeout(() => {
            hoverTimerRef.current = null
            isActiveRef.current = true
            setMouseX(pendingXRef.current)
          }, HOVER_INTENT_DELAY)
        }
      }
    }
  }, [])

  const onMouseLeave = React.useCallback(() => {
    if (!isDragging) {
      clearHoverTimer()
      pendingXRef.current = null
      isActiveRef.current = false
      setMouseX(null)
    }
  }, [isDragging, clearHoverTimer])

  const onMouseDown = React.useCallback(() => {
    // Show immediately on click — user clearly intends to resize
    clearHoverTimer()
    if (!isActiveRef.current && pendingXRef.current !== null) {
      isActiveRef.current = true
      setMouseX(pendingXRef.current)
    }
    setIsDragging(true)
  }, [clearHoverTimer])

  // Track mouse position during drag and cleanup on mouseup
  React.useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect()
        setMouseX(e.clientX - rect.left)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      isActiveRef.current = false
      setMouseX(null)
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
    mouseX,
    isDragging,
    handlers: { onMouseMove, onMouseLeave, onMouseDown },
    gradientStyle: getHorizontalResizeGradientStyle(mouseX),
  }
}
