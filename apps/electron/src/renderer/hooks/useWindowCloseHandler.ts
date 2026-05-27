import { useEffect } from 'react'
import { useModalRegistry } from '@/context/ModalContext'
import { useDismissibleLayerRegistry } from '@/context/DismissibleLayerContext'
import type { WindowCloseRequest } from '../../shared/types'

/**
 * Hook to handle window close requests with source-aware behavior.
 *
 * - `window-button` closes the window directly.
 * - `keyboard-shortcut` (Cmd/Ctrl+W) uses layered dismissal:
 *   1. Close top modal
 *   2. Else close window
 * - `unknown` follows layered dismissal as a safe fallback.
 *
 * The main process starts a fallback timeout on each close request.
 * cancelCloseWindow() clears it (window stays open).
 * confirmCloseWindow() clears it and destroys the window.
 *
 * This hook should be called once at the app root level.
 */
export function useWindowCloseHandler() {
  const { hasOpenLayers, closeTop } = useDismissibleLayerRegistry()
  const { hasOpenModals, closeTopModal } = useModalRegistry()

  useEffect(() => {
    const cleanup = window.electronAPI.onCloseRequested((request: WindowCloseRequest) => {
      if (request.source === 'window-button') {
        window.electronAPI.confirmCloseWindow()
        return
      }

      if (hasOpenLayers()) {
        closeTop()
        window.electronAPI.cancelCloseWindow()
        return
      }

      // Backward-compatible fallback for legacy modals not yet migrated.
      if (hasOpenModals()) {
        closeTopModal()
        window.electronAPI.cancelCloseWindow()
        return
      }

      window.electronAPI.confirmCloseWindow()
    })

    return cleanup
  }, [hasOpenLayers, closeTop, hasOpenModals, closeTopModal])
}
