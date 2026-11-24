import * as React from "react"
import { useTranslation } from "react-i18next"
import { useState, useCallback, useRef } from "react"
import { Check, FolderPlus, ExternalLink, ChevronDown, Cloud, CloudOff, Trash2 } from "lucide-react"
import { AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { isWebUI } from "@/lib/platform"
import { fullscreenOverlayOpenAtom } from "@/atoms/overlay"
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer"
import { WorkspaceAvatar } from "@/components/ui/workspace-avatar"
import { WorkspaceCreationScreen } from "@/components/workspace"
import { RemoveWorkspaceDialog } from "@/components/workspace/RemoveWorkspaceDialog"
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
  const [pendingRemoval, setPendingRemoval] = useState<Workspace | null>(null)
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

  /** Close the sheet, then ask in RemoveWorkspaceDialog. */
  const handleRemoveWorkspace = useCallback((workspace: Workspace) => {
    if (workspace.id === activeWorkspaceId) {
      toast.error(t('toast.cannotRemoveActiveWorkspace'))
      return
    }
    setOpen(false)
    setPendingRemoval(workspace)
  }, [activeWorkspaceId, t])

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

      <RemoveWorkspaceDialog
        workspace={pendingRemoval}
        iconUrl={pendingRemoval ? workspaceIconMap.get(pendingRemoval.id) : undefined}
        onClose={() => setPendingRemoval(null)}
        onRemoved={onWorkspaceRemoved}
      />

      <Drawer open={open} onOpenChange={(next) => { setOpen(next); if (next) checkRemoteHealth() }}>
        <DrawerTrigger asChild>
          <button
            type="button"
            data-workspace-switcher="topbar"
            className="titlebar-no-drag ml-1 h-9 min-w-0 max-w-full flex items-center justify-start gap-2 pl-1 pr-2 rounded-md text-label-lg font-medium text-foreground hover:bg-fill-hover data-[state=open]:bg-fill-hover transition-[background-color] duration-micro ease-out-subtle hover:duration-instant cursor-pointer"
            aria-label={t('workspace.selectWorkspace')}
          >
            <WorkspaceAvatar
              workspaceId={selectedWorkspace?.id}
              workspaceName={selectedWorkspace?.name}
              src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
              className="size-6 rounded-sm shadow-elev-0"
              fallbackClassName="rounded-full text-[11px]"
            />
            <span className="truncate min-w-0 flex-1 text-left">{selectedWorkspace?.name || 'Workspace'}</span>
            {selectedWorkspace?.remoteServer && (
              isRemoteDisconnected(selectedWorkspace.id)
                ? <CloudOff className="size-3.5 text-destructive shrink-0" />
                : <Cloud className="size-3.5 text-tertiary shrink-0" />
            )}
            <ChevronDown data-slot="chevron" className="h-3 w-3 text-tertiary shrink-0" />
            {hasUnreadInOtherWorkspaces && <span className="size-1.5 rounded-full bg-accent-solid shrink-0" />}
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
                    "flex items-center gap-3 px-3 min-h-row-touch py-2 rounded-md transition-[background-color] duration-micro ease-out-subtle hover:duration-instant",
                    isActive ? "bg-fill-selected" : "hover:bg-fill-hover",
                    disconnected && "opacity-60",
                  )}
                >
                  <button
                    type="button"
                    onClick={handleSelect}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left -outline-offset-2"
                  >
                    <WorkspaceAvatar
                      workspaceId={workspace.id}
                      workspaceName={workspace.name}
                      src={workspaceIconMap.get(workspace.id)}
                      className="size-7 rounded-sm shadow-elev-0 shrink-0"
                      fallbackClassName="rounded-sm text-label"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-copy font-medium">{workspace.name}</span>
                        {workspaceUnreadMap?.[workspace.id] && <span className="size-1.5 rounded-full bg-accent-solid shrink-0" />}
                      </div>
                      {workspace.remoteServer && (
                        <div className="flex items-center gap-1 text-label-sm text-tertiary mt-0.5">
                          {disconnected
                            ? <><CloudOff className="h-3 w-3 text-destructive shrink-0" /><span title={getDisconnectTooltip(workspace.id)}>{t('toast.disconnected')}</span></>
                            : <><Cloud className="h-3 w-3 shrink-0" /><span className="truncate">{workspace.remoteServer.url}</span></>
                          }
                        </div>
                      )}
                    </div>
                  </button>
                  {!isActive && !isWebUI && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWorkspace(workspace)}
                      className="shrink-0 size-9 rounded-md flex items-center justify-center text-secondary hover:text-destructive hover:bg-destructive-tint"
                      aria-label={t("workspace.removeWorkspace")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  {!isActive && !disconnected && (
                    <button
                      type="button"
                      onClick={() => { onSelect(workspace.id, true); setOpen(false) }}
                      className="shrink-0 size-9 rounded-md flex items-center justify-center text-secondary hover:text-foreground hover:bg-fill-hover"
                      aria-label={t("sidebarMenu.openInNewWindow")}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  )}
                  {isActive && (
                    <Check className="size-4 shrink-0 text-accent mr-2" />
                  )}
                </div>
              )
            })}

            <DrawerClose asChild>
              <button
                type="button"
                onClick={handleNewWorkspace}
                className="mt-1 flex items-center gap-3 px-2 min-h-row-touch py-2 rounded-md hover:bg-fill-hover transition-[background-color] duration-micro ease-out-subtle hover:duration-instant text-left"
              >
                <div className="size-7 rounded-sm bg-fill-hover flex items-center justify-center shrink-0">
                  <FolderPlus className="size-4 text-secondary" />
                </div>
                <span className="text-copy font-medium">{t("workspace.addWorkspace")}</span>
              </button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
