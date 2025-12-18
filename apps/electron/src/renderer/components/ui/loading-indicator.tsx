import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Format duration in human-readable form
 * @param ms Duration in milliseconds
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

export interface SpinnerProps {
  /** Additional className */
  className?: string
}

/**
 * Spinner - 3x3 grid spinner based on SpinKit Grid
 *
 * Features:
 * - Uses currentColor (inherits text color from parent)
 * - Uses em sizing (scales with font-size)
 * - 3x3 grid of cubes with staggered scale animation
 * - Pure CSS animation (no JS state)
 *
 * Usage:
 * ```tsx
 * // Inherits color and size from parent
 * <div className="text-muted-foreground text-sm">
 *   <Spinner />
 * </div>
 *
 * // Or override with className
 * <Spinner className="text-amber-500 text-lg" />
 * ```
 */
export function Spinner({ className }: SpinnerProps) {
  return (
    <span
      className={cn("spinner", className)}
      role="status"
      aria-label="Loading"
    >
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
      <span className="spinner-cube" />
    </span>
  )
}

export interface LoadingIndicatorProps {
  /** Optional label to show next to spinner */
  label?: string
  /** Whether to animate the spinner */
  animated?: boolean
  /** Show elapsed time (pass start timestamp or true to auto-track) */
  showElapsed?: boolean | number
  /** Ultrathink mode - shows gradient animated text */
  ultrathink?: boolean
  /** Additional className for the container */
  className?: string
}

/**
 * LoadingIndicator - Spinner with optional label and elapsed time
 *
 * Inherits text color and size from parent element.
 *
 * Features:
 * - Animated 3x3 dot grid spinner (CSS-only)
 * - Optional label text
 * - Optional elapsed time display
 * - Ultrathink mode with gradient animation
 */
export function LoadingIndicator({
  label,
  animated = true,
  showElapsed = false,
  ultrathink = false,
  className,
}: LoadingIndicatorProps) {
  const [gradientOffset, setGradientOffset] = React.useState(0)
  const [elapsed, setElapsed] = React.useState(0)
  const startTimeRef = React.useRef<number | null>(null)

  // Gradient animation for ultrathink
  React.useEffect(() => {
    if (!ultrathink || !animated) return

    const interval = setInterval(() => {
      setGradientOffset((prev) => (prev + 1) % 10)
    }, 120)

    return () => clearInterval(interval)
  }, [ultrathink, animated])

  // Elapsed time tracking
  React.useEffect(() => {
    if (!showElapsed) return

    // Initialize start time
    if (typeof showElapsed === 'number') {
      startTimeRef.current = showElapsed
    } else if (!startTimeRef.current) {
      startTimeRef.current = Date.now()
    }

    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsed(Date.now() - startTimeRef.current)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [showElapsed])

  // Display label
  const displayLabel = ultrathink ? 'Deep thinking...' : label

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {/* Spinner */}
      {animated ? (
        <Spinner className={ultrathink ? "text-fuchsia-500" : undefined} />
      ) : (
        <span className="inline-flex items-center justify-center w-[1em] h-[1em]">●</span>
      )}

      {/* Label with optional ultrathink gradient */}
      {displayLabel && (
        <span
          className={cn(
            "text-muted-foreground",
            ultrathink && "ultrathink-gradient"
          )}
          style={ultrathink ? { '--gradient-offset': gradientOffset } as React.CSSProperties : undefined}
        >
          {displayLabel}
        </span>
      )}

      {/* Elapsed time */}
      {showElapsed && elapsed >= 1000 && (
        <span className="text-muted-foreground/60">
          ({formatDuration(elapsed)})
        </span>
      )}
    </span>
  )
}
