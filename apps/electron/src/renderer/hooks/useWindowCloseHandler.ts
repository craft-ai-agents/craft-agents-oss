import { useEffect } from 'react'
import { useModalRegistry } from '@/context/ModalContext'

/**
 * Hook to handle window close requests (X button, Cmd+W).
 *
 * When a close request is received:
 * 1. If any modals are open, close the topmost one
 * 2. If no modals are open, confirm and proceed with window close
 *
 * This hook should be called once at the app root level.
 */
export function useWindowCloseHandler() {
  const { hasOpenModals, closeTopModal } = useModalRegistry()

  useEffect(() => {
    const cleanup = window.electronAPI.onCloseRequested(() => {
      // Check if we have any modals to close first
      if (hasOpenModals()) {
        closeTopModal()
      } else {
        // No modals open - proceed with window close
        window.electronAPI.confirmCloseWindow()
      }
    })

    return cleanup
  }, [hasOpenModals, closeTopModal])
}
