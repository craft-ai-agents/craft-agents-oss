import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface LinkItem {
  id: string            // Unique ID for navigation (e.g., 'nav:inbox')
  title: string
  label?: string        // Optional badge (e.g., count)
  icon: LucideIcon
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
    <div className="flex flex-col py-2">
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
                "flex w-full items-center gap-2 rounded-md py-[7px] px-2 text-[13px] select-none outline-none",
                "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                link.variant === "default"
                  ? "bg-primary text-primary-foreground dark:bg-muted dark:text-foreground"
                  : "hover:bg-accent",
                isFocused && link.variant !== "default" && "bg-foreground/5"
              )}
            >
              <link.icon className={cn(
                "h-3.5 w-3.5 shrink-0",
                link.variant === "default"
                  ? "text-primary-foreground dark:text-foreground"
                  : "text-muted-foreground"
              )} />
              {link.title}
              {/* Label Badge: Shows count or status on the right */}
              {link.label && (
                <span
                  className={cn(
                    "ml-auto text-xs",
                    link.variant === "default"
                      ? "text-primary-foreground/50 dark:text-foreground/50"
                      : "text-muted-foreground/50"
                  )}
                >
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
