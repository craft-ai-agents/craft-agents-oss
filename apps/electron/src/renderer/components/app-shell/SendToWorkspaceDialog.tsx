/**
 * SendToWorkspaceDialog — Transfer sessions between workspaces.
 *
 * Shows a workspace picker with connection status indicators.
 * Remote workspaces are disabled (cross-server transfer is a future enhancement).
 * Transfer progress is shown via sonner toasts.
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
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

  // Filter out current workspace
  const otherWorkspaces = workspaces.filter(w => w.id !== activeWorkspaceId)

  const handleTransfer = useCallback(async () => {
    if (!selectedWorkspaceId || sessionIds.length === 0) return

    setIsTransferring(true)
    const targetWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)
    const targetName = targetWorkspace?.name ?? 'workspace'
    const count = sessionIds.length
    const label = count === 1 ? 'session' : 'sessions'

    const toastId = toast.loading(`Sending ${count} ${label} to ${targetName}...`)

    try {
      const newSessionIds: string[] = []

      for (const sessionId of sessionIds) {
        // 1. Export from current server
        const bundle = await window.electronAPI.exportSession(sessionId)
        if (!bundle) {
          throw new Error(`Failed to export session ${sessionId}`)
        }

        // 2. Import to target workspace (same server)
        const result = await window.electronAPI.importSession(selectedWorkspaceId, bundle, 'fork')
        newSessionIds.push(result.sessionId)

        // Show warnings if any
        if (result.warnings?.length) {
          for (const warning of result.warnings) {
            toast.warning(warning)
          }
        }
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
            Copy {count} {label} to another workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Workspace list */}
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto py-1">
          {otherWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-4 text-center">
              No other workspaces available.
            </p>
          ) : (
            otherWorkspaces.map(workspace => {
              const isRemote = !!workspace.remoteServer
              const isSelected = selectedWorkspaceId === workspace.id

              return (
                <button
                  key={workspace.id}
                  type="button"
                  disabled={isRemote || isTransferring}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={cn(
                    'flex items-center gap-2 w-full px-2 py-2 rounded-md text-left text-sm transition-colors',
                    'hover:bg-foreground/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isSelected && 'bg-foreground/10 ring-1 ring-foreground/15',
                    isRemote && 'opacity-50 cursor-not-allowed',
                  )}
                  title={isRemote ? 'Cross-server transfer coming soon' : undefined}
                >
                  <CrossfadeAvatar
                    src={workspaceIconMap.get(workspace.id)}
                    alt={workspace.name}
                    className="h-5 w-5 rounded-full ring-1 ring-border/50 shrink-0"
                    fallbackClassName="bg-muted text-[10px] rounded-full"
                    fallback={workspace.name?.charAt(0) || 'W'}
                  />
                  <span className="flex-1 truncate">{workspace.name}</span>
                  {isRemote && (
                    <Cloud className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
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
