/**
 * AccountMenu — workspace selector for the top bar and compact panel header.
 *
 * Account/profile actions live in the sidebar profile menu. This surface stays
 * intentionally workspace-only: selection, remote state, creation, and
 * removal. Keeping those responsibilities separate avoids duplicate profile,
 * connection, and security destinations.
 *
 * Presentation:
 * - Desktop (`compact` false): Radix DropdownMenu.
 * - Compact (`compact` true): vaul Drawer (nested when opened from craft-menu)
 *   so the menu is not trapped under the craft-menu Drawer overlay
 *   (z-dropdown 100 < z-modal 200).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  ExternalLink,
  FolderPlus,
  Trash2,
} from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { fullscreenOverlayOpenAtom } from '@/atoms/overlay'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '@/components/ui/styled-dropdown'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from '@/components/ui/drawer'
import { WorkspaceAvatar } from '@/components/ui/workspace-avatar'
import { WorkspaceCreationScreen, type WorkspaceCreationSuccess } from '@/components/workspace'
import { waitForTransportConnected } from '@/lib/transport-wait'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { isSshBackedWorkspace } from '../../../shared/ssh'
import type { Workspace } from '../../../shared/types'

export interface AccountMenuProps {
  /**
   * Visual density + presentation mode.
   * compact true → Drawer surface (touch / craft-menu nested drawer).
   * compact false → DropdownMenu (desktop topbar).
   */
  compact?: boolean
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string, openInNewWindow?: boolean) => void | Promise<void>
  onWorkspaceCreated?: (workspace: Workspace) => void
  onWorkspaceRemoved?: () => void
  workspaceUnreadMap?: Record<string, boolean>
}

function sectionLabel(text: string) {
  return (
    <div className="px-2 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
      {text}
    </div>
  )
}

function drawerSectionLabel(text: string) {
  return (
    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
      {text}
    </div>
  )
}

const drawerRowClass =
  'flex w-full items-center gap-3 px-3 py-3 rounded-[10px] text-left text-sm transition-colors hover:bg-foreground/5 outline-none disabled:opacity-50 disabled:pointer-events-none'

