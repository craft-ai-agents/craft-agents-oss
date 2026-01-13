/**
 * Update Checker Hook
 *
 * Manages auto-update state for the Electron app.
 * - Listens for update availability broadcasts from main process
 * - Tracks download progress
 * - Provides methods to check for updates and install
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import type { UpdateInfo } from '../../shared/types'

interface UseUpdateCheckerResult {
  /** Current update info */
  updateInfo: UpdateInfo | null
  /** Whether an update is available */
  updateAvailable: boolean
  /** Whether update is currently downloading */
  isDownloading: boolean
  /** Whether update is ready to install */
  isReadyToInstall: boolean
  /** Download progress (0-100) */
  downloadProgress: number
  /** Check for updates manually */
  checkForUpdates: () => Promise<void>
  /** Install the downloaded update and restart */
  installUpdate: () => Promise<void>
  /** Dismiss the update notification for this session */
  dismissUpdate: () => void
  /** Whether the update has been dismissed this session */
  isDismissed: boolean
}

export function useUpdateChecker(): UseUpdateCheckerResult {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)
  const hasShownToastRef = useRef(false)
  // Use ref to avoid stale closure in callback
  const isDismissedRef = useRef(isDismissed)

  // Keep ref in sync with state
  useEffect(() => {
    isDismissedRef.current = isDismissed
  }, [isDismissed])

  // Subscribe to update availability broadcasts
  useEffect(() => {
    // Get initial update info
    window.electronAPI.getUpdateInfo().then((info) => {
      setUpdateInfo(info)
    })

    // Subscribe to update availability changes
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info)

      // Show toast on first detection (if not already shown and update is available)
      // Use ref to get current dismissed state (avoid stale closure)
      if (info.available && !hasShownToastRef.current && !isDismissedRef.current) {
        hasShownToastRef.current = true
        toast.info(`Update available: v${info.latestVersion}`, {
          description: 'A new version is being downloaded in the background.',
          duration: 5000,
        })
      }
    })

    // Subscribe to download progress updates
    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: progress } : prev)
    })

    return () => {
      cleanupAvailable()
      cleanupProgress()
    }
  }, []) // No dependency on isDismissed - we use the ref instead

  // Check for updates manually
  const checkForUpdates = useCallback(async () => {
    try {
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)

      if (!info.available) {
        toast.success('You\'re up to date', {
          description: `Version ${info.currentVersion} is the latest.`,
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('[useUpdateChecker] Check failed:', error)
      toast.error('Failed to check for updates', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [])

  // Install the update
  const installUpdate = useCallback(async () => {
    try {
      toast.info('Installing update...', {
        description: 'The app will restart automatically.',
        duration: 3000,
      })
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('[useUpdateChecker] Install failed:', error)
      toast.error('Failed to install update', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [])

  // Dismiss the update for this session
  const dismissUpdate = useCallback(() => {
    setIsDismissed(true)
  }, [])

  return {
    updateInfo,
    updateAvailable: updateInfo?.available ?? false,
    isDownloading: updateInfo?.downloadState === 'downloading',
    isReadyToInstall: updateInfo?.downloadState === 'ready',
    downloadProgress: updateInfo?.downloadProgress ?? 0,
    checkForUpdates,
    installUpdate,
    dismissUpdate,
    isDismissed,
  }
}
