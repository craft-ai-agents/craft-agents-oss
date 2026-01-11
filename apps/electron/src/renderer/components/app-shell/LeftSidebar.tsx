import type { LucideIcon } from "lucide-react"
import * as React from "react"
import { AnimatePresence, motion, type Variants } from "framer-motion"
import { ChevronRight } from "lucide-react"

import { cn, isHexColor } from "@/lib/utils"

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:allChats')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon | React.ReactNode  // LucideIcon or custom React element
  iconColor?: string    // Optional color class for the icon
  variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
  onClick?: () => void
  // Expandable item properties
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  items?: LinkItem[]    // Subitems as data (rendered as nested LeftSidebar)
}

interface LeftSidebarProps {
  isCollapsed: boolean
  links: LinkItem[]
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
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.03,
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
        {links.map((link) => {
          const itemProps = getItemProps?.(link.id)
          const isFocused = focusedItemId === link.id

          const content = (
            <>
              <button
                {...itemProps}
                onClick={link.onClick}
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
                  <span className="ml-auto text-xs text-muted-foreground/50">
                    {link.label}
                  </span>
                )}
              </button>
              {/* Expandable subitems with animation */}
              {link.expandable && link.items && (
                <AnimatePresence initial={false}>
                  {link.expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
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
  if (isComponent) {
    const Icon = link.icon as React.ComponentType<{ className?: string; style?: React.CSSProperties }>
    return (
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", !isHexColor(link.iconColor) && (link.iconColor || "text-muted-foreground"))}
        style={isHexColor(link.iconColor) ? { color: link.iconColor } : undefined}
      />
    )
  }
  // Already a React element or primitive ReactNode
  return (
    <span
      className={cn("h-3.5 w-3.5 shrink-0 flex items-center justify-center", !isHexColor(link.iconColor) && (link.iconColor || "text-muted-foreground"))}
      style={isHexColor(link.iconColor) ? { color: link.iconColor } : undefined}
    >
      {link.icon as React.ReactNode}
    </span>
  )
}
