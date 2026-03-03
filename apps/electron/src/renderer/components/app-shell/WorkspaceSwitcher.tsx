import * as React from "react"
import { useState } from "react"
import { Check, FolderPlus, ExternalLink, ChevronDown } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from "@/components/ui/styled-dropdown"
import { CrossfadeAvatar } from "@/components/ui/avatar"
import { FadingText } from "@/components/ui/fading-text"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon"
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  variant?: 'sidebar' | 'topbar'
  isCollapsed?: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void
  onWorkspaceCreated?: (workspace: Workspace) => void
  /** workspaceId -> has unread */
  workspaceUnreadMap?: Record<string, boolean>
}

/**
 * WorkspaceSwitcher - Dropdown to select active workspace.
 *
 * Supports two trigger variants:
 * - sidebar: bottom-left selector trigger
 * - topbar: center top-bar selector trigger
 */
export function WorkspaceSwitcher({
  variant = 'sidebar',
  isCollapsed = false,
  workspaces,
  activeWorkspaceId,
  onSelect,
  onWorkspaceCreated,
  workspaceUnreadMap,
}: WorkspaceSwitcherProps) {
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  const hasUnreadInOtherWorkspaces = React.useMemo(() => {
    if (!activeWorkspaceId || !workspaceUnreadMap) return false
    return workspaces.some((workspace) => workspace.id !== activeWorkspaceId && workspaceUnreadMap[workspace.id])
  }, [workspaces, activeWorkspaceId, workspaceUnreadMap])

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(`Created workspace "${workspace.name}"`)
    onWorkspaceCreated?.(workspace)
    onSelect(workspace.id)
  }

  const handleCloseCreationScreen = () => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
  }

  return (
    <>
      {/* Full-screen workspace creation overlay */}
      <AnimatePresence>
        {showCreationScreen && (
          <WorkspaceCreationScreen
            onWorkspaceCreated={handleWorkspaceCreated}
            onClose={handleCloseCreationScreen}
          />
        )}
      </AnimatePresence>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {variant === 'topbar' ? (
            <button
              type="button"
              className="titlebar-no-drag ml-1 flex-1 min-w-0 flex items-center justify-start gap-0.5 h-[30px] px-3 rounded-[8px] border border-foreground/6 text-[13px] text-foreground/50 hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground"
              aria-label="Select workspace"
            >
              <CrossfadeAvatar
                src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
                alt={selectedWorkspace?.name}
                className="h-4 w-4 mr-1.5 rounded-full ring-1 ring-border/50"
                fallbackClassName="bg-muted text-[10px] rounded-full"
                fallback={selectedWorkspace?.name?.charAt(0) || 'W'}
              />
              <span className="truncate min-w-0 flex-1 text-left">{selectedWorkspace?.name || 'Workspace'}</span>
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
              {hasUnreadInOtherWorkspaces && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
            </button>
          ) : (
            <button
              className={cn(
                "flex items-center gap-1 w-full min-w-0 justify-start px-2 py-1.5 rounded-md",
                "text-foreground hover:bg-foreground/5 data-[state=open]:bg-foreground/5 transition-colors duration-150",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isCollapsed && "h-9 w-9 shrink-0 justify-center p-0"
              )}
              aria-label="Select workspace"
            >
              <CrossfadeAvatar
                src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
                alt={selectedWorkspace?.name}
                className="h-4 w-4 rounded-full ring-1 ring-border/50"
                fallbackClassName="bg-foreground text-background text-[10px] rounded-full"
                fallback={selectedWorkspace?.name?.charAt(0) || 'W'}
              />
              {!isCollapsed && (
                <>
                  <FadingText className="ml-1 font-sans min-w-0 text-sm" fadeWidth={36}>
                    {selectedWorkspace?.name || 'Select workspace'}
                  </FadingText>
                  <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                </>
              )}
            </button>
          )}
        </DropdownMenuTrigger>

        <StyledDropdownMenuContent
          align={variant === 'topbar' ? 'center' : 'start'}
          sideOffset={variant === 'topbar' ? 6 : 4}
          minWidth={variant === 'topbar' ? 'min-w-64' : undefined}
        >
          {workspaces.map((workspace) => (
            <StyledDropdownMenuItem
              key={workspace.id}
              onClick={(e) => {
                // Cmd/Ctrl+Click opens in new window
                const openInNewWindow = e.metaKey || e.ctrlKey
                onSelect(workspace.id, openInNewWindow)
              }}
              className={cn(
                "justify-between group",
                activeWorkspaceId === workspace.id && "bg-foreground/10"
              )}
            >
              <div className="flex items-center gap-3 font-sans min-w-0 flex-1">
                <CrossfadeAvatar
                  src={workspaceIconMap.get(workspace.id)}
                  alt={workspace.name}
                  className="h-5 w-5 rounded-full ring-1 ring-border/50"
                  fallbackClassName="bg-muted text-xs rounded-full"
                  fallback={workspace.name.charAt(0)}
                />
                <span className="truncate">{workspace.name}</span>
                {workspaceUnreadMap?.[workspace.id] && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
              </div>
              <div className="flex items-center gap-1">
                {/* Open in new window button - only visible on hover for non-active workspaces */}
                {activeWorkspaceId !== workspace.id && (
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/10 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(workspace.id, true)
                    }}
                    title="Open in new window"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                )}
                {activeWorkspaceId === workspace.id && (
                  <Check className="h-3.5 w-3.5" />
                )}
              </div>
            </StyledDropdownMenuItem>
          ))}

          {/* Separator and New Workspace option */}
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={handleNewWorkspace}
            className="font-sans"
          >
            <FolderPlus className="h-4 w-4" />
            Add Workspace...
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
