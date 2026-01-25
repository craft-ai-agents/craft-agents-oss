/**
 * Slack Event Listener
 *
 * Subscribes to Slack IPC events and updates atoms.
 * Should be mounted once in the app shell.
 */

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  slackServiceStatusAtom,
  slackRecentMessagesAtom,
  slackErrorAtom,
} from '@/atoms/slack'
import type {
  SlackServiceState,
  SlackInboundMessage,
  SlackError,
} from '@vesper/shared/slack'

const MAX_RECENT_MESSAGES = 50

export function SlackEventListener() {
  const setServiceStatus = useSetAtom(slackServiceStatusAtom)
  const setRecentMessages = useSetAtom(slackRecentMessagesAtom)
  const setError = useSetAtom(slackErrorAtom)

  useEffect(() => {
    // Message received handler
    const unsubMessage = window.electronAPI.onSlackMessageReceived?.((data: {
      workspaceId: string
      accountId: string
      message: SlackInboundMessage
    }) => {
      console.log('[Slack] Message received:', data.message.text?.slice(0, 50))

      // Add to recent messages
      setRecentMessages((prev) => {
        const updated = [data.message, ...prev].slice(0, MAX_RECENT_MESSAGES)
        return updated
      })

      // Show toast notification
      const senderName = data.message.userName ?? data.message.user ?? 'Someone'
      const preview = data.message.text?.slice(0, 100) || '(media)'
      toast.info(`Slack: ${senderName}`, {
        description: preview,
        duration: 4000,
      })
    })

    // Status changed handler
    const unsubStatus = window.electronAPI.onSlackStatusChanged?.((data: {
      workspaceId: string
      accountId: string
      status: string
      state: SlackServiceState
    }) => {
      console.log('[Slack] Status changed:', data.workspaceId, data.status)

      setServiceStatus((prev) => ({
        ...prev,
        [data.workspaceId]: data.state,
      }))

      // Show toast for important status changes
      if (data.status === 'connected') {
        toast.success('Slack connected', {
          description: data.state.teamName ?? data.workspaceId,
          duration: 3000,
        })
      } else if (data.status === 'disconnected') {
        toast.info('Slack disconnected', {
          description: data.state.teamName ?? data.workspaceId,
          duration: 3000,
        })
      }
    })

    // Error handler
    const unsubError = window.electronAPI.onSlackError?.((data: {
      workspaceId: string
      accountId: string
      error: SlackError
    }) => {
      console.error('[Slack] Error:', data.error)

      setError(data.error.message)

      toast.error('Slack error', {
        description: data.error.message,
        duration: 5000,
      })
    })

    // Cleanup
    return () => {
      unsubMessage?.()
      unsubStatus?.()
      unsubError?.()
    }
  }, [setServiceStatus, setRecentMessages, setError])

  // This component doesn't render anything
  return null
}

export default SlackEventListener
