/**
 * useAutoNewChat - Auto-creates a new chat when the app comes to foreground after idle
 *
 * When the app regains focus after being idle for a configurable period,
 * automatically creates a new conversation instead of resuming the last one.
 * This feature is disabled by default and can be configured in preferences.
 */

import { useEffect, useRef } from 'react'
import type { AutoNewChatSettings } from '@craft-agent/shared/config/preferences'

interface UseAutoNewChatOptions {
  enabled: boolean
  workspaceId: string | null
  openNewChat: () => Promise<void>
}

const DEFAULT_IDLE_TIMEOUT_MINUTES = 10

export function useAutoNewChat({ enabled, workspaceId, openNewChat }: UseAutoNewChatOptions) {
  const lastActiveTimeRef = useRef<number>(Date.now())
  const settingsRef = useRef<AutoNewChatSettings | null>(null)
  const openNewChatRef = useRef(openNewChat)

  useEffect(() => {
    openNewChatRef.current = openNewChat
  }, [openNewChat])

  useEffect(() => {
    if (!enabled || !workspaceId) return

    const loadSettings = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        if (result.exists && result.content) {
          const prefs = JSON.parse(result.content)
          settingsRef.current = prefs.autoNewChat ?? null
        }
      } catch (error) {
        console.error('[AutoNewChat] Failed to load settings:', error)
      }
    }

    loadSettings()

    const updateLastActiveTime = () => {
      lastActiveTimeRef.current = Date.now()
    }

    const handleFocusChange = async (isFocused: boolean) => {
      if (!isFocused) {
        updateLastActiveTime()
        return
      }

      // Check if this focus is from a system interruption (lock screen, sleep)
      // If so, skip auto-new-chat - user didn't intentionally switch away
      const wasSystemInterrupted = await window.electronAPI.consumeSystemInterrupted()
      if (wasSystemInterrupted) {
        console.log('[AutoNewChat] Focus from system unlock/resume, skipping')
        updateLastActiveTime()
        return
      }

      // Reload settings on focus to pick up any changes made in AppSettingsPage
      await loadSettings()

      const settings = settingsRef.current
      if (!settings?.enabled) return

      const idleTimeoutMs = (settings.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES) * 60 * 1000
      const idleTime = Date.now() - lastActiveTimeRef.current

      if (idleTime >= idleTimeoutMs) {
        console.log(`[AutoNewChat] Idle for ${Math.round(idleTime / 1000 / 60)} minutes, creating new chat`)
        try {
          await openNewChatRef.current()
        } catch (error) {
          console.error('[AutoNewChat] Failed to create new chat:', error)
        }
      }

      updateLastActiveTime()
    }

    window.electronAPI.getWindowFocusState().then((isFocused) => {
      if (isFocused) {
        updateLastActiveTime()
      }
    })

    const cleanup = window.electronAPI.onWindowFocusChange(handleFocusChange)

    return cleanup
  }, [enabled, workspaceId])
}
