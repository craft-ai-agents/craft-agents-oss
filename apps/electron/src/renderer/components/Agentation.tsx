/**
 * Agentation Wrapper Component
 *
 * Wraps the Agentation library to integrate with God Mode.
 * Only renders in debug mode when God Mode is enabled.
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { Agentation as AgentationBase } from 'agentation'
import { toast } from 'sonner'
import type { GodModeConfig } from '../../shared/types'

// God Mode workspace ID (must match the one in god-mode.ts)
const GOD_MODE_WORKSPACE_ID = 'god-mode'

export interface AgentationWrapperProps {
  /** Whether debug mode is enabled */
  isDebugMode: boolean
  /** Callback to navigate to a session */
  onNavigateToSession?: (workspaceId: string, sessionId: string) => void
}

export function AgentationWrapper({ isDebugMode, onNavigateToSession }: AgentationWrapperProps) {
  const [godModeConfig, setGodModeConfig] = useState<GodModeConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load God Mode config on mount
  useEffect(() => {
    if (!isDebugMode) return

    const loadConfig = async () => {
      try {
        const config = await window.electronAPI.getGodModeConfig()
        setGodModeConfig(config)
      } catch (error) {
        console.error('Failed to load God Mode config:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadConfig()
  }, [isDebugMode])

  // Handle annotation copy - create a chat in God Mode workspace
  const handleCopy = useCallback(async (markdown: string) => {
    if (!godModeConfig?.enabled) {
      // If God Mode is not enabled, just copy to clipboard (default behavior)
      return
    }

    try {
      // Create a new session in the God Mode workspace
      const session = await window.electronAPI.createSession(GOD_MODE_WORKSPACE_ID)

      if (!session) {
        toast.error('Failed to create chat session')
        return
      }

      // Format the annotation message
      const message = formatAnnotationForChat(markdown)

      // Send the message to the session (auto-send)
      await window.electronAPI.sendMessage(session.id, message)

      // Show toast with navigation action
      toast.success('Annotation sent to God Mode', {
        action: {
          label: 'View Chat',
          onClick: () => {
            onNavigateToSession?.(GOD_MODE_WORKSPACE_ID, session.id)
          },
        },
      })
    } catch (error) {
      console.error('Failed to create annotation chat:', error)
      toast.error('Failed to send annotation')
    }
  }, [godModeConfig, onNavigateToSession])

  // Don't render if not in debug mode or loading
  if (!isDebugMode || isLoading) {
    return null
  }

  // Don't render if God Mode is not enabled
  if (!godModeConfig?.enabled) {
    return null
  }

  return (
    <AgentationBase
      onCopy={handleCopy}
      copyToClipboard={false} // We handle the copy ourselves
    />
  )
}

/**
 * Format the Agentation markdown output for the chat
 */
function formatAnnotationForChat(markdown: string): string {
  return `## UI Annotation from Agentation

I've annotated a UI element that I'd like you to help me improve. Here's the annotation data:

${markdown}

Please help me improve this UI element based on my feedback. Here's what I'd like you to do:

1. **Locate the component**: Find the React component that renders this element
2. **Analyze the issue**: Understand what I'm asking for based on my comment
3. **Propose changes**: Suggest or implement the changes to improve the UI/UX

Remember that you're working on the Craft Agent source code itself (Electron + React monorepo).
`
}
