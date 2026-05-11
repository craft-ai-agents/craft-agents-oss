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
import { useAppShellContext } from '@/context/AppShellContext'
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StyledDropdownMenuContent } from '@/components/ui/styled-dropdown'

// Spring transition for smooth animations (matches sidebar)
const springTransition = { type: 'spring' as const, stiffness: 300, damping: 30 }

// Padding to compensate for macOS traffic lights (stoplight buttons)
// Traffic lights positioned at x:18, ~52px wide = 70px + 14px gap
const STOPLIGHT_PADDING = 84

// Compact header controls are 44px touch targets with a 6px flex gap.
// Reserve the real occupied width for the centered title so long titles truncate
// before the right-side action cluster instead of rendering underneath it.
const COMPACT_HEADER_SIDE_PADDING = 8
const COMPACT_HEADER_BUTTON_SIZE = 44
const COMPACT_HEADER_GAP = 6
const COMPACT_HEADER_TITLE_GAP = 8

function compactTitleInset(controlCount: number): number {
  if (controlCount <= 0) return 16
  return COMPACT_HEADER_SIDE_PADDING
    + (controlCount * COMPACT_HEADER_BUTTON_SIZE)
    + (controlCount * COMPACT_HEADER_GAP)
    + COMPACT_HEADER_TITLE_GAP
}

export interface PanelHeaderProps {
  /** Header title (undefined hides with animation) */
  title?: string
  /** Optional badge element (e.g., agent badge) */
  badge?: React.ReactNode
  /** Optional dropdown menu content for interactive title (renders chevron when provided) */
  titleMenu?: React.ReactNode
  /**
   * Compact-mode replacement for the interactive title. When provided AND
   * `isCompactMode === true`, this node is rendered in place of the desktop
   * Radix DropdownMenu wrapper of `titleMenu`. Caller is responsible for
   * rendering its own trigger button (matching the title styling) — see
   * `CompactSessionMenu` for the canonical example. Radix popovers + nested
   * submenus get clipped by the panel container query on narrow viewports;
   * this lets consumers swap to a vaul `Drawer` instead.
   */
  compactTitleMenu?: React.ReactNode
  /** Optional leading action rendered before the title (e.g., back button in compact mode) */
  leadingAction?: React.ReactNode
  /** Optional center button rendered between title and right actions */
  centerButton?: React.ReactNode
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
  compactTitleMenu,
  leadingAction: explicitLeadingAction,
  centerButton,
  actions,
  rightSidebarButton,
  compensateForStoplight,
  paddingLeft,
  className,
  isRegeneratingTitle,
}: PanelHeaderProps) {
  // Fall back to AppShellContext.leadingAction so per-panel back buttons (set by
  // PanelSlot in compact mode) propagate to every page's PanelHeader without each
  // page having to forward the prop manually. ChatPage explicitly passes its own
  // value, which overrides the context.
  const { leadingAction: contextLeadingAction, isCompactMode } = useAppShellContext()
  const leadingAction = explicitLeadingAction ?? contextLeadingAction

  // Use context as fallback when prop is not explicitly set.
  // Skip stoplight compensation when leadingAction is present — the back button
  // occupies the space where traffic lights would be.
  const contextCompensate = useCompensateForStoplight()
  const shouldCompensate = leadingAction ? false : (compensateForStoplight ?? contextCompensate)

  // Controlled dropdown state for anchoring to chevron while keeping full title clickable
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Force-close the desktop dropdown when compact mode takes over the title
  // slot — otherwise the open state survives unmount and the dropdown
  // resurrects open the next time the user resizes back to desktop width.
  React.useEffect(() => {
    if (isCompactMode && dropdownOpen) setDropdownOpen(false)
  }, [isCompactMode, dropdownOpen])

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

  // Title node — wrapped in interactive dropdown trigger when titleMenu is provided,
  // bare when not. Shared between the desktop and compact layouts below.
  // In compact mode, `compactTitleMenu` (if provided) takes over the slot so
  // consumers can render a Drawer-based menu instead of a Radix popover that
  // would otherwise get clipped by the panel container query.
  const desktopTitleNode = titleMenu ? (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
      {/* Wrapper button for the whole clickable area */}
      <button
        onClick={() => setDropdownOpen(true)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md titlebar-no-drag min-w-0",
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
  ) : titleContent

  const titleNode = (isCompactMode && compactTitleMenu) ? compactTitleMenu : desktopTitleNode

  // Compact (mobile) layout puts the title in an absolute-positioned overlay.
  // The side insets are based on the actual number of control slots so a long
  // title truncates before the right-side action cluster instead of overlapping it.
  const compactLeadingControlCount = leadingAction ? 1 : 0
  const compactTrailingControlCount = [centerButton, actions, rightSidebarButton].filter(Boolean).length
  const compactTitleInsetStyle = isCompactMode
    ? {
        left: compactTitleInset(compactLeadingControlCount),
        right: compactTitleInset(compactTrailingControlCount),
      }
    : undefined

  const content = isCompactMode ? (
    <>
      {leadingAction && (
        <div className="titlebar-no-drag shrink-0 z-[1]">
          {leadingAction}
        </div>
      )}
      <div className="flex-1" />
      {centerButton && (
        <div className="titlebar-no-drag shrink-0 z-[1]">
          {centerButton}
        </div>
      )}
      {actions && (
        <div className="titlebar-no-drag shrink-0 z-[1]">
          {actions}
        </div>
      )}
      {rightSidebarButton && (
        <div className="titlebar-no-drag shrink-0 z-[1]">
          {rightSidebarButton}
        </div>
      )}
      <div
        className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
        style={compactTitleInsetStyle}
      >
        <div className="max-w-full overflow-hidden pointer-events-auto">
          {titleNode}
        </div>
      </div>
    </>
  ) : (
    <>
      {leadingAction && (
        <div className="titlebar-no-drag shrink-0">
          {leadingAction}
        </div>
      )}
      <div className="flex-1 min-w-0 flex items-center select-none">
        <div className={cn("max-w-full overflow-hidden", !leadingAction && "mx-auto")}>
          {titleNode}
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

  // Base padding (16px = pl-4, matches pr-2 when leading action present for symmetry)
  const basePadding = leadingAction ? 8 : 16

  const baseClassName = cn(
    'flex shrink-0 items-center pr-2 min-w-0 gap-1.5 relative z-panel h-[42px]',
    // Only use static paddingLeft class when not animating
    !shouldCompensate && (paddingLeft || (leadingAction ? 'pl-2' : 'pl-4')),
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
