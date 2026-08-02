/**
 * SourceStatusIndicator - Shows connection status for sources
 *
 * A small colored dot that indicates the source's connection status:
 * - Green: Connected/tested successfully
 * - Yellow: Requires authentication
 * - Red: Failed to connect
 * - Gray: Untested
 *
 * Hovering shows a tooltip with the status description.
 */

import * as React from 'react'
import { maybeNormalizeMcpErrorMessage } from '@archstudio/shared/mcp'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@archstudio/ui'
import type { SourceConnectionStatus } from '../../../shared/types'

export interface SourceStatusIndicatorProps {
  /** Connection status */
  status?: SourceConnectionStatus
  /** Error message (shown in tooltip if status is 'failed') */
  errorMessage?: string
  /** Size variant */
  size?: 'xs' | 'sm' | 'md'
  /** Additional className */
  className?: string
}

// Status configurations
const STATUS_CONFIG: Record<SourceConnectionStatus, {
  color: string
  pulseColor: string
  label: string
  description: string
}> = {
  connected: {
    color: 'bg-success',
    pulseColor: 'bg-success/80',
    label: 'Connected',
    description: 'Source is connected and working',
  },
  needs_auth: {
    color: 'bg-info',
    pulseColor: 'bg-info/80',
    label: 'Needs Authentication',
    description: 'Source requires authentication to connect',
  },
  failed: {
    color: 'bg-destructive',
    pulseColor: 'bg-destructive/80',
    label: 'Connection Failed',
    description: 'Failed to connect to source',
  },
  untested: {
    color: 'bg-foreground/40',
    pulseColor: 'bg-foreground/30',
    label: 'Not Tested',
    description: 'Connection has not been tested',
  },
  local_disabled: {
    color: 'bg-foreground/30',
    pulseColor: 'bg-foreground/20',
    label: 'Disabled',
    description: 'Local MCP servers are disabled in Settings',
  },
}

// Size configurations
const SIZE_CONFIG: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
}

export function SourceStatusIndicator({
  status = 'untested',
  errorMessage,
  size = 'sm',
  className,
}: SourceStatusIndicatorProps) {
  const config = STATUS_CONFIG[status]
  const sizeClass = SIZE_CONFIG[size]
  const normalizedErrorMessage = maybeNormalizeMcpErrorMessage(errorMessage) ?? errorMessage

  // Build tooltip description
  const tooltipDescription = status === 'failed' && normalizedErrorMessage
    ? `${config.description}: ${normalizedErrorMessage}`
    : config.description

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'relative inline-flex shrink-0',
            className
          )}
        >
          {/* Pulse animation for connected status */}
          {status === 'connected' && (
            <span
              className={cn(
                'absolute inline-flex rounded-full opacity-75 animate-ping',
                config.pulseColor,
                sizeClass
              )}
              style={{ animationDuration: '2s' }}
            />
          )}
          {/* Status dot */}
          <span
            className={cn(
              'relative inline-flex rounded-full',
              config.color,
              sizeClass
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{config.label}</span>
          <span className="text-foreground/60">{tooltipDescription}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Legacy status values written to config.json before `source_test` converted
 * its probe vocabulary at the persistence boundary. Neither is a member of
 * `SourceConnectionStatus`, so without this they fall through every consumer:
 * the status dot looks up `STATUS_CONFIG['error']` and gets `undefined`, and
 * nothing comparing against 'failed' ever matches.
 *
 * Both mean "the probe ran and did not succeed" — i.e. the source is down —
 * so both normalise to 'failed'. Kept as a read-time repair (rather than a
 * one-shot migration) because these values sit in user config files that are
 * only rewritten when that specific source is re-tested.
 */
const LEGACY_STATUS_ALIASES: Record<string, SourceConnectionStatus> = {
  error: 'failed',
  disconnected: 'failed',
  unknown: 'untested',
}

function normalizeStoredStatus(status: SourceConnectionStatus): SourceConnectionStatus {
  return LEGACY_STATUS_ALIASES[status] ?? status
}

/**
 * Derive connection status from source config
 * This is a convenience function to determine status from existing fields
 *
 * @param source - The source config
 * @param localMcpEnabled - Whether local MCP servers are enabled (default: true)
 */
export function deriveConnectionStatus(source: {
  config: {
    isAuthenticated?: boolean
    connectionStatus?: SourceConnectionStatus
    type?: string
    mcp?: { authType?: string; transport?: string }
    api?: { authType?: string }
  }
}, localMcpEnabled = true): SourceConnectionStatus {
  // Check if this is a stdio source and local MCP is disabled
  const mcp = source.config.mcp
  if (mcp?.transport === 'stdio' && !localMcpEnabled) {
    return 'local_disabled'
  }

  // If explicit status is set, use it
  if (source.config.connectionStatus) {
    return normalizeStoredStatus(source.config.connectionStatus)
  }

  // Derive from auth state
  const api = source.config.api
  const authType = mcp?.authType ?? api?.authType
  const isAuthenticated = authType === 'none' || authType === undefined
    ? true
    : source.config['isAuthenticated'] === true

  if (!isAuthenticated) {
    return 'needs_auth'
  }

  if (isAuthenticated) {
    return 'connected'
  }

  // Local sources are always connected
  if (source.config.type === 'local') {
    return 'connected'
  }

  return 'untested'
}
