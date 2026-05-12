import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { Check, FolderPlus, ExternalLink, ChevronDown, Cloud, CloudOff, Trash2 } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer"
import { CrossfadeAvatar } from "@/components/ui/avatar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from "@/hooks/useWorkspaceIcon"
import { useTransportConnectionState } from "@/hooks/useTransportConnectionState"
import type { Workspace } from "../../../shared/types"

interface CompactWorkspaceSwitcherProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelect: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  workspaceUnreadMap?: Record<string, boolean>
}

/**
 * CompactWorkspaceSwitcher — bottom-sheet workspace picker for compact/touch mode.
 *
 * Mirrors the topbar trigger from `WorkspaceSwitcher` (avatar pill with chevron)
 * but opens a Drawer instead of a Radix DropdownMenu so the picker is
 * touch-friendly and avoids the awkward popover anchoring on narrow viewports.
 */
export function CompactWorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  workspaceUnreadMap,
}: CompactWorkspaceSwitcherProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showCreationScreen, setShowCreationScreen] = useState(false)
  const [reconnectTarget, setReconnectTarget] = useState<Workspace | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  // Health check results for non-active remote workspaces (checked on drawer open)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

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
  }, [workspaces, activeWorkspaceId])

  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout') return t('toast.serverUnreachable')
      if (kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  const isRemoteDisconnected = (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) {
      if (!isRemote || !connectionState) return false
      const { status } = connectionState
      return status !== 'connected' && status !== 'connecting' && status !== 'idle'
    }
    return remoteHealthMap.get(workspaceId) === 'error'
  }

  const hasUnreadInOtherWorkspaces = React.useMemo(() => {
    if (!activeWorkspaceId || !workspaceUnreadMap) return false
    return workspaces.some((workspace) => workspace.id !== activeWorkspaceId && workspaceUnreadMap[workspace.id])
  }, [workspaces, activeWorkspaceId, workspaceUnreadMap])

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
    setOpen(false)
  }

  const handleWorkspaceCreated = (workspace: Workspace) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    onSelect(workspace.id)
  }

  const handleRemoveWorkspace = useCallback(async (workspace: Workspace) => {
    if (workspace.id === activeWorkspaceId) {
      toast.error(t('toast.cannotRemoveActiveWorkspace'))
      return
    }
    const removed = await window.electronAPI.removeWorkspace(workspace.id)
    if (removed) {
      toast.success(t('toast.removedWorkspace', { name: workspace.name }))
      onWorkspaceRemoved?.()
    }
  }, [activeWorkspaceId, onWorkspaceRemoved, t])

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

      <Drawer open={open} onOpenChange={(next) => { setOpen(next); if (next) checkRemoteHealth() }}>
        <DrawerTrigger asChild>
          <button
            type="button"
            data-workspace-switcher="topbar"
            className="titlebar-no-drag ml-1 h-9 flex-1 min-w-0 flex items-center justify-start gap-1 px-3 rounded-[8px] border border-foreground/6 text-sm text-foreground/55 hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground"
            aria-label={t('workspace.selectWorkspace')}
          >
            <CrossfadeAvatar
              src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
              alt={selectedWorkspace?.name}
              className="h-5 w-5 mr-1.5 rounded-full ring-1 ring-border/50"
              fallbackClassName="bg-muted text-[11px] rounded-full"
              fallback={selectedWorkspace?.name?.charAt(0) || 'W'}
            />
            <span className="truncate min-w-0 flex-1 text-left">{selectedWorkspace?.name || 'Workspace'}</span>
            {selectedWorkspace?.remoteServer && (
              isRemoteDisconnected(selectedWorkspace.id)
                ? <CloudOff className="h-3 w-3 text-destructive shrink-0" />
                : <Cloud className="h-3 w-3 opacity-60 shrink-0" />
            )}
            <ChevronDown data-slot="chevron" className="h-3 w-3 opacity-60 shrink-0" />
            {hasUnreadInOtherWorkspaces && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
          </button>
        </DrawerTrigger>

        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('workspace.selectWorkspace')}</DrawerTitle>
          </DrawerHeader>

          <div className="px-2 pb-2 flex flex-col gap-0.5 max-h-[60vh] overflow-y-auto">
            {workspaces.map((workspace) => {
              const disconnected = isRemoteDisconnected(workspace.id)
              const isActive = activeWorkspaceId === workspace.id
              const handleSelect = () => {
                if (disconnected && workspace.remoteServer) {
                  setReconnectTarget(workspace)
                  setShowCreationScreen(true)
                  setFullscreenOverlayOpen(true)
                  setOpen(false)
                  return
                }
                if (disconnected) return
                onSelect(workspace.id)
                setOpen(false)
              }
              return (
                <div
                  key={workspace.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-[10px] transition-colors",
                    isActive ? "bg-foreground/5" : "hover:bg-foreground/5",
                    disconnected && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    onClick={handleSelect}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left outline-none"
                  >
                    <CrossfadeAvatar
                      src={workspaceIconMap.get(workspace.id)}
                      alt={workspace.name}
                      className="h-7 w-7 rounded-full ring-1 ring-border/50 shrink-0"
                      fallbackClassName="bg-muted text-sm rounded-full"
                      fallback={workspace.name.charAt(0)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-medium">{workspace.name}</span>
                        {workspaceUnreadMap?.[workspace.id] && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
                      </div>
                      {workspace.remoteServer && (
                        <div className="flex items-center gap-1 text-xs text-foreground/50 mt-0.5">
                          {disconnected
                            ? <><CloudOff className="h-3 w-3 text-destructive shrink-0" /><span title={getDisconnectTooltip(workspace.id)}>{t('toast.disconnected')}</span></>
                            : <><Cloud className="h-3 w-3 shrink-0" /><span className="truncate">{workspace.remoteServer.url}</span></>
                          }
                        </div>
                      )}
                    </div>
                  </button>
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWorkspace(workspace)}
                      className="shrink-0 h-9 w-9 rounded-[8px] flex items-center justify-center text-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={t("workspace.removeWorkspace")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  {!isActive && !disconnected && (
                    <button
                      type="button"
                      onClick={() => { onSelect(workspace.id, true); setOpen(false) }}
                      className="shrink-0 h-9 w-9 rounded-[8px] flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-foreground/10 transition-colors"
                      aria-label={t("sidebarMenu.openInNewWindow")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  )}
                  {isActive && (
                    <Check className="h-4 w-4 shrink-0 text-foreground/60 mr-2" />
                  )}
                </div>
              )
            })}

            <DrawerClose asChild>
              <button
                type="button"
                onClick={handleNewWorkspace}
                className="mt-1 flex items-center gap-3 px-3 py-3 rounded-[10px] hover:bg-foreground/5 transition-colors text-left"
              >
                <div className="h-7 w-7 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                  <FolderPlus className="h-4 w-4 text-foreground/60" />
                </div>
                <span className="text-sm font-medium">{t("workspace.addWorkspace")}</span>
              </button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