export function AccountMenu({
  compact = false,
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  workspaceUnreadMap,
}: AccountMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [showCreationScreen, setShowCreationScreen] = React.useState(false)
  const [reconnectTarget, setReconnectTarget] = React.useState<Workspace | null>(null)
  const setFullscreenOverlayOpen = useSetAtom(fullscreenOverlayOpenAtom)
  const selectedWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const workspaceIconMap = useWorkspaceIcons(workspaces)
  const connectionState = useTransportConnectionState()
  const isRemote = connectionState?.mode === 'remote'

  const [remoteHealthMap, setRemoteHealthMap] = React.useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = React.useRef<AbortController | null>(null)


  const checkRemoteHealth = React.useCallback(() => {
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    const remoteWorkspaces = workspaces.filter(
      (w) => w.remoteServer && !isSshBackedWorkspace(w) && w.id !== activeWorkspaceId,
    )
    if (remoteWorkspaces.length === 0) return

    setRemoteHealthMap((prev) => {
      const next = new Map(prev)
      for (const ws of remoteWorkspaces) next.set(ws.id, 'checking')
      return next
    })

    for (const ws of remoteWorkspaces) {
      window.electronAPI
        .testRemoteConnection(ws.remoteServer!.url, ws.remoteServer!.token)
        .then((result) => {
          if (abort.signal.aborted) return
          setRemoteHealthMap((prev) => new Map(prev).set(ws.id, result.ok ? 'ok' : 'error'))
        })
        .catch(() => {
          if (abort.signal.aborted) return
          setRemoteHealthMap((prev) => new Map(prev).set(ws.id, 'error'))
        })
    }
  }, [workspaces, activeWorkspaceId])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) checkRemoteHealth()
    },
    [checkRemoteHealth],
  )

  const getDisconnectTooltip = (workspaceId: string): string => {
    if (workspaceId === activeWorkspaceId && connectionState?.lastError) {
      const { kind } = connectionState.lastError
      if (kind === 'auth') return t('toast.authenticationFailed')
      if (kind === 'timeout' || kind === 'network') return t('toast.serverUnreachable')
    }
    return t('toast.disconnected')
  }

  const isRemoteDisconnected = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId)
    if (isSshBackedWorkspace(workspace)) {
      if (workspaceId !== activeWorkspaceId || !isRemote || !connectionState) return false
      const { status, lastError } = connectionState
      const terminal = status === 'failed' || status === 'disconnected'
      return terminal && lastError?.kind === 'auth'
    }
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

  const closeMenu = React.useCallback(() => setOpen(false), [])

  const handleNewWorkspace = () => {
    setShowCreationScreen(true)
    setFullscreenOverlayOpen(true)
    closeMenu()
  }

  const handleWorkspaceCreated = ({ workspace, activation }: WorkspaceCreationSuccess) => {
    setShowCreationScreen(false)
    setFullscreenOverlayOpen(false)
    toast.success(t('toast.createdWorkspace', { name: workspace.name }))
    onWorkspaceCreated?.(workspace)
    void onSelectWorkspace(activation?.activeWorkspaceId ?? workspace.id)
  }

  const handleRemoveWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      if (workspace.id === activeWorkspaceId) {
        toast.error(t('toast.cannotRemoveActiveWorkspace'))
        return
      }
      const confirmed = await window.electronAPI.showDeleteWorkspaceConfirmation(workspace.name)
      if (!confirmed) return
      const removed = await window.electronAPI.removeWorkspace(workspace.id)
      if (removed) {
        toast.success(t('toast.removedWorkspace', { name: workspace.name }))
        onWorkspaceRemoved?.()
      }
    },
    [activeWorkspaceId, onWorkspaceRemoved, t],
  )

  const handleCloseCreationScreen = React.useCallback(() => {
    setShowCreationScreen(false)
    setReconnectTarget(null)
    setFullscreenOverlayOpen(false)
  }, [setFullscreenOverlayOpen])

  const handleReconnectWorkspace = React.useCallback(
    async (
      workspaceId: string,
      remoteServer: { url: string; token: string; remoteWorkspaceId: string },
    ) => {
      await window.electronAPI.updateWorkspaceRemoteServer(workspaceId, remoteServer)
      if (workspaceId === activeWorkspaceId) {
        await window.electronAPI.reconnectTransport()
        await waitForTransportConnected(window.electronAPI)
      } else {
        await Promise.resolve(onSelectWorkspace(workspaceId))
        await waitForTransportConnected(window.electronAPI)
      }
      handleCloseCreationScreen()
      toast.success(t('toast.workspaceReconnected'))
    },
    [activeWorkspaceId, handleCloseCreationScreen, onSelectWorkspace, t],
  )


  const selectWorkspace = (workspace: Workspace, openInNewWindow?: boolean) => {
    const disconnected = isRemoteDisconnected(workspace.id)
    if (disconnected && workspace.remoteServer) {
      setReconnectTarget(workspace)
      setShowCreationScreen(true)
      setFullscreenOverlayOpen(true)
      closeMenu()
      return
    }
    if (disconnected) return
    void onSelectWorkspace(workspace.id, openInNewWindow)
    closeMenu()
  }


  const triggerLabel = selectedWorkspace?.name || t('workspace.selectWorkspace')

  const triggerButton = (
    <button
      type="button"
      data-account-menu={compact ? 'compact' : 'topbar'}
      className={cn(
        'header-icon-btn titlebar-no-drag ml-1 flex min-w-0 items-center justify-start gap-0.5 h-[30px] rounded-[8px] text-[13px] text-foreground/50 hover:bg-foreground/5 hover:text-foreground transition-colors cursor-pointer data-[state=open]:bg-foreground/5 data-[state=open]:text-foreground',
        compact ? 'flex-1 px-2' : 'flex-1 px-3',
      )}
      aria-label={t('workspace.selectWorkspace')}
    >
      <WorkspaceAvatar
        workspaceId={selectedWorkspace?.id}
        workspaceName={selectedWorkspace?.name || triggerLabel}
        src={selectedWorkspace ? workspaceIconMap.get(selectedWorkspace.id) : undefined}
        className="h-4 w-4 mr-1.5 rounded-full ring-1 ring-border/50"
        fallbackClassName="rounded-full"
      />
      <span className="truncate min-w-0 flex-1 text-left">{triggerLabel}</span>
      {selectedWorkspace?.remoteServer &&
        (isRemoteDisconnected(selectedWorkspace.id) ? (
          <CloudOff className="h-3 w-3 text-destructive shrink-0" />
        ) : (
          <Cloud className="h-3 w-3 opacity-60 shrink-0" />
        ))}
      <ChevronDown data-slot="chevron" className="h-3 w-3 opacity-60 shrink-0" />
      {hasUnreadInOtherWorkspaces && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
    </button>
  )

  const creationScreen = (
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
  )

  // ---------------------------------------------------------------------------
  // Compact: Drawer surface (nested under craft-menu Drawer when applicable)
  // ---------------------------------------------------------------------------
  if (compact) {
    return (
      <>
        {creationScreen}

        <Drawer nested open={open} onOpenChange={handleOpenChange}>
          <DrawerTrigger asChild>{triggerButton}</DrawerTrigger>

          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader>
              <DrawerTitle>{t('workspace.selectWorkspace')}</DrawerTitle>
            </DrawerHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6 flex flex-col gap-0.5">
              {drawerSectionLabel(t('accountMenu.section.workspaces'))}
              {workspaces.map((workspace) => {
                const disconnected = isRemoteDisconnected(workspace.id)
                const isActive = activeWorkspaceId === workspace.id
                return (
                  <div
                    key={workspace.id}
                    className={cn(
                      'flex items-center gap-1 rounded-[10px] transition-colors',
                      isActive ? 'bg-foreground/5' : 'hover:bg-foreground/5',
                      disconnected && 'opacity-60',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectWorkspace(workspace)}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left outline-none"
                    >
                      <WorkspaceAvatar
                        workspaceId={workspace.id}
                        workspaceName={workspace.name}
                        src={workspaceIconMap.get(workspace.id)}
                        className="h-7 w-7 rounded-full ring-1 ring-border/50 shrink-0"
                        fallbackClassName="rounded-full text-sm"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-sm font-medium">{workspace.name}</span>
                          {workspaceUnreadMap?.[workspace.id] && (
                            <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                          )}
                        </div>
                        {workspace.remoteServer && (
                          <div className="flex items-center gap-1 text-xs text-foreground/50 mt-0.5">
                            {disconnected ? (
                              <>
                                <CloudOff className="h-3 w-3 text-destructive shrink-0" />
                                <span title={getDisconnectTooltip(workspace.id)}>
                                  {t('toast.disconnected')}
                                </span>
                              </>
                            ) : (
                              <>
                                <Cloud className="h-3 w-3 shrink-0" />
                                <span className="truncate">
                                  {workspace.remoteServer.sshHostId
                                    ? t('ssh.workspaceSubtitle', {
                                        host: workspace.remoteServer.sshHostId,
                                      })
                                    : workspace.remoteServer.url}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveWorkspace(workspace)}
                        className="shrink-0 h-9 w-9 rounded-[8px] flex items-center justify-center text-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                        aria-label={t('workspace.removeWorkspace')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                    {!isActive && !disconnected && (
                      <button
                        type="button"
                        onClick={() => selectWorkspace(workspace, true)}
                        className="shrink-0 h-9 w-9 rounded-[8px] flex items-center justify-center text-foreground/50 hover:text-foreground hover:bg-foreground/10 transition-colors mr-1"
                        aria-label={t('sidebarMenu.openInNewWindow')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    )}
                    {isActive && <Check className="h-4 w-4 shrink-0 text-foreground/60 mr-3" />}
                  </div>
                )
              })}
              <DrawerClose asChild>
                <button type="button" className={drawerRowClass} onClick={handleNewWorkspace}>
                  <div className="h-7 w-7 rounded-full bg-foreground/5 flex items-center justify-center shrink-0">
                    <FolderPlus className="h-4 w-4 text-foreground/60" />
                  </div>
                  <span className="font-medium">{t('workspace.addWorkspace')}</span>
                </button>
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    )
  }

  // ---------------------------------------------------------------------------
  // Desktop: DropdownMenu
  // ---------------------------------------------------------------------------
  return (
    <>
      {creationScreen}

      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>

        <StyledDropdownMenuContent align="start" sideOffset={6} minWidth="min-w-72">
          {sectionLabel(t('accountMenu.section.workspaces'))}
          {workspaces.map((workspace) => {
            const disconnected = isRemoteDisconnected(workspace.id)
            return (
              <StyledDropdownMenuItem
                key={workspace.id}
                onClick={(e) => {
                  if (disconnected && workspace.remoteServer) {
                    setReconnectTarget(workspace)
                    setShowCreationScreen(true)
                    setFullscreenOverlayOpen(true)
                    return
                  }
                  if (disconnected) return
                  const openInNewWindow = e.metaKey || e.ctrlKey
                  void onSelectWorkspace(workspace.id, openInNewWindow)
                }}
                className={cn(
                  'justify-between group font-sans',
                  activeWorkspaceId === workspace.id && 'bg-foreground/10',
                  disconnected && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <WorkspaceAvatar
                    workspaceId={workspace.id}
                    workspaceName={workspace.name}
                    src={workspaceIconMap.get(workspace.id)}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50"
                    fallbackClassName="rounded-full text-xs"
                  />
                  <span className="truncate">{workspace.name}</span>
                  {workspace.remoteServer &&
                    (disconnected ? (
                      <span title={getDisconnectTooltip(workspace.id)} className="shrink-0">
                        <CloudOff className="h-3.5 w-3.5 text-destructive" />
                      </span>
                    ) : (
                      <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ))}
                  {workspaceUnreadMap?.[workspace.id] && (
                    <span className="h-2 w-2 rounded-full bg-accent shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activeWorkspaceId !== workspace.id && (
                    <button
                      data-touch-reveal="true"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleRemoveWorkspace(workspace)
                      }}
                      title={t('workspace.removeWorkspace')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {activeWorkspaceId !== workspace.id && !disconnected && (
                    <button
                      data-touch-reveal="true"
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-foreground/10 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onSelectWorkspace(workspace.id, true)
                      }}
                      title={t('sidebarMenu.openInNewWindow')}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {activeWorkspaceId === workspace.id && <Check className="h-3.5 w-3.5" />}
                </div>
              </StyledDropdownMenuItem>
            )
          })}
          <StyledDropdownMenuItem onClick={handleNewWorkspace} className="font-sans">
            <FolderPlus className="h-4 w-4" />
            {t('workspace.addWorkspace')}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
