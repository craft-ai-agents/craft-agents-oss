import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * Styled Dropdown Components
 *
 * Pre-styled dropdown components matching the AppMenu vibrancy style:
 * - Semi-transparent background with blur (macOS vibrancy effect)
 * - Forced dark mode
 * - Consistent item spacing and hover states
 *
 * These wrap the base dropdown-menu components with consistent styling.
 */

// Re-export unchanged components
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuShortcut }

// Styled content with vibrancy effect
interface StyledDropdownMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuContent> {
  /** Minimum width - defaults to min-w-40 */
  minWidth?: string
}

export const StyledDropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuContent>,
  StyledDropdownMenuContentProps
>(({ className, minWidth = "min-w-40", ...props }, ref) => (
  <DropdownMenuContent
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
StyledDropdownMenuContent.displayName = "StyledDropdownMenuContent"

// Styled menu item with consistent hover states
interface StyledDropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuItem> {
  /** Destructive variant - red text */
  variant?: "default" | "destructive"
}

export const StyledDropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuItem>,
  StyledDropdownMenuItemProps
>(({ className, variant = "default", ...props }, ref) => (
  <DropdownMenuItem
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
StyledDropdownMenuItem.displayName = "StyledDropdownMenuItem"

// Styled separator
export const StyledDropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuSeparator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuSeparator>
>(({ className, ...props }, ref) => (
  <DropdownMenuSeparator
    ref={ref}
    className={cn("bg-foreground/10", className)}
    {...props}
  />
))
StyledDropdownMenuSeparator.displayName = "StyledDropdownMenuSeparator"
