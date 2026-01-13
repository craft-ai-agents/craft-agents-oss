/**
 * PanelHeader - Standardized header component for panels
 *
 * Provides consistent header styling with:
 * - Fixed 40px height
 * - Title with optional badge
 * - Optional action buttons
 * - Automatic padding compensation for macOS traffic lights (via StoplightContext)
 *
 * Usage:
 * ```tsx
 * <PanelHeader
 *   title="Conversations"
 *   actions={<Button>Add</Button>}
 * />
 * ```
 *
 * The header automatically compensates for macOS traffic lights when rendered
 * inside a StoplightProvider (e.g., in MainContentPanel during focused mode).
 * You can also explicitly control this with the `compensateForStoplight` prop.
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'

// Spring transition for smooth animations (matches sidebar)
const springTransition = { type: 'spring' as const, stiffness: 300, damping: 30 }

// Padding to compensate for macOS traffic lights (stoplight buttons)
// Traffic lights positioned at x:18, ~52px wide = 70px + 14px gap
const STOPLIGHT_PADDING = 84

export interface PanelHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: string
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** When true, animates left margin to avoid macOS traffic lights (use when this is the first panel on screen) */
  compensateForStoplight?: boolean
  /** Left padding override (e.g., for focused mode with traffic lights) */
  paddingLeft?: string
  /** Optional className for additional styling */
  className?: string
}

/**
 * Standardized panel header with title and actions
 */
export function PanelHeader({
  title,
  badge,
  actions,
  compensateForStoplight,
  paddingLeft,
  className,
}: PanelHeaderProps) {
  // Use context as fallback when prop is not explicitly set
  const contextCompensate = useCompensateForStoplight()
  const shouldCompensate = compensateForStoplight ?? contextCompensate

  const content = (
    <>
      <div className="flex-1 min-w-0 flex items-center justify-center select-none">
        <motion.div
          initial={false}
          animate={{ opacity: title ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-2"
        >
          <h1 className="text-sm font-semibold truncate font-sans leading-tight">{title}</h1>
          {badge}
        </motion.div>
      </div>
      {actions && (
        <div className="titlebar-no-drag shrink-0">
          {actions}
        </div>
      )}
    </>
  )

  // Base padding (16px = pl-4)
  const basePadding = 16

  const baseClassName = cn(
    'flex shrink-0 items-center pr-2 min-w-0 gap-3 relative z-50',
    // Slightly shorter header in focused mode to align with traffic lights
    shouldCompensate ? 'h-[38px]' : 'h-[40px]',
    // Only use static paddingLeft class when not animating
    !shouldCompensate && (paddingLeft || 'pl-4'),
    className
  )

  // Use motion.div with animated paddingLeft to shift content while keeping background full-width
  return (
    <motion.div
      initial={false}
      animate={{ paddingLeft: shouldCompensate ? STOPLIGHT_PADDING : basePadding }}
      transition={springTransition}
      className={baseClassName}
    >
      {content}
    </motion.div>
  )
}
