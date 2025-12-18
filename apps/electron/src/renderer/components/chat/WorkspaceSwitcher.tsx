import * as React from "react"
import { useRef, useState, useEffect } from "react"
import { Check, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  isCollapsed: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void
  onAddWorkspace?: () => void
}

/**
 * FadingText - Text that fades with gradient only when overflowing
 */
function FadingText({
  children,
  className,
  fadeWidth = 36
}: {
  children: React.ReactNode
  className?: string
  fadeWidth?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const checkOverflow = () => {
      setIsOverflowing(el.scrollWidth > el.clientWidth)
    }

    checkOverflow()

    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)

    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={ref}
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap",
        className
      )}
      style={isOverflowing ? {
        maskImage: `linear-gradient(to right, black calc(100% - ${fadeWidth}px), transparent)`
      } : undefined}
    >
      {children}
    </span>
  )
}

/**
 * WorkspaceSwitcher - Dropdown to select active workspace
 *
 * Elements:
 * - Trigger: Button showing current workspace avatar + name
 * - Avatar: Circular badge with first letter of workspace name
 * - Content: Dropdown menu listing all workspaces
 * - Item: Individual workspace option (avatar + name + checkmark if selected)
 *
 * When sidebar is collapsed: Shows only the avatar (icon-only mode)
 */
export function WorkspaceSwitcher({
  isCollapsed,
  workspaces,
  activeWorkspaceId,
  onSelect,
  onAddWorkspace,
}: WorkspaceSwitcherProps) {
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  return (
    <DropdownMenu>
      {/* Trigger Button: Shows current workspace
          Hover effect: subtle background tint */}
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1 w-full min-w-0 justify-start px-2 py-1.5 rounded-md",
            "text-foreground hover:bg-foreground/5 data-[state=open]:bg-foreground/5 transition-colors duration-150",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isCollapsed && "h-9 w-9 shrink-0 justify-center p-0"
          )}
          aria-label="Select workspace"
        >
          {/* Workspace Avatar: First letter of name */}
          <Avatar className="h-4 w-4 shrink-0">
            <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
              {selectedWorkspace?.name?.charAt(0) || 'W'}
            </AvatarFallback>
          </Avatar>
          {/* Workspace Name: Hidden when collapsed, gradient fade on overflow */}
          {!isCollapsed && (
            <FadingText className="ml-1 font-sans min-w-0 text-sm" fadeWidth={36}>
              {selectedWorkspace?.name || 'Select workspace'}
            </FadingText>
          )}
        </button>
      </DropdownMenuTrigger>
      {/* Dropdown Content: List of all workspaces */}
      <StyledDropdownMenuContent align="start" sideOffset={4}>
        {workspaces.map((workspace) => (
          <StyledDropdownMenuItem
            key={workspace.id}
            onClick={() => onSelect(workspace.id)}
            className={cn(
              "justify-between",
              activeWorkspaceId === workspace.id && "bg-foreground/10"
            )}
          >
            <div className="flex items-center gap-3 font-sans">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-xs bg-muted">
                  {workspace.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              {workspace.name}
            </div>
            {activeWorkspaceId === workspace.id && (
              <Check className="h-3.5 w-3.5 ml-2" />
            )}
          </StyledDropdownMenuItem>
        ))}
        {onAddWorkspace && (
          <>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={onAddWorkspace}>
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
              Add Workspace
            </StyledDropdownMenuItem>
          </>
        )}
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
