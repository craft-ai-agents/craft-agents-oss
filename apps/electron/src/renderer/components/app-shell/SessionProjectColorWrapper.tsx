import * as React from 'react'
import type { ProjectColorTreatment } from '@/utils/project-colors'

interface SessionProjectColorWrapperProps {
  /** Hex color (e.g. "#6366f1") to apply, or null/undefined to render children without overlay */
  color: string | null | undefined
  /** Visual treatment to apply when `color` is present */
  treatment: ProjectColorTreatment
  children: React.ReactNode
}

/**
 * Wraps a SessionItem row with a project-color overlay.
 *
 * - Always renders a 3px colored stripe at the row's leading edge when a color is set.
 * - Optionally adds a subtle background tint when treatment === 'stripe-tint'.
 *
 * Does NOT touch the SessionItem internals. The stripe/tint render on the wrapper
 * so the inner `EntityRow` (with its own selection bar + selected/hover backgrounds)
 * composites cleanly on top — selection always reads correctly.
 */
export function SessionProjectColorWrapper({
  color,
  treatment,
  children,
}: SessionProjectColorWrapperProps) {
  if (!color) return <>{children}</>

  const showTint = treatment === 'stripe-tint'

  return (
    <div
      className="relative"
      style={showTint ? { backgroundColor: `color-mix(in srgb, ${color} 6%, transparent)` } : undefined}
    >
      <div
        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm z-10 pointer-events-none"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {children}
    </div>
  )
}
