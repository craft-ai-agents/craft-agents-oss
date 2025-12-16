import * as React from "react"

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

export function WorkspaceSwitcher({
  isCollapsed,
  workspaces,
  activeWorkspaceId,
  onSelect,
}: WorkspaceSwitcherProps) {
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  return (
    <Select value={activeWorkspaceId || undefined} onValueChange={onSelect}>
      <SelectTrigger
        className={cn(
          "flex items-center gap-2 [&>span]:line-clamp-1 [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-1 [&>span]:truncate [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
          isCollapsed &&
            "flex h-9 w-9 shrink-0 items-center justify-center p-0 [&>span]:w-auto [&>svg]:hidden"
        )}
        aria-label="Select workspace"
      >
        <SelectValue placeholder="Select workspace">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {selectedWorkspace?.name?.charAt(0) || 'W'}
            </AvatarFallback>
          </Avatar>
          <span className={cn("ml-2", isCollapsed && "hidden")}>
            {selectedWorkspace?.name || 'Select workspace'}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.id} value={workspace.id}>
            <div className="flex items-center gap-3">
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
