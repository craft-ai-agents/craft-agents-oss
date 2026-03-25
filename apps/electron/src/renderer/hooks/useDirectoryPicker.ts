import { useState, useCallback } from 'react'
import { useTransportConnectionState } from './useTransportConnectionState'
import { toast } from 'sonner'
import type { WorkspaceCreationTarget } from '../../shared/types'

type ServerBrowserMode = 'browse' | 'manual'

interface DirectoryPickerResult {
  /** Open the picker (native dialog in local mode, ServerDirectoryBrowser in remote mode). */
  pickDirectory: () => void
  /** Whether the ServerDirectoryBrowser modal should be rendered. */
  showServerBrowser: boolean
  /** Which mode the ServerDirectoryBrowser should use. */
  serverBrowserMode: ServerBrowserMode
  /** Close the server browser without selecting. */
  cancelServerBrowser: () => void
  /** Called when a path is selected from the server browser. */
  confirmServerBrowser: (path: string) => void
  /** Whether we're in remote mode (informational). */
  isRemote: boolean
}

export function useDirectoryPicker(
  onSelect: (path: string) => void,
  target?: WorkspaceCreationTarget | null,
): DirectoryPickerResult {
  const transport = useTransportConnectionState()
  const isRemote = target?.mode === 'remote' || (target == null && transport?.mode === 'remote')

  const [showServerBrowser, setShowServerBrowser] = useState(false)

  const serverBrowserMode: ServerBrowserMode = isRemote ? 'browse' : 'manual'

  const pickDirectory = useCallback(async () => {
    if (isRemote) {
      // Remote mode — open ServerDirectoryBrowser (browse or manual depending on server support)
      setShowServerBrowser(true)
      return
    }

    // Local mode — native OS dialog
    try {
      const path = await window.electronAPI.openFolderDialog()
      if (path) onSelect(path)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Failed to open folder picker', {
        description: message,
      })
    }
  }, [isRemote, onSelect])

  const cancelServerBrowser = useCallback(() => {
    setShowServerBrowser(false)
  }, [])

  const confirmServerBrowser = useCallback((path: string) => {
    setShowServerBrowser(false)
    onSelect(path)
  }, [onSelect])

  return {
    pickDirectory,
    showServerBrowser,
    serverBrowserMode,
    cancelServerBrowser,
    confirmServerBrowser,
    isRemote,
  }
}
