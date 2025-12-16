import * as React from "react"
import { useRef, useState, useEffect } from "react"

import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  isCollapsed: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string) => void
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
 * - SelectTrigger: Button showing current workspace avatar + name
 * - Avatar: Circular badge with first letter of workspace name
 * - SelectContent: Dropdown menu listing all workspaces
 * - SelectItem: Individual workspace option (avatar + name)
 *
 * When sidebar is collapsed: Shows only the avatar (icon-only mode)
 */
export function WorkspaceSwitcher({
  isCollapsed,
  workspaces,
  activeWorkspaceId,
  onSelect,
}: WorkspaceSwitcherProps) {
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  return (
    <Select value={activeWorkspaceId || undefined} onValueChange={onSelect}>
      {/* Trigger Button: Shows current workspace */}
      <SelectTrigger
        className={cn(
          "flex items-center gap-2 [&>span]:line-clamp-1 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:truncate [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
          isCollapsed &&
            "flex h-9 w-9 shrink-0 items-center justify-center p-0 [&>span]:w-auto [&>svg]:hidden"
        )}
        aria-label="Select workspace"
      >
        <SelectValue placeholder="Select workspace">
          {/* Workspace Avatar: First letter of name */}
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {selectedWorkspace?.name?.charAt(0) || 'W'}
            </AvatarFallback>
          </Avatar>
          {/* Workspace Name: Hidden when collapsed, gradient fade on overflow */}
          {!isCollapsed && (
            <FadingText className="ml-2 font-sans" fadeWidth={36}>
              {selectedWorkspace?.name || 'Select workspace'}
            </FadingText>
          )}
        </SelectValue>
      </SelectTrigger>
      {/* Dropdown Content: List of all workspaces */}
      <SelectContent>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            <div className="flex items-center gap-3 font-sans">
              <Avatar className="h-5 w-5">
                <AvatarFallback className="text-xs bg-muted">
                  {workspace.name.charAt(0)}
                </AvatarFallback>
              </Avatar>
              {workspace.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
