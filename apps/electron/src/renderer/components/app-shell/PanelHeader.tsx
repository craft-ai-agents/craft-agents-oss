/**
 * PanelHeader - Standardized header component for panels
 *
 * Provides consistent header styling with:
 * - Fixed 40px height
 * - Title with optional badge
 * - Optional action buttons
 * - Optional margin compensation for macOS traffic lights
 *
 * Usage:
 * ```tsx
 * <PanelHeader
 *   title="Conversations"
 *   actions={<Button>Add</Button>}
 *   compensateForStoplight={!isSidebarVisible}
 * />
 * ```
 */

import * as React from 'react'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'

// Spring transition for smooth animations (matches sidebar)
const springTransition = { type: 'spring' as const, stiffness: 300, damping: 30 }

// Margin to compensate for macOS traffic lights (stoplight buttons)
const STOPLIGHT_MARGIN = 102

export interface PanelHeaderProps {
  /** Header title */
  title: string
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
  compensateForStoplight = false,
  paddingLeft,
  className,
}: PanelHeaderProps) {
  const content = (
    <>
      <div className="flex-1 min-w-0 flex items-center select-none">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold truncate font-sans leading-tight">{title}</h1>
          {badge}
        </div>
      </div>
      {actions && (
        <div className="titlebar-no-drag shrink-0">
          {actions}
        </div>
      )}
    </>
  )

  const baseClassName = cn(
    'flex h-[40px] shrink-0 items-center pr-2 min-w-0 gap-3 relative z-50',
    paddingLeft || 'pl-4',
    className
  )

  // Use motion.div for animated stoplight compensation
  return (
    <motion.div
      initial={false}
      animate={{ marginLeft: compensateForStoplight ? STOPLIGHT_MARGIN : 0 }}
      transition={springTransition}
      className={baseClassName}
    >
      {content}
    </motion.div>
  )
}
