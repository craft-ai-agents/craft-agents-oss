/**
 * ChatView - Main session viewer component
 *
 * Platform-agnostic session viewer that works in both Electron and web.
 * Renders a session's messages as turn cards with optional input.
 *
 * Modes:
 * - 'interactive': Full features (used in Electron)
 * - 'readonly': Read-only display (used in web viewer)
 */

import type { ReactNode } from 'react'
import { useMemo, useState, useCallback } from 'react'
import type { StoredSession } from '@craft-agent/core'
import { cn } from '../../lib/utils'
import { CHAT_LAYOUT, CHAT_CLASSES } from '../../lib/layout'
import { PlatformProvider, type PlatformActions } from '../../context'
import { Markdown } from '../markdown'
import { TurnCard } from './TurnCard'
import { UserMessageBubble } from './UserMessageBubble'
import {
  groupMessagesByTurn,
  storedToMessage,
  type AssistantTurn,
  type ActivityItem,
} from './turn-utils'

export type ChatViewMode = 'interactive' | 'readonly'

export interface ChatViewProps {
  /** Session data to display */
  session: StoredSession
  /** View mode - 'readonly' for web viewer, 'interactive' for Electron */
  mode?: ChatViewMode
  /** Platform-specific actions (file opening, URL handling, etc.) */
  platformActions?: PlatformActions
  /** Additional className for the container */
  className?: string
  /** Callback when a turn is clicked */
  onTurnClick?: (turnId: string) => void
  /** Callback when an activity is clicked */
  onActivityClick?: (activity: ActivityItem) => void
  /** Default expanded state for turns (true for readonly, false for interactive) */
  defaultExpanded?: boolean
  /** Custom header content */
  header?: ReactNode
  /** Custom footer content (input area for interactive mode) */
  footer?: ReactNode
}

/**
 * CraftAgentLogo - The Craft Agent "C" logo for branding
 */
function CraftAgentLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(3.4502, 3)" fill="currentColor">
        <path
          d="M3.17890888,3.6 L3.17890888,0 L16,0 L16,3.6 L3.17890888,3.6 Z M9.642,7.2 L9.64218223,10.8 L0,10.8 L0,3.6 L16,3.6 L16,7.2 L9.642,7.2 Z M3.17890888,18 L3.178,14.4 L0,14.4 L0,10.8 L16,10.8 L16,18 L3.17890888,18 Z"
          fillRule="nonzero"
        />
      </g>
    </svg>
  )
}

/**
 * SystemMessage - Displays system/info/error messages
 */
function SystemMessage({
  content,
  type,
  className,
}: {
  content: string
  type: 'error' | 'info' | 'warning' | 'system'
  className?: string
}) {
  const colorClass = type === 'error'
    ? 'text-destructive border-destructive/30 bg-destructive/5'
    : type === 'warning'
    ? 'text-amber-600 border-amber-500/30 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30'
    : 'text-muted-foreground border-muted bg-muted/30'

  return (
    <div className={cn("px-4 py-2", className)}>
      <div className={cn(
        "text-sm px-3 py-2 rounded-md border",
        colorClass
      )}>
        <Markdown mode="minimal">{content}</Markdown>
      </div>
    </div>
  )
}


/**
 * ChatView - Main session viewer component
 */
