/**
 * Notifications Hook
 *
 * Handles native OS notifications and app badge count.
 * - Tracks window focus state
 * - Shows notifications for new messages when window is unfocused
 * - Updates dock badge with total unread count
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAtomValue } from 'jotai'
import type { Session } from '../../shared/types'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'

/**
 * Draw a badge onto an icon image using Canvas
 * Returns a data URL of the image with badge overlay
 */
function drawBadgeOnIcon(iconDataUrl: string, count: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // Create canvas at icon size
      const canvas = document.createElement('canvas')
      const size = Math.max(img.width, img.height, 256) // Ensure at least 256px for quality
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get canvas context'))
        return
      }

      // Draw the base icon centered
      const offsetX = (size - img.width) / 2
      const offsetY = (size - img.height) / 2
      ctx.drawImage(img, offsetX, offsetY, img.width, img.height)

      // Badge parameters
      const badgeRadius = size * 0.19  // Badge size relative to icon (increased for 22px on screen)
      // Position: 8px up and 8px to the right (relative to icon size)
      const offsetPx = (8 / 256) * size  // 8px at 256px icon size
      const badgeX = size - badgeRadius - (size * 0.05) + offsetPx  // Moved right
      const badgeY = badgeRadius + (size * 0.05) - offsetPx  // Moved up
      const text = count > 99 ? '99+' : count.toString()

      // Draw red badge circle with larger shadow (50% more blur)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
      ctx.shadowBlur = size * 0.06
      ctx.shadowOffsetY = size * 0.015

      ctx.beginPath()
      ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
      ctx.fillStyle = '#FF3B30'  // iOS/macOS red
      ctx.fill()

      // Reset shadow for text
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      ctx.shadowOffsetY = 0

      // Draw white text (regular weight)
      const fontSize = count > 99 ? badgeRadius * 0.65 : badgeRadius * 0.95
      ctx.font = `400 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`
      ctx.fillStyle = '#FFFFFF'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, badgeX, badgeY)

      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Failed to load icon image'))
    img.src = iconDataUrl
  })
}

/**
 * Check if a session has unread messages using metadata
 * Uses the explicit hasUnread flag (state machine approach)
 */
function hasUnreadMessagesFromMeta(meta: SessionMeta): boolean {
  // Use the explicit hasUnread flag - single source of truth
  // This flag is set to true when processing completes while user is NOT viewing,
  // and cleared when user views the session
  return meta.hasUnread === true
}

interface UseNotificationsOptions {
  /** Current workspace ID */
  workspaceId: string | null
  /** Callback to navigate to a session when notification is clicked */
  onNavigateToSession?: (sessionId: string) => void
  /** Whether notifications are enabled (from app settings) */
  enabled?: boolean
}

interface UseNotificationsResult {
  /** Whether the window is currently focused */
  isWindowFocused: boolean
  /** Show a notification for a session */
  showSessionNotification: (session: Session, messagePreview?: string) => void
  /** Update the app badge count based on sessions */
  updateBadgeCount: () => void
}

export function useNotifications({
  workspaceId,
  onNavigateToSession,
  enabled = true,
}: UseNotificationsOptions): UseNotificationsResult {
  const [isWindowFocused, setIsWindowFocused] = useState(true)
  const onNavigateToSessionRef = useRef(onNavigateToSession)
  const lastBadgeCountRef = useRef<number | null>(null)

  // Use session metadata from Jotai atom (lightweight, no messages)
  // This prevents closures from retaining the full messages array
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  // Keep ref updated
  useEffect(() => {
    onNavigateToSessionRef.current = onNavigateToSession
  }, [onNavigateToSession])

  // Subscribe to window focus changes
  useEffect(() => {
    // Get initial focus state
    window.electronAPI.getWindowFocusState().then(setIsWindowFocused)

    // Subscribe to focus changes
    const cleanup = window.electronAPI.onWindowFocusChange((isFocused) => {
      setIsWindowFocused(isFocused)
      // Badge count is always shown based on unread count, not cleared on focus
    })

    return cleanup
  }, [])

  // Subscribe to notification navigation (when user clicks a notification)
  useEffect(() => {
    const cleanup = window.electronAPI.onNotificationNavigate((data) => {
      console.log('[Notifications] Navigate to session:', data.sessionId)
      onNavigateToSessionRef.current?.(data.sessionId)
    })

    return cleanup
  }, [])

  // Subscribe to badge draw requests from main process
  // This uses Canvas API (only available in renderer) to draw badge on icon
  useEffect(() => {
    const cleanup = window.electronAPI.onBadgeDraw(async (data) => {
      console.log('[Notifications] Badge draw request:', data.count)
      try {
        const badgedIconDataUrl = await drawBadgeOnIcon(data.iconDataUrl, data.count)
        await window.electronAPI.setDockIconWithBadge(badgedIconDataUrl)
        console.log('[Notifications] Badge icon set successfully')
      } catch (error) {
        console.error('[Notifications] Failed to draw badge:', error)
      }
    })

    return cleanup
  }, [])

  // Update badge count when session metadata changes
  const updateBadgeCount = useCallback(() => {
    // Only show badge if notifications are enabled
    if (!enabled) {
      console.log('[Notifications] Badge disabled, clearing')
      window.electronAPI.updateBadgeCount(0)
      return
    }

    // Count sessions that have unread messages using metadata
    // Exclude hidden sessions (mini-agent sessions) from badge count
    const metas = Array.from(sessionMetaMap.values())
    const unreadSessions = metas.filter(m => hasUnreadMessagesFromMeta(m) && !m.hidden)
    const totalUnread = unreadSessions.length

    // Skip badge update if any session is processing AND the count hasn't changed
    // This prevents excessive updates during streaming while still allowing
    // updates when user switches sessions (which marks as read and decreases count)
    const hasProcessing = metas.some(m => m.isProcessing)
    if (hasProcessing && totalUnread === lastBadgeCountRef.current) {
      return
    }

    // Debug: log sessions with messages vs unread
    const sessionsWithMessages = metas.filter(m => m.lastFinalMessageId !== undefined)
    console.log('[Notifications] Badge update:', {
      totalSessions: metas.length,
      sessionsWithMessages: sessionsWithMessages.length,
      unreadCount: totalUnread,
    })

    // Badge always shows unread count (regardless of focus)
    lastBadgeCountRef.current = totalUnread
    window.electronAPI.updateBadgeCount(totalUnread)
  }, [sessionMetaMap, enabled])

  // Auto-update badge when session metadata or focus changes
  useEffect(() => {
    updateBadgeCount()
  }, [updateBadgeCount])

  // Show notification for a session
  const showSessionNotification = useCallback((session: Session, messagePreview?: string) => {
    // Don't show notification if disabled in settings
    if (!enabled) return
    // Don't show notification if window is focused
    if (isWindowFocused) return
    // Don't show if no workspace
    if (!workspaceId) return

    // Get session title for notification
    const title = session.name || 'New message'

    // Get message preview (truncate if needed)
    let body = messagePreview || 'Craft Agent has a new message for you'
    if (body.length > 100) {
      body = body.substring(0, 97) + '...'
    }

    window.electronAPI.showNotification(title, body, workspaceId, session.id)
  }, [enabled, isWindowFocused, workspaceId])

  return {
    isWindowFocused,
    showSessionNotification,
    updateBadgeCount,
  }
}
