import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence } from "motion/react"
import { Cloud, CloudOff, FolderOpen, FolderPlus } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { toast } from "sonner"
import { useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import { CrossfadeAvatar } from "@/components/ui/avatar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { waitForTransportConnected } from "@/lib/transport-wait"
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon"
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState"
import type { Workspace } from "../../../shared/types"

interface WorkspaceRailProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  workspaceUnreadMap?: Record<string, boolean>
}

export function WorkspaceRail({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onWorkspaceCreated,
  workspaceUnreadMap,
}: WorkspaceRailProps) {
  const { t } = useTranslation()
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [creationStep, setCreationStep] = useState<'choice' | 'create' | 'open'>('choice')
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  const checkRemoteHealth = useCallback(() => {
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(w => w.remoteServer && w.id !== activeWorkspaceId)
    if (remoteWorkspaces.length === 0) return

    setRemoteHealthMap(prev => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

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
  }, [activeWorkspaceId, workspaces])

  useEffect(() => {
    checkRemoteHealth()
    return () => healthCheckAbort.current?.abort()
  }, [checkRemoteHealth])

  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout') return t('toast.serverUnreachable')
      if (kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  const isRemoteDisconnected = useCallback((workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    return remoteHealthMap.get(workspaceId) === 'error'
  }, [activeWorkspaceId, connectionState, isRemote, remoteHealthMap])

  const openWorkspaceCreation = (step: 'choice' | 'create' | 'open') => {
    setCreationStep(step)
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

  const handleNewWorkspace = () => openWorkspaceCreation('create')
  const handleOpenWorkspace = () => openWorkspaceCreation('open')

  const handleCloseCreationScreen = useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    onSelect(workspace.id)
  }

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
    onSelect(workspace.id, openInNewWindow)
  }, [isRemoteDisconnected, onSelect, setFullscreenOverlayOpen])

  return (
    <>
      <AnimatePresence>
        {showCreationScreen && (
          <WorkspaceCreationScreen
            onWorkspaceCreated={handleWorkspaceCreated}
            onClose={handleCloseCreationScreen}
            initialStep={reconnectTarget ? undefined : creationStep}
            reconnectWorkspace={reconnectTarget ?? undefined}
            onReconnectWorkspace={handleReconnectWorkspace}
          />
        )}
      </AnimatePresence>

      <aside className="titlebar-no-drag -mb-16 flex h-[calc(100%+64px)] w-[56px] shrink-0 flex-col items-center justify-end">
        <div className="runneros-workspace-dock flex max-h-full min-h-0 flex-col items-center gap-1.5 overflow-y-auto px-1.5 pb-2.5 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId
            const disconnected = isRemoteDisconnected(workspace.id)
            const unread = workspaceUnreadMap?.[workspace.id]

            return (
              <Tooltip key={workspace.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => handleWorkspaceSelect(workspace, e.metaKey || e.ctrlKey)}
                    className={cn(
                      "group relative flex h-8 w-8 items-center justify-center rounded-[10px] border transition-all duration-200",
                      active
                        ? "border-[#fb923c]/70 bg-transparent text-white"
                        : "border-white/[0.08] bg-transparent text-white/42 hover:border-white/16 hover:bg-white/[0.035] hover:text-white/75",
                      disconnected && "opacity-55",
                    )}
                    aria-current={active ? "page" : undefined}
                    aria-label={`Switch to ${workspace.name}`}
                  >
                    <CrossfadeAvatar
                      src={workspaceIconMap.get(workspace.id)}
                      alt={workspace.name}
                      className="h-5 w-5 rounded-[7px]"
                      fallbackClassName={cn(
                        "text-[10px] rounded-[7px]",
                        active ? "bg-transparent text-white" : "bg-transparent text-white/55",
                      )}
                      fallback={workspace.name.charAt(0)}
                    />
                    {unread && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[#050507] bg-[#fb923c]" />
                    )}
                    {workspace.remoteServer && (
                      <span
                        title={disconnected ? getDisconnectTooltip(workspace.id) : undefined}
                        className={cn(
                          "absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-[5px] border border-background",
                          active ? "bg-background text-foreground" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {disconnected ? <CloudOff className="h-2.5 w-2.5 text-destructive" /> : <Cloud className="h-2.5 w-2.5" />}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{workspace.name}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/[0.08] bg-transparent text-white/38 transition-colors hover:border-white/16 hover:bg-white/[0.035] hover:text-white/75"
              aria-label={t("workspace.addWorkspace")}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent side="top" align="start" sideOffset={8} minWidth="min-w-44">
            <StyledDropdownMenuItem onClick={handleNewWorkspace}>
              <FolderPlus className="h-3.5 w-3.5" />
              {t("workspace.createNew")}
            </StyledDropdownMenuItem>
            <StyledDropdownMenuItem onClick={handleOpenWorkspace}>
              <FolderOpen className="h-3.5 w-3.5" />
              {t("workspace.openFolder")}
            </StyledDropdownMenuItem>
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </aside>
    </>
  )
}
