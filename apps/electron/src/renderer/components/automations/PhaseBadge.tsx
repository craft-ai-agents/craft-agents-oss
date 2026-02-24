/**
 * PhaseBadge
 *
 * Colored badge indicating the phase/timing of an automation trigger event.
 * Uses Info_Badge with event-derived colors.
 */

import type { AutomationTrigger } from './types'
import { Info_Badge, type BadgeColor } from '@/components/info'

interface PhaseBadgeConfig {
  label: string
  color: BadgeColor
}

function getPhaseBadgeConfig(event: AutomationTrigger): PhaseBadgeConfig {
  // Pre-execution automations
  if (['PreToolUse', 'Setup', 'SessionStart', 'SubagentStart', 'PreCompact', 'UserPromptSubmit'].includes(event)) {
    return { label: 'Before', color: 'warning' }
  }

  // Post-execution automations
  if (['PostToolUse', 'SessionEnd', 'SubagentStop', 'Stop'].includes(event)) {
    return { label: 'After', color: 'success' }
  }

  // Error automations
  if (['PostToolUseFailure'].includes(event)) {
    return { label: 'On Error', color: 'destructive' }
  }

  // Scheduled automations
  if (['SchedulerTick'].includes(event)) {
    return { label: 'Scheduled', color: 'success' }
  }

  // App events (LabelAdd, FlagChange, etc.)
  return { label: 'Event', color: 'default' }
}

export interface PhaseBadgeProps {
  event: AutomationTrigger
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
