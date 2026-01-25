import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
} from "./dropdown-menu"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
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
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuShortcut, DropdownMenuSub }

// Styled content with vibrancy effect
interface StyledDropdownMenuContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuContent> {
  /** Minimum width - defaults to min-w-40 */
  minWidth?: string
  /** Force light mode instead of dark */
  light?: boolean
}

export const StyledDropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuContent>,
  StyledDropdownMenuContentProps
>(({ className, minWidth = "min-w-40", light = false, ...props }, ref) => (
  <DropdownMenuContent
    ref={ref}
    className={cn(
      "w-fit font-sans whitespace-nowrap text-xs flex flex-col gap-0.5",
      minWidth,
      className
    )}
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
      "items-center gap-2 pr-4 rounded-[4px] hover:bg-foreground/[0.03] focus:bg-foreground/[0.03]",
      "[&_svg]:size-auto [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
      variant === "destructive" && "text-destructive focus:text-destructive hover:text-destructive [&_svg]:!text-destructive",
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

// Styled sub-menu trigger
export const StyledDropdownMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuSubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuSubTrigger>
>(({ className, ...props }, ref) => (
  <DropdownMenuSubTrigger
    ref={ref}
    className={cn(
      "items-center gap-2 pr-1.5 rounded-[4px] hover:bg-foreground/10 focus:bg-foreground/10 data-[state=open]:bg-foreground/10",
      "[&_svg]:size-auto [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0",
      className
    )}
    {...props}
  />
))
StyledDropdownMenuSubTrigger.displayName = "StyledDropdownMenuSubTrigger"

// Styled sub-menu content
interface StyledDropdownMenuSubContentProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> {
  /** Minimum width - defaults to min-w-40 */
  minWidth?: string
}

export const StyledDropdownMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  StyledDropdownMenuSubContentProps
>(({ className, minWidth = "min-w-36", sideOffset = -4, ...props }, ref) => (
  <DropdownMenuPortal>
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "popover-styled w-fit font-sans whitespace-nowrap text-xs flex flex-col gap-0.5 z-dropdown overflow-hidden p-1",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        minWidth,
        className
      )}
      {...props}
    />
  </DropdownMenuPortal>
))
StyledDropdownMenuSubContent.displayName = "StyledDropdownMenuSubContent"
