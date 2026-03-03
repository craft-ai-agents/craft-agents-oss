/**
 * PanelHeader - Standardized header component for panels
 *
 * Provides consistent header styling with:
 * - Fixed 50px height
 * - Title with optional badge
 * - Optional action buttons
 * - Optional title dropdown menu (renders chevron and makes title interactive)
 * - Automatic padding compensation for macOS traffic lights (via StoplightContext)
 *
 * Usage:
 * ```tsx
 * <PanelHeader
 *   title="Conversations"
 *   actions={<Button>Add</Button>}
 * />
 *
 * // With interactive title menu:
 * <PanelHeader
 *   title="Chat Name"
 *   titleMenu={<><MenuItem>Rename</MenuItem><MenuItem>Delete</MenuItem></>}
 * />
 * ```
 *
 * The header automatically compensates for macOS traffic lights when rendered
 * inside a StoplightProvider (e.g., in MainContentPanel during focused mode).
 * You can also explicitly control this with the `compensateForStoplight` prop.
 */

import * as React from 'react'
import { useState } from 'react'
import { motion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCompensateForStoplight } from '@/context/StoplightContext'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'

// Import helpers for internal use
import { buildPanelHeaderClassName } from './panel-header-utils'

// Re-export testable helpers for consumers
export {
  STOPLIGHT_PADDING,
  buildPanelHeaderClassName,
  resolveLeadingActionClassName,
} from './panel-header-utils'

// Spring transition for smooth animations (matches sidebar)
const springTransition = { type: 'spring' as const, stiffness: 300, damping: 30 }

export interface PanelHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: string
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** Optional dropdown menu content for interactive title (renders chevron when provided) */
  titleMenu?: React.ReactNode
  /** Optional center button rendered between title and right actions */
  centerButton?: React.ReactNode
  /** Optional action buttons rendered before the title (left side) */
  leadingActions?: React.ReactNode
  /** Optional action buttons rendered on the right */
  actions?: React.ReactNode
  /** Optional right sidebar button (rendered after actions) */
  rightSidebarButton?: React.ReactNode
  /** When true, animates left margin to avoid macOS traffic lights (use when this is the first panel on screen) */
  compensateForStoplight?: boolean
  /** Left padding override (e.g., for focused mode with traffic lights) */
  paddingLeft?: string
  /** Optional className for additional styling */
  className?: string
  /** Whether title is being regenerated (shows shimmer effect) */
  isRegeneratingTitle?: boolean
}

/**
 * Standardized panel header with title and actions
 */
export function PanelHeader({
  title,
  badge,
  titleMenu,
  leadingActions,
  centerButton,
  actions,
  rightSidebarButton,
  compensateForStoplight,
  paddingLeft,
  className,
  isRegeneratingTitle,
}: PanelHeaderProps) {
  // Use context as fallback when prop is not explicitly set
  const contextCompensate = useCompensateForStoplight()
  const shouldCompensate = compensateForStoplight ?? contextCompensate

  // Controlled dropdown state for anchoring to chevron while keeping full title clickable
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Title content - either static or interactive with dropdown
  // Shimmer effect shows during title regeneration
  const titleContent = (
    <motion.div
      initial={false}
      animate={{ opacity: title ? 1 : 0 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-1"
    >
      <h1 className={cn(
        "text-sm font-semibold truncate font-sans leading-tight",
        isRegeneratingTitle && "animate-shimmer-text"
      )}>{title}</h1>
      {badge}
    </motion.div>
  )

  const content = (
    <>
      {leadingActions && (
        <div className="titlebar-no-drag shrink-0">
          {leadingActions}
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center select-none">
        <div className="mx-auto w-fit">
          {titleMenu ? (
            <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
              {/* Wrapper button for the whole clickable area */}
              <button
                onClick={() => setDropdownOpen(true)}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-md titlebar-no-drag",
                  "hover:bg-foreground/[0.03] transition-colors",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  dropdownOpen && "bg-foreground/[0.03]"
                )}
              >
                {titleContent}
                {/* Chevron is the actual trigger anchor point */}
                <DropdownMenuTrigger asChild>
                  <span className="shrink-0 flex items-center justify-center">
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground translate-y-[1px]" />
                  </span>
                </DropdownMenuTrigger>
              </button>
              <StyledDropdownMenuContent align="center" sideOffset={8}>
                {titleMenu}
              </StyledDropdownMenuContent>
            </DropdownMenu>
          ) : (
            titleContent
          )}
        </div>
      </div>
      {centerButton && (
        <div className="titlebar-no-drag shrink-0">
          {centerButton}
        </div>
      )}
      {actions && (
        <div className="titlebar-no-drag shrink-0">
          {actions}
        </div>
      )}
      {rightSidebarButton && (
        <div className="titlebar-no-drag shrink-0">
          {rightSidebarButton}
        </div>
      )}
    </>
  )

  const baseClassName = buildPanelHeaderClassName(className)

  return (
    <motion.div
      initial={false}
      transition={springTransition}
      className={baseClassName}
    >
      {content}
    </motion.div>
  )
}
