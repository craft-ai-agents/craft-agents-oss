/**
 * WhatsApp Toast Listener
 *
 * Listens for WhatsApp message activity events and shows toast notifications.
 * Add this component to AppShell to enable in-app notifications.
 */

import { useEffect } from 'react'
import { toast } from 'sonner'
import type { WhatsAppMessageActivityEvent } from '../../../shared/types'

export function WhatsAppToastListener() {
  useEffect(() => {
    const cleanup = window.electronAPI.onWhatsAppMessageActivity((data: WhatsAppMessageActivityEvent) => {
      switch (data.status) {
        case 'received':
          toast.info(`WhatsApp: ${data.senderName}`, {
            description: data.messagePreview,
            duration: 5000,
          })
          break

        case 'processing':
          toast.info('Processing WhatsApp request...', {
            description: `From ${data.senderName} in ${data.groupName}`,
            duration: 3000,
          })
          break

        case 'complete':
          toast.success('WhatsApp reply sent', {
            duration: 4000,
          })
          break

        case 'error':
          toast.error('WhatsApp processing failed', {
            description: data.groupName ? `Error in ${data.groupName}` : undefined,
            duration: 5000,
          })
          break
      }
    })

    return cleanup
  }, [])

  return null
}
