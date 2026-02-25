import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useModalRegistry } from '@/context/ModalContext'
import { panelStackAtom, closePanelAtom } from '@/atoms/panel-stack'

/**
 * Hook to handle window close requests (X button, Cmd+W).
 *
 * When a close request is received:
 * 1. If any modals are open, close the topmost one
 * 2. If secondary panels are open, close the rightmost one
 * 3. If neither, confirm and proceed with window close
 *
 * This hook should be called once at the app root level.
 */
export function useWindowCloseHandler() {
  const { hasOpenModals, closeTopModal } = useModalRegistry()
  const panelStack = useAtomValue(panelStackAtom)
  const closePanel = useSetAtom(closePanelAtom)

  useEffect(() => {
    const cleanup = window.electronAPI.onCloseRequested(() => {
      // Check if we have any modals to close first
      if (hasOpenModals()) {
        closeTopModal()
        return
      }

      // If secondary panels are open, close the rightmost one
      if (panelStack.length > 1) {
        const rightmostPanel = panelStack[panelStack.length - 1]
        closePanel(rightmostPanel.id)
        return
      }

      // No modals or panels open - proceed with window close
      window.electronAPI.confirmCloseWindow()
    })

    return cleanup
  }, [hasOpenModals, closeTopModal, panelStack, closePanel])
}
