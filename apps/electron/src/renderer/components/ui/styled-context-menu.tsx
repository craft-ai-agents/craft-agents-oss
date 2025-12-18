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
 * Pre-styled context menu components matching the AppMenu vibrancy style:
 * - Semi-transparent background with blur (macOS vibrancy effect)
 * - Forced dark mode
 * - Consistent item spacing and hover states
 *
 * These wrap the base context-menu components with consistent styling.
 */

// Re-export unchanged components
export { ContextMenu, ContextMenuTrigger }

// Styled content with vibrancy effect
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
      "w-fit font-sans whitespace-nowrap text-xs dark bg-background/80 backdrop-blur-xl backdrop-saturate-150 border-border/50 flex flex-col gap-0.5",
      minWidth,
      className
    )}
    style={{ borderRadius: '8px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)' }}
    {...props}
  />
))
StyledContextMenuContent.displayName = "StyledContextMenuContent"

// Styled menu item with consistent hover states
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
      "gap-3 pr-4 rounded-[4px] hover:bg-foreground/10 focus:bg-foreground/10",
      "[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
      variant === "destructive" && "text-destructive focus:text-destructive hover:text-destructive",
      className
    )}
    {...props}
  />
))
StyledContextMenuItem.displayName = "StyledContextMenuItem"

// Styled separator
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
