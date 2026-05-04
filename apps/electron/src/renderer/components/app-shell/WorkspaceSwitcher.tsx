import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { Check, FolderPlus, ExternalLink, ChevronDown, Cloud, CloudOff, X } from "lucide-react"
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
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon"
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState"
import type { Workspace } from "../../../shared/types"

interface WorkspaceSwitcherProps {
  variant?: 'sidebar' | 'topbar'
  isCollapsed?: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
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
  onWorkspaceRemoved,
  workspaceUnreadMap,
}: WorkspaceSwitcherProps) {
  const { t } = useTranslation()
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const [closedWorkspaceIds, setClosedWorkspaceIds] = useState<Set<string>>(() => new Set())
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const visibleTabWorkspaces = React.useMemo(
    () => workspaces.filter((workspace) => !closedWorkspaceIds.has(workspace.id) || workspace.id === activeWorkspaceId),
    [closedWorkspaceIds, activeWorkspaceId, workspaces],
  )
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  // Health check results for non-active remote workspaces (checked on dropdown open)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

  /** Check connectivity for all non-active remote workspaces when dropdown opens. */
  const checkRemoteHealth = useCallback(() => {
    // Cancel any in-flight checks
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(w => w.remoteServer && w.id !== activeWorkspaceId)
    if (remoteWorkspaces.length === 0) return

    // Mark all as checking
    setRemoteHealthMap(prev => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

    // Fire parallel checks
    for (const ws of remoteWorkspaces) {
      window.electronAPI.testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then(result => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap(prev => new Map(prev).set(ws.id, 'error'))
        })
    }
  }, [workspaces, activeWorkspaceId])

  /** Tooltip for disconnected remote workspaces — shows error kind. */
  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout') return t('toast.serverUnreachable')
      if (kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  /** True when we know a remote workspace is unreachable. */
  const isRemoteDisconnected = useCallback((workspaceId: string) => {
    // Active workspace: use live transport state
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    // Non-active: use health check result
    return remoteHealthMap.get(workspaceId) === 'error'
  }, [activeWorkspaceId, connectionState, isRemote, remoteHealthMap])

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    setClosedWorkspaceIds((prev) => {
      const next = new Set(prev)
      next.delete(workspace.id)
      return next
    })
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    onSelect(workspace.id)
  }

  const handleCloseWorkspaceTab = useCallback(async (workspace: Workspace) => {
    if (visibleTabWorkspaces.length <= 1) {
      return
    }

    if (workspace.id === activeWorkspaceId) {
      const currentIndex = visibleTabWorkspaces.findIndex((w) => w.id === workspace.id)
      const nextWorkspace = visibleTabWorkspaces[currentIndex + 1] ?? visibleTabWorkspaces[currentIndex - 1]
      if (!nextWorkspace) return
      await Promise.resolve(onSelect(nextWorkspace.id))
    }

    setClosedWorkspaceIds((prev) => new Set(prev).add(workspace.id))
  }, [activeWorkspaceId, onSelect, visibleTabWorkspaces])

  const handleCloseCreationScreen = useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleReconnectWorkspace = useCallback(async (workspaceId: string, remoteServer: { url: string; token: string; remoteWorkspaceId: string }) => {
    await window.electronAPI.updateWorkspaceRemoteServer(workspaceId, remoteServer)

    if (workspaceId === activeWorkspaceId) {
      await window.electronAPI.reconnectTransport()
      await waitForTransportConnected(window.electronAPI)
    } else {
      await Promise.resolve(onSelect(workspaceId))
      await waitForTransportConnected(window.electronAPI)
    }

    handleCloseCreationScreen()
    toast.success(t('toast.workspaceReconnected'))
  }, [activeWorkspaceId, handleCloseCreationScreen, onSelect, t])

  const handleWorkspaceSelect = useCallback((workspace: Workspace, openInNewWindow = false) => {
    const disconnected = isRemoteDisconnected(workspace.id)
    if (disconnected && workspace.remoteServer) {
      setReconnectTarget(workspace)
      setShowCreationScreen(true)
      setFullscreenOverlayOpen(true)
      return
    }
    if (disconnected) return
    if (!openInNewWindow) {
      setClosedWorkspaceIds((prev) => {
        if (!prev.has(workspace.id)) return prev
        const next = new Set(prev)
        next.delete(workspace.id)
        return next
      })
    }
    onSelect(workspace.id, openInNewWindow)
  }, [isRemoteDisconnected, onSelect, setFullscreenOverlayOpen])

  const renderWorkspaceMenuItems = () => workspaces.map((workspace) => {
    const disconnected = isRemoteDisconnected(workspace.id)
    return (
      <StyledDropdownMenuItem
        key={workspace.id}
        onClick={(e) => {
          const openInNewWindow = e.metaKey || e.ctrlKey
          handleWorkspaceSelect(workspace, openInNewWindow)
        }}
        className={cn(
          "justify-between group",
          activeWorkspaceId === workspace.id && "bg-foreground/10",
          disconnected && "opacity-60",
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
          {workspace.remoteServer && (
            disconnected
              ? <span title={getDisconnectTooltip(workspace.id)} className="shrink-0"><CloudOff className="h-3.5 w-3.5 text-destructive" /></span>
              : <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          {workspaceUnreadMap?.[workspace.id] && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
        </div>
        <div className="flex items-center gap-1">
          {activeWorkspaceId !== workspace.id && !disconnected && (
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/10 transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                onSelect(workspace.id, true)
              }}
              title={t("sidebarMenu.openInNewWindow")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
          {activeWorkspaceId === workspace.id && (
            <Check className="h-3.5 w-3.5" />
          )}
        </div>
      </StyledDropdownMenuItem>
    )
  })

  if (variant === 'topbar') {
    return (
      <>
        {/* Full-screen workspace creation overlay */}
        <AnimatePresence>
          {showCreationScreen && (
            <WorkspaceCreationScreen
              onWorkspaceCreated={handleWorkspaceCreated}
              onClose={handleCloseCreationScreen}
              reconnectWorkspace={reconnectTarget ?? undefined}
              onReconnectWorkspace={handleReconnectWorkspace}
            />
          )}
        </AnimatePresence>

        <div className="titlebar-no-drag flex min-w-0 items-center gap-1">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleTabWorkspaces.map((workspace) => {
              const active = workspace.id === activeWorkspaceId
              const disconnected = isRemoteDisconnected(workspace.id)
              return (
                <div
                  key={workspace.id}
                  className={cn(
                    "group relative flex h-[30px] max-w-[180px] shrink-0 items-center rounded-t-[8px] border text-[13px] transition-colors",
                    active
                      ? "border-foreground/12 bg-background/70 text-foreground shadow-xs"
                      : "border-transparent bg-foreground/[0.035] text-foreground/55 hover:bg-foreground/7 hover:text-foreground/85",
                    disconnected && "opacity-60"
                  )}
                  title={workspace.name}
                >
                  <button
                    type="button"
                    onClick={(e) => handleWorkspaceSelect(workspace, e.metaKey || e.ctrlKey)}
                    className="flex h-full min-w-0 items-center gap-1.5 px-2.5"
                    aria-current={active ? "page" : undefined}
                    aria-label={`Switch to ${workspace.name}`}
                  >
                    <CrossfadeAvatar
                      src={workspaceIconMap.get(workspace.id)}
                      alt={workspace.name}
                      className="h-4 w-4 shrink-0 rounded-full ring-1 ring-border/50"
                      fallbackClassName="bg-muted text-[10px] rounded-full"
                      fallback={workspace.name.charAt(0)}
                    />
                    <span className="min-w-0 truncate">{workspace.name}</span>
                    {workspace.remoteServer && (
                      disconnected
                        ? <CloudOff className="h-3 w-3 shrink-0 text-destructive" />
                        : <Cloud className="h-3 w-3 shrink-0 opacity-60" />
                    )}
                    {workspaceUnreadMap?.[workspace.id] && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  </button>
                  {visibleTabWorkspaces.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCloseWorkspaceTab(workspace)
                      }}
                      className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-foreground/35 opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground/80 group-hover:opacity-100"
                      aria-label={`Close ${workspace.name}`}
                      title="Close workspace"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <DropdownMenu onOpenChange={(open) => { if (open) checkRemoteHealth() }}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-transparent bg-foreground/[0.035] text-foreground/55 transition-colors hover:bg-foreground/7 hover:text-foreground data-[state=open]:bg-foreground/7"
                aria-label="Workspace menu"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="center" sideOffset={6} minWidth="min-w-64">
              {renderWorkspaceMenuItems()}
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={handleNewWorkspace} className="font-sans">
                <FolderPlus className="h-4 w-4" />
                {t("workspace.addWorkspace")}
              </StyledDropdownMenuItem>
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Full-screen workspace creation overlay */}
      <AnimatePresence>
        {showCreationScreen && (
          <WorkspaceCreationScreen
            onWorkspaceCreated={handleWorkspaceCreated}
            onClose={handleCloseCreationScreen}
            reconnectWorkspace={reconnectTarget ?? undefined}
            onReconnectWorkspace={handleReconnectWorkspace}
          />
        )}
      </AnimatePresence>

      <DropdownMenu onOpenChange={(open) => { if (open) checkRemoteHealth() }}>
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
                  {selectedWorkspace?.remoteServer && (
                    isRemoteDisconnected(selectedWorkspace.id)
                      ? <CloudOff className="h-3 w-3 text-destructive shrink-0" />
                      : <Cloud className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                </>
              )}
            </button>
        </DropdownMenuTrigger>

        <StyledDropdownMenuContent align="start" sideOffset={4}>
          {renderWorkspaceMenuItems()}

          {/* Separator and New Workspace option */}
          <StyledDropdownMenuSeparator />
          <StyledDropdownMenuItem
            onClick={handleNewWorkspace}
            className="font-sans"
          >
            <FolderPlus className="h-4 w-4" />
            {t("workspace.addWorkspace")}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
