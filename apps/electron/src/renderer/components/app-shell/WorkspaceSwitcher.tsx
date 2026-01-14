import * as React from "react"
import { useState, useEffect } from "react"
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
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  isCollapsed: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void
  onWorkspaceCreated?: (workspace: Workspace) => void
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
  onWorkspaceCreated,
}: WorkspaceSwitcherProps) {
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  // Cache stores { dataUrl, sourceUrl } to detect when icon file changes
  const [iconCache, setIconCache] = useState<Record<string, { dataUrl: string; sourceUrl: string }>>({})
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)

  // Fetch workspace icons via IPC (converts local files to data URLs)
  useEffect(() => {
    const fetchIcons = async () => {
      for (const workspace of workspaces) {
        // Skip if workspace has a remote iconUrl (use directly, no caching needed)
        if (workspace.iconUrl?.startsWith('http://') || workspace.iconUrl?.startsWith('https://')) continue

        // Extract icon filename from file:// URL (e.g., "file:///path/to/icon.png?t=123" -> "icon.png")
        if (!workspace.iconUrl?.startsWith('file://')) continue
        // Remove query params (cache-buster) before extracting filename
        const urlWithoutQuery = workspace.iconUrl.split('?')[0]
        const iconFilename = urlWithoutQuery.split('/').pop()
        if (!iconFilename) continue

        // Skip if already cached with the same source URL
        const cached = iconCache[workspace.id]
        if (cached && cached.sourceUrl === workspace.iconUrl) continue

        try {
          const result = await window.electronAPI.readWorkspaceImage(workspace.id, iconFilename)
          if (result) {
            // readWorkspaceImage returns raw SVG for .svg files, data URL for others
            let dataUrl = result
            if (iconFilename.endsWith('.svg')) {
              dataUrl = `data:image/svg+xml;base64,${btoa(result)}`
            }
            setIconCache(prev => ({ ...prev, [workspace.id]: { dataUrl, sourceUrl: workspace.iconUrl! } }))
          }
        } catch (error) {
          console.error(`Failed to load icon for workspace ${workspace.id}:`, error)
        }
      }
    }
    fetchIcons()
  }, [workspaces])

  // Merge iconCache with workspace iconUrls
  const getIconUrl = (workspace: Workspace): string | undefined => {
    // If cached, use the data URL
    const cached = iconCache[workspace.id]
    if (cached) return cached.dataUrl
    // If remote URL, use it directly
    if (workspace.iconUrl?.startsWith('http://') || workspace.iconUrl?.startsWith('https://')) {
      return workspace.iconUrl
    }
    // Otherwise, no icon yet (will show fallback)
    return undefined
  }

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
          {/* Workspace Avatar: Image with crossfade, border, first letter fallback */}
          <CrossfadeAvatar
            src={selectedWorkspace ? getIconUrl(selectedWorkspace) : undefined}
            alt={selectedWorkspace?.name}
            className="h-4 w-4 rounded-full ring-1 ring-border/50"
            fallbackClassName="bg-foreground text-background text-[10px] rounded-full"
            fallback={selectedWorkspace?.name?.charAt(0) || 'W'}
          />
          {/* Workspace Name: Hidden when collapsed, gradient fade on overflow */}
          {!isCollapsed && (
            <>
              <FadingText className="ml-1 font-sans min-w-0 text-sm" fadeWidth={36}>
                {selectedWorkspace?.name || 'Select workspace'}
              </FadingText>
              <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      {/* Dropdown Content: List of all workspaces */}
      <StyledDropdownMenuContent align="start" sideOffset={4}>
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
            <div className="flex items-center gap-3 font-sans">
              <CrossfadeAvatar
                src={getIconUrl(workspace)}
                alt={workspace.name}
                className="h-5 w-5 rounded-full ring-1 ring-border/50"
                fallbackClassName="bg-muted text-xs rounded-full"
                fallback={workspace.name.charAt(0)}
              />
              {workspace.name}
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
