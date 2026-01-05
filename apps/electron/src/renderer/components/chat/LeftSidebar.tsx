import type { LucideIcon } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/** Check if a string is a hex color code (e.g., #3B82F6) */
function isHexColor(str: string | undefined): boolean {
  return !!str && /^#[0-9A-Fa-f]{6}$/.test(str)
}

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:inbox')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon | React.ReactNode  // LucideIcon or custom React element
  iconColor?: string    // Optional color class for the icon
  variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
  onClick?: () => void
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
 */
export function LeftSidebar({ links, isCollapsed, getItemProps, focusedItemId }: LeftSidebarProps) {
  return (
    <div className="flex flex-col py-1 select-none">
      <nav className="grid gap-0.5 px-2" role="navigation" aria-label="Main navigation">
        {links.map((link) => {
          const itemProps = getItemProps?.(link.id)
          const isFocused = focusedItemId === link.id
          return (
            <button
              key={link.id}
              {...itemProps}
              onClick={link.onClick}
              className={cn(
                "flex w-full items-center gap-2 rounded-[6px] py-[5px] px-2 text-[13px] select-none outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                link.variant === "default"
                  ? "bg-foreground/[0.07]"
                  : "hover:bg-foreground/5"
              )}
            >
              {/* Render icon - either component (function/forwardRef) or React element */}
              {(() => {
                // Check if it's a component (function or forwardRef object with render)
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
              })()}
              {link.title}
              {/* Label Badge: Shows count or status on the right */}
              {link.label && (
                <span className="ml-auto text-xs text-muted-foreground/50">
                  {link.label}
                </span>
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
