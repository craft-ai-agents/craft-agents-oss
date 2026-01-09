import * as React from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu"
import { cn } from "@/lib/utils"

/**
 * Styled Context Menu Components
 *
 * Pre-styled context menu components matching the StyledDropdownMenu style.
 * These wrap the base context-menu components with consistent styling.
 */

// Re-export unchanged components
export { ContextMenu, ContextMenuTrigger }

// Styled content - matches StyledDropdownMenuContent
interface StyledContextMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuContent> {
  /** Minimum width - defaults to min-w-40 */
  minWidth?: string
}

export const StyledContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof ContextMenuContent>,
  StyledContextMenuContentProps
>(({ className, minWidth = "min-w-40", ...props }, ref) => (
  <ContextMenuContent
    ref={ref}
    className={cn(
      "w-fit font-sans whitespace-nowrap text-xs flex flex-col gap-0.5",
      minWidth,
      className
    )}
    {...props}
  />
))
StyledContextMenuContent.displayName = "StyledContextMenuContent"

// Styled menu item - matches StyledDropdownMenuItem
interface StyledContextMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof ContextMenuItem> {
  /** Destructive variant - red text */
  variant?: "default" | "destructive"
}

export const StyledContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextMenuItem>,
  StyledContextMenuItemProps
>(({ className, variant = "default", ...props }, ref) => (
  <ContextMenuItem
    ref={ref}
    className={cn(
      "gap-3 pr-4 rounded-[4px] hover:bg-foreground/[0.03] focus:bg-foreground/[0.03]",
      "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
      variant === "destructive" && "text-destructive focus:text-destructive hover:text-destructive [&_svg]:!text-destructive",
      className
    )}
    {...props}
  />
))
StyledContextMenuItem.displayName = "StyledContextMenuItem"

// Styled separator - matches StyledDropdownMenuSeparator
export const StyledContextMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof ContextMenuSeparator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuSeparator>
>(({ className, ...props }, ref) => (
  <ContextMenuSeparator
    ref={ref}
    className={cn("bg-foreground/10", className)}
    {...props}
  />
))
StyledContextMenuSeparator.displayName = "StyledContextMenuSeparator"
