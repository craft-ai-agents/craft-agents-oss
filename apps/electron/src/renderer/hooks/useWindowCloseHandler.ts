import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useModalRegistry } from '@/context/ModalContext'
import { panelStackAtom, closePanelAtom, focusedPanelIdAtom } from '@/atoms/panel-stack'

/**
 * Hook to handle window close requests (X button, Cmd+W).
 *
 * Layered dismissal — CMD+W closes the topmost layer:
 * 1. If any modals are open → close the topmost modal, cancel close
 * 2. If any panels exist → close the focused panel, cancel close
 * 3. If no panels/modals → confirm close (window is destroyed)
 *
 * The main process starts a fallback timeout on each close request.
 * cancelCloseWindow() clears it (window stays open).
 * confirmCloseWindow() clears it and destroys the window.
 *
 * This hook should be called once at the app root level.
 */
export function useWindowCloseHandler() {
  const { hasOpenModals, closeTopModal } = useModalRegistry()
  const panelStack = useAtomValue(panelStackAtom)
  const focusedPanelId = useAtomValue(focusedPanelIdAtom)
  const closePanel = useSetAtom(closePanelAtom)

  useEffect(() => {
    const cleanup = window.electronAPI.onCloseRequested(() => {
      if (hasOpenModals()) {
        closeTopModal()
        window.electronAPI.cancelCloseWindow()
        return
      }

      // Close the focused panel (or last if no focus tracked)
      const target = focusedPanelId
        ? panelStack.find(p => p.id === focusedPanelId)
        : panelStack[panelStack.length - 1]
      if (target) {
        closePanel(target.id)
        window.electronAPI.cancelCloseWindow()
      } else {
        // No panels, no modals — close the window
        window.electronAPI.confirmCloseWindow()
      }
    })

    return cleanup
  }, [hasOpenModals, closeTopModal, panelStack, focusedPanelId, closePanel])
}