export function ChatView({
  session,
  mode = 'readonly',
  platformActions = {},
  className,
  onTurnClick,
  onActivityClick,
  defaultExpanded,
  header,
  footer,
}: ChatViewProps) {
  // Convert StoredMessage[] to Message[] and group into turns
  const turns = useMemo(
    () => groupMessagesByTurn(session.messages.map(storedToMessage)),
    [session.messages]
  )

  // Track expanded turns (for controlled state)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => {
    // Default: expand all in readonly mode, collapse in interactive
    const shouldExpandAll = defaultExpanded ?? (mode === 'readonly')
    if (shouldExpandAll) {
      return new Set(turns.filter(t => t.type === 'assistant').map(t => (t as AssistantTurn).turnId))
    }
    return new Set()
  })

  // Track expanded activity groups
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(new Set())

  const handleExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (expanded) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }, [])

  const handleExpandedActivityGroupsChange = useCallback((groups: Set<string>) => {
    setExpandedActivityGroups(groups)
  }, [])

  const handleOpenActivityDetails = useCallback((activity: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(activity)
    } else if (platformActions.onOpenActivityDetails) {
      platformActions.onOpenActivityDetails(session.id, activity.id)
    }
  }, [onActivityClick, platformActions, session.id])

  const handleOpenTurnDetails = useCallback((turnId: string) => {
    if (onTurnClick) {
      onTurnClick(turnId)
    } else if (platformActions.onOpenTurnDetails) {
      platformActions.onOpenTurnDetails(session.id, turnId)
    }
  }, [onTurnClick, platformActions, session.id])

  return (
    <PlatformProvider actions={platformActions}>
      <div className={cn("flex flex-col h-full", className)}>
        {/* Header */}
        {header && (
          <div className="shrink-0 border-b">
            {header}
          </div>
        )}

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto bg-foreground-2">
          <div className={cn(CHAT_LAYOUT.maxWidth, "mx-auto", CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing)}>
            {turns.map((turn) => {
              if (turn.type === 'user') {
                return (
                  <div key={turn.message.id} className={CHAT_LAYOUT.userMessagePadding}>
                    <UserMessageBubble
                      content={turn.message.content}
                      attachments={turn.message.attachments}
                      onUrlClick={platformActions.onOpenUrl}
                      onFileClick={platformActions.onOpenFile}
                    />
                  </div>
                )
              }

              if (turn.type === 'system') {
                const msgType = turn.message.role === 'error' ? 'error' :
                               turn.message.role === 'warning' ? 'warning' :
                               turn.message.role === 'info' ? 'info' : 'system'
                return (
                  <SystemMessage
                    key={turn.message.id}
                    content={turn.message.content}
                    type={msgType}
                  />
                )
              }

              if (turn.type === 'assistant') {
                return (
                  <TurnCard
                    key={turn.turnId}
                    turnId={turn.turnId}
                    activities={turn.activities}
                    response={turn.response}
                    intent={turn.intent}
                    isStreaming={turn.isStreaming}
                    isComplete={turn.isComplete}
                    isExpanded={expandedTurns.has(turn.turnId)}
                    onExpandedChange={(expanded) => handleExpandedChange(turn.turnId, expanded)}
                    onOpenFile={platformActions.onOpenFile}
                    onOpenUrl={platformActions.onOpenUrl}
                    onPopOut={platformActions.onOpenMarkdownPreview}
                    onOpenDetails={() => handleOpenTurnDetails(turn.turnId)}
                    onOpenActivityDetails={handleOpenActivityDetails}
                    todos={turn.todos}
                    expandedActivityGroups={expandedActivityGroups}
                    onExpandedActivityGroupsChange={handleExpandedActivityGroupsChange}
                    hasEditOrWriteActivities={turn.activities.some(a =>
                      a.toolName === 'Edit' || a.toolName === 'Write'
                    )}
                    onOpenMultiFileDiff={platformActions.onOpenMultiFileDiff
                      ? () => platformActions.onOpenMultiFileDiff!(session.id, turn.turnId)
                      : undefined
                    }
                  />
                )
              }

              return null
            })}

            {/* Bottom branding */}
            <div className={CHAT_CLASSES.brandingContainer}>
              <CraftAgentLogo className="w-8 h-8 text-[#9570BE]/40" />
            </div>
          </div>
        </div>

        {/* Footer (input area) */}
        {footer && (
          <div className="shrink-0 border-t">
            {footer}
          </div>
        )}
      </div>
    </PlatformProvider>
  )
}
