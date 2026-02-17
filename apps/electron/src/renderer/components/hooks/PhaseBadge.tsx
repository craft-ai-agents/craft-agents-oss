/**
 * PhaseBadge
 *
 * Colored badge indicating the phase/timing of a hook event.
 * Uses Info_Badge with event-derived colors.
 */

import type { HookEvent } from './types'
import { Info_Badge, type BadgeColor } from '@/components/info'

interface PhaseBadgeConfig {
  label: string
  color: BadgeColor
}

function getPhaseBadgeConfig(event: HookEvent): PhaseBadgeConfig {
  // Pre-execution hooks
  if (['PreToolUse', 'Setup', 'SessionStart', 'SubagentStart', 'PreCompact', 'UserPromptSubmit'].includes(event)) {
    return { label: 'Before', color: 'warning' }
  }

  // Post-execution hooks
  if (['PostToolUse', 'SessionEnd', 'SubagentStop', 'Stop'].includes(event)) {
    return { label: 'After', color: 'success' }
  }

  // Error hooks
  if (['PostToolUseFailure'].includes(event)) {
    return { label: 'On Error', color: 'destructive' }
  }

  // Scheduled hooks
  if (['SchedulerTick'].includes(event)) {
    return { label: 'Scheduled', color: 'success' }
  }

  // App events (LabelAdd, FlagChange, etc.)
  return { label: 'Event', color: 'default' }
}

export interface PhaseBadgeProps {
  event: HookEvent
  className?: string
}

export function PhaseBadge({ event, className }: PhaseBadgeProps) {
  const config = getPhaseBadgeConfig(event)

  return (
    <Info_Badge color={config.color} className={className}>
      {config.label}
    </Info_Badge>
  )
}
