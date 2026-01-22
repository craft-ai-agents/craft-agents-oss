import type { LucideIcon } from "lucide-react"
import * as React from "react"
import { useState } from "react"
import { AnimatePresence, motion, type Variants } from "motion/react"
import { ChevronRight } from "lucide-react"

import { cn, isHexColor } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
} from '@/components/ui/styled-context-menu'
import { ContextMenuProvider } from '@/components/ui/menu-context'
import { SidebarMenu, type SidebarMenuType } from './SidebarMenu'

/** Context menu configuration for sidebar items */
export interface SidebarContextMenuConfig {
  /** Type of sidebar item (determines available menu items) */
  type: SidebarMenuType
  /** Status ID for status items (e.g., 'todo', 'done') - not currently used but kept for future */
  statusId?: string
  /** Handler for "Configure Statuses" action - for allChats/status/flagged types */
  onConfigureStatuses?: () => void
  /** Handler for "Add Source" action - for sources type */
  onAddSource?: () => void
  /** Handler for "Add Skill" action - for skills type */
  onAddSkill?: () => void
  /** Source type filter for "Learn More" link - determines which docs page to open */
  sourceType?: 'api' | 'mcp' | 'local'
}

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:allChats')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon | React.ReactNode  // LucideIcon or custom React element
  iconColor?: string    // Optional color class for the icon
  /** Whether the icon responds to color (uses currentColor). Default true for Lucide icons. */
  iconColorable?: boolean
  variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
  onClick?: () => void
  // Expandable item properties
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  items?: SidebarItem[]    // Subitems as data (rendered as nested LeftSidebar) - supports separators
  // Tutorial system
  dataTutorial?: string // data-tutorial attribute for tutorial targeting
  // Context menu configuration (optional - if provided, right-click shows context menu)
  contextMenu?: SidebarContextMenuConfig
}

export interface SeparatorItem {
  id: string
  type: 'separator'
}

export type SidebarItem = LinkItem | SeparatorItem

export const isSeparatorItem = (item: SidebarItem): item is SeparatorItem =>
  'type' in item && item.type === 'separator'

interface LeftSidebarProps {
  isCollapsed: boolean
  links: SidebarItem[]
  /** Get props for each item (from unified sidebar navigation) */
  getItemProps?: (id: string) => {
    tabIndex: number
    'data-focused': boolean
    ref: (el: HTMLElement | null) => void
  }
  /** Currently focused item ID */
  focusedItemId?: string | null
  /** Whether this is a nested sidebar (child of expandable item) */
  isNested?: boolean
}

// Stagger animation for child items
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025,
      delayChildren: 0.01,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1,
    },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.15, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    x: -8,
    transition: { duration: 0.1, ease: 'easeIn' },
  },
}

/**
 * LeftSidebar - Vertical list of navigation buttons with icons
 *
 * Navigation is managed by the parent component (Chat.tsx) for unified
 * sidebar keyboard navigation. This component just renders the items.
 *
 * Styling matches agent items in the sidebar for consistency:
 * - py-[7px] px-2 text-[13px] rounded-md
 * - Icon: h-3.5 w-3.5
 *
 * Link variants:
 * - "default": Highlighted style (used for active/selected items)
 * - "ghost": Subtle style (used for inactive items)
 *
 * Expandable items:
 * - Show a chevron toggle on hover (replaces icon position)
 * - Children are rendered with animated expand/collapse
 * - Nested items have left indentation with vertical line
 */
