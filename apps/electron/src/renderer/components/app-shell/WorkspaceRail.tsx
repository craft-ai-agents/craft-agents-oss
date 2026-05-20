import * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence } from "motion/react"
import { Cloud, CloudOff, FolderPlus } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@craft-agent/ui"
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

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
  }

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
            reconnectWorkspace={reconnectTarget ?? undefined}
            onReconnectWorkspace={handleReconnectWorkspace}
          />
        )}
      </AnimatePresence>

      <aside className="titlebar-no-drag flex h-full w-[56px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#050507]/95 py-3 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)]">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                      "group relative flex h-10 w-10 items-center justify-center rounded-[12px] border transition-all duration-200",
                      active
                        ? "border-[#7c7cff]/50 bg-[#151525] text-white shadow-[0_0_24px_rgba(94,106,210,0.32)]"
                        : "border-white/[0.06] bg-white/[0.035] text-white/55 hover:border-white/15 hover:bg-white/[0.08] hover:text-white",
                      disconnected && "opacity-55",
                    )}
                    aria-current={active ? "page" : undefined}
                    aria-label={`Switch to ${workspace.name}`}
                  >
                    <CrossfadeAvatar
                      src={workspaceIconMap.get(workspace.id)}
                      alt={workspace.name}
                      className="h-6 w-6 rounded-[8px] ring-1 ring-white/10"
                      fallbackClassName={cn(
                        "text-[11px] rounded-[8px]",
                        active ? "bg-[#f7f8ff] text-[#101018]" : "bg-white/[0.08] text-white",
                      )}
                      fallback={workspace.name.charAt(0)}
                    />
                    {active && (
                      <span className="absolute -left-2 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-[#8b8cff] shadow-[0_0_14px_rgba(139,140,255,0.75)]" />
                    )}
                    {unread && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-[#050507] bg-[#8b8cff]" />
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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleNewWorkspace}
              className="mt-2 flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/[0.06] bg-white/[0.035] text-white/45 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
              aria-label={t("workspace.addWorkspace")}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("workspace.addWorkspace")}</TooltipContent>
        </Tooltip>
      </aside>
    </>
  )
}
