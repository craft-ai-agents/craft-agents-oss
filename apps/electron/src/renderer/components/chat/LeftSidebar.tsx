import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface LeftSidebarProps {
  isCollapsed: boolean
  links: {
    title: string
    label?: string       // Optional badge (e.g., count)
    icon: LucideIcon
    variant: "default" | "ghost"  // "default" = highlighted, "ghost" = subtle
    onClick?: () => void
  }[]
}

/**
 * LeftSidebar - Vertical list of navigation buttons with icons
 *
 * Styling matches agent items in the sidebar for consistency:
 * - py-[7px] px-2 text-sm rounded-md
 * - Icon: h-3.5 w-3.5
 *
 * Link variants:
 * - "default": Highlighted style (used for active/selected items)
 * - "ghost": Subtle style (used for inactive items)
 */
export function LeftSidebar({ links, isCollapsed }: LeftSidebarProps) {
  return (
    <div className="flex flex-col py-2">
      <nav className="grid gap-0.5 px-2">
        {links.map((link, index) => (
          <button
            key={index}
            onClick={link.onClick}
            className={cn(
              "flex w-full items-center gap-2 rounded-md py-[7px] px-2 text-sm",
              link.variant === "default"
                ? "bg-primary text-primary-foreground dark:bg-muted dark:text-foreground"
                : "hover:bg-accent"
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
        ))}
      </nav>
    </div>
  )
}
