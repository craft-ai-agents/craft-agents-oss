/**
 * StatusIcon - Thin wrapper around EntityIcon for statuses.
 *
 * Sets fallbackIcon={Circle}. Color is NOT handled here — the parent applies
 * a Tailwind color class (e.g. 'text-success') which cascades into colorable
 * SVGs via CSS currentColor inheritance.
 *
 * Status icons are discovered at `statuses/icons/{statusId}.{ext}`.
 */

import { Circle } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@craft-agent/shared/icons'

interface StatusIconProps {
  /** Status identifier (used to discover icon file) */
  statusId: string
  /** Icon value from config (emoji string) */
  icon?: string
  /** Workspace ID for loading local icons */
  workspaceId: string
  /** Size variant (default: 'sm' - statuses are typically small) */
  size?: IconSize
  /** Additional className */
  className?: string
  /** When true, emoji icons render without container chrome (bg, ring, rounded) */
  chromeless?: boolean
}

export function StatusIcon({
  statusId,
  icon,
  workspaceId,
  size = 'sm',
  className,
  chromeless,
}: StatusIconProps) {
  const resolved = useEntityIcon({
    workspaceId,
    entityType: 'status',
    identifier: statusId,
    iconDir: 'statuses/icons',
    iconValue: icon,
    // Status icons use {statusId}.ext naming (not icon.ext)
    iconFileName: statusId,
  })

  return (
    <EntityIcon
      icon={resolved}
      size={size}
      fallbackIcon={Circle}
      className={className}
      chromeless={chromeless}
    />
  )
}
