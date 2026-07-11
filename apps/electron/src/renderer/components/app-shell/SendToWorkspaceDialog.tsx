/**
 * SendToWorkspaceDialog — Transfer sessions to remote workspaces.
 *
 * Shows a workspace picker filtered to remote workspaces only (sending
 * between local workspaces on the same machine is pointless).
 * Disconnected remote workspaces are shown as disabled with a CloudOff icon.
 *
 * Uses invokeOnServer for cross-server transfer:
 * 1. Generate a mini-summary handoff payload from the current server
 * 2. Import that summarized payload on the target server via temporary connection
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { Cloud, CloudOff, Send } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { useWorkspaceIcons } from '@/hooks/useWorkspaceIcon'
import { cn } from '@/lib/utils'
import type { Workspace } from '../../../shared/types'

export interface SendToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Session IDs to transfer */
  sessionIds: string[]
  /** All workspaces */
  workspaces: Workspace[]
  /** Current workspace ID (excluded from picker) */
  activeWorkspaceId: string | null
  /** Called after successful transfer with target workspace ID and new session IDs */
  onTransferComplete?: (targetWorkspaceId: string, newSessionIds: string[]) => void
}

export function SendToWorkspaceDialog({
  open,
  onOpenChange,
  sessionIds,
  workspaces,
  activeWorkspaceId,
  onTransferComplete,
}: SendToWorkspaceDialogProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const workspaceIconMap = useWorkspaceIcons(workspaces)

  // Health check results for remote workspaces (checked on dialog open)
  const [remoteHealthMap, setRemoteHealthMap] = useState<Map<string, 'ok' | 'error' | 'checking'>>(new Map())
  const healthCheckAbort = useRef<AbortController | null>(null)

  // Only show remote workspaces (local-to-local is pointless)
  const remoteWorkspaces = workspaces.filter(w => w.id !== activeWorkspaceId && w.remoteServer)

  // Check connectivity for all remote workspaces when dialog opens
  useEffect(() => {
    if (!open) {
      healthCheckAbort.current?.abort()
      return
    }

    // Cancel any in-flight checks
    healthCheckAbort.current?.abort()
    const abort = new AbortController()
    healthCheckAbort.current = abort

    if (remoteWorkspaces.length === 0) return

    // Mark all as checking
    setRemoteHealthMap(() => {
      const next = new Map<string, 'ok' | 'error' | 'checking'>()
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

    return () => abort.abort()
  }, [open, remoteWorkspaces.map(w => w.id).join(',')])

  const handleTransfer = useCallback(async () => {
    if (!selectedWorkspaceId || sessionIds.length === 0) return

    const targetWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
    if (!targetWorkspace?.remoteServer) return

    setIsTransferring(true)
    const targetName = targetWorkspace.name
    const count = sessionIds.length
    const label = count === 1 ? 'session' : 'sessions'
    const { url, token, remoteWorkspaceId } = targetWorkspace.remoteServer

    const toastId = toast.loading(`Sending ${count} ${label} to ${targetName}...`)

    try {
      const newSessionIds: string[] = []

      for (const sessionId of sessionIds) {
        // 1. Export full session bundle (messages + metadata for UI)
        const bundle = await window.electronAPI.exportSession(sessionId) as any
        if (!bundle) throw new Error(`Failed to export session ${sessionId}`)

        // 2. Generate conversation summary so the AI has context after fork
        //    (forked sessions lose SDK context — the AI starts fresh without this)
        try {
          console.log(`[SendToWorkspace] Generating summary for session ${sessionId}...`)
          const transferPayload = await window.electronAPI.exportRemoteSessionTransfer(sessionId)
          console.log(`[SendToWorkspace] Summary result: ${transferPayload?.summary ? `${transferPayload.summary.length} chars` : 'null/empty'}`)
          if (transferPayload?.summary && bundle.session?.header) {
            bundle.session.header.transferredSessionSummary = transferPayload.summary
            bundle.session.header.transferredSessionSummaryApplied = false
          }
        } catch (err) {
          console.error('[SendToWorkspace] Summary generation failed:', err)
          // Summary generation failed — transfer without AI context (messages still visible)
        }

        // 3. Import full bundle on remote server via cross-server RPC (fork mode)
        const result = await window.electronAPI.invokeOnServer(
          url, token,
          'sessions:import',
          remoteWorkspaceId, bundle, 'fork',
        ) as { sessionId: string }

        newSessionIds.push(result.sessionId)
      }

      toast.success(`Sent ${count} ${label} to ${targetName}`, {
        id: toastId,
        action: onTransferComplete ? {
          label: 'Open',
          onClick: () => onTransferComplete(selectedWorkspaceId, newSessionIds),
        } : undefined,
      })

      onOpenChange(false)
      setSelectedWorkspaceId(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to send ${label}`, {
        id: toastId,
        description: message,
      })
    } finally {
      setIsTransferring(false)
    }
  }, [selectedWorkspaceId, sessionIds, workspaces, onOpenChange, onTransferComplete])

  const count = sessionIds.length
  const label = count === 1 ? 'session' : 'sessions'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isTransferring) {
        onOpenChange(isOpen)
        if (!isOpen) setSelectedWorkspaceId(null)
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Send to Workspace
          </DialogTitle>
          <DialogDescription>
            Send {count} {label} to a remote workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Workspace list — remote only */}
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto py-1">
          {remoteWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">
              No remote workspaces available.
            </p>
          ) : (
            remoteWorkspaces.map(workspace => {
              const isSelected = selectedWorkspaceId === workspace.id
              const healthStatus = remoteHealthMap.get(workspace.id)
              const isDisconnected = healthStatus === 'error'
              const isChecking = healthStatus === 'checking'

              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={isTransferring || isDisconnected}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-foreground/10 ring-1 ring-foreground/15',
                    isDisconnected && 'opacity-50 cursor-not-allowed hover:bg-transparent',
                  )}
                >
                  <CrossfadeAvatar
                    src={workspaceIconMap.get(workspace.id)}
                    alt={workspace.name}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50 shrink-0"
                    fallbackClassName="bg-muted text-[10px] rounded-full"
                    fallback={workspace.name?.charAt(0) || 'W'}
                  />
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {isDisconnected ? (
                    <CloudOff className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  ) : (
                    <Cloud className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isChecking ? 'text-muted-foreground/30 animate-pulse' : 'text-muted-foreground',
                    )} />
                  )}
                </button>
              )
            })
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isTransferring}
          >
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={!selectedWorkspaceId || isTransferring}
          >
            {isTransferring ? 'Sending...' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