export function LeftSidebar({ links, isCollapsed, getItemProps, focusedItemId, isNested }: LeftSidebarProps) {
  // For nested sidebars, wrap in motion container for stagger effect
  const NavWrapper = isNested ? motion.nav : 'nav'
  const navProps = isNested ? {
    variants: containerVariants,
    initial: 'hidden',
    animate: 'visible',
    exit: 'exit',
  } : {}

  return (
    <div className={cn("flex flex-col select-none", !isNested && "py-1")}>
      <NavWrapper
        className={cn(
          "grid gap-0.5",
          isNested ? "pl-5 pr-0 relative" : "px-2"
        )}
        role="navigation"
        aria-label={isNested ? "Sub navigation" : "Main navigation"}
        {...navProps}
      >
        {/* Vertical line for nested items - 4px left of chevron center */}
        {isNested && (
          <div
            className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10"
            aria-hidden="true"
          />
        )}
        {links.map((item) => {
          // Handle separator items
          if (isSeparatorItem(item)) {
            return (
              <div key={item.id} className="py-1 px-2" aria-hidden="true">
                <div className="h-px bg-foreground/5" />
              </div>
            )
          }

          const link = item
          const itemProps = getItemProps?.(link.id)
          const isFocused = focusedItemId === link.id

          // Button element shared by both expandable and non-expandable items
          const buttonElement = (
            <button
              {...itemProps}
              onClick={link.onClick}
              data-tutorial={link.dataTutorial}
              className={cn(
                "group flex w-full items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                // Same padding for all items
                "px-2",
                link.variant === "default"
                  ? "bg-foreground/[0.07]"
                  : "hover:bg-foreground/5"
              )}
            >
              {/* Icon container with hover toggle for expandable items */}
              <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                {link.expandable ? (
                  <>
                    {/* Main icon - hidden on hover */}
                    <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
                      {renderIcon(link)}
                    </span>
                    {/* Toggle chevron - shown on hover */}
                    <span
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        link.onToggle?.()
                      }}
                    >
                      <ChevronRight
                        className={cn(
                          "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                          link.expanded && "rotate-90"
                        )}
                      />
                    </span>
                  </>
                ) : (
                  renderIcon(link)
                )}
              </span>
              {link.title}
              {/* Label Badge: Shows count or status on the right */}
              {link.label && (
                <span className="ml-auto text-xs text-foreground/30 opacity-0 group-hover/section:opacity-100 transition-opacity">
                  {link.label}
                </span>
              )}
            </button>
          )

          // Inner content: button and expandable children
          const innerContent = (
            <>
              {buttonElement}
              {/* Expandable subitems with animation */}
              {link.expandable && link.items && (
                <AnimatePresence initial={false}>
                  {link.expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
                      animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
                      exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <LeftSidebar
                        isCollapsed={false}
                        isNested={true}
                        getItemProps={getItemProps}
                        focusedItemId={focusedItemId}
                        links={link.items}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </>
          )

          // Wrap with context menu if configured, otherwise just group/section wrapper
          // Context menus enable right-click actions like "Edit Statuses" and "Open in New Window"
          const content = link.contextMenu ? (
            <ContextMenu modal={true}>
              <ContextMenuTrigger asChild>
                <div className="group/section">
                  {innerContent}
                </div>
              </ContextMenuTrigger>
              <StyledContextMenuContent>
                <ContextMenuProvider>
                  <SidebarMenu
                    type={link.contextMenu.type}
                    statusId={link.contextMenu.statusId}
                    onConfigureStatuses={link.contextMenu.onConfigureStatuses}
                    onAddSource={link.contextMenu.onAddSource}
                    onAddSkill={link.contextMenu.onAddSkill}
                    sourceType={link.contextMenu.sourceType}
                  />
                </ContextMenuProvider>
              </StyledContextMenuContent>
            </ContextMenu>
          ) : (
            <div className="group/section">
              {innerContent}
            </div>
          )

          // For nested items, wrap in motion.div for stagger animation
          return isNested ? (
            <motion.div key={link.id} variants={itemVariants}>
              {content}
            </motion.div>
          ) : (
            <React.Fragment key={link.id}>
              {content}
            </React.Fragment>
          )
        })}
      </NavWrapper>
    </div>
  )
}

/**
 * Helper to render icon - either component (function/forwardRef) or React element
 */
function renderIcon(link: LinkItem) {
  const isComponent = typeof link.icon === 'function' ||
    (typeof link.icon === 'object' && link.icon !== null && 'render' in link.icon)
  const defaultColor = "text-foreground/60"

  // Lucide components are always colorable; ReactNode icons check iconColorable
  // Default to true for backwards compatibility (most icons are colorable)
  const applyColor = link.iconColorable !== false

  if (isComponent) {
    const Icon = link.icon as React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    return (
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", applyColor && !isHexColor(link.iconColor) && (link.iconColor || defaultColor))}
        style={applyColor && isHexColor(link.iconColor) ? { color: link.iconColor } : undefined}
      />
    )
  }
  // Already a React element or primitive ReactNode
  // Use [&>svg]:w-full [&>svg]:h-full to size SVG children and [&>div>svg] for wrapped SVGs
  return (
    <span
      className={cn(
        "h-3.5 w-3.5 shrink-0 flex items-center justify-center",
        "[&>svg]:w-full [&>svg]:h-full [&>div>svg]:w-full [&>div>svg]:h-full [&>img]:w-full [&>img]:h-full",
        applyColor && !isHexColor(link.iconColor) && (link.iconColor || defaultColor)
      )}
      style={applyColor && isHexColor(link.iconColor) ? { color: link.iconColor } : undefined}
    >
      {link.icon as React.ReactNode}
    </span>
  )
}
