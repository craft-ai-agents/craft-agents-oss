/**
 * WorkflowAvatar - Thin wrapper around EntityIcon for workflows.
 *
 * Sets fallbackIcon={Workflow} and delegates all rendering to EntityIcon.
 * Use `fluid` prop for fill-parent sizing (e.g., Info_Page.Hero).
 */

import { Workflow } from 'lucide-react'
import { EntityIcon } from '@/components/ui/entity-icon'
import { useEntityIcon } from '@/lib/icon-cache'
import type { IconSize } from '@g4os/shared/icons'
import type { LoadedWorkflow } from '../../../shared/types'

interface WorkflowAvatarProps {
  /** LoadedWorkflow object */
  workflow: LoadedWorkflow
  /** Size variant */
  size?: IconSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  /** Additional className overrides */
  className?: string
  /** Workspace ID for loading local icons */
  workspaceId?: string
}

export function WorkflowAvatar({ workflow, size = 'md', fluid, className, workspaceId }: WorkflowAvatarProps) {
  const icon = useEntityIcon({
    workspaceId: workspaceId ?? '',
    entityType: 'workflow',
    identifier: workflow.slug,
    iconPath: workflow.iconPath,
    iconValue: workflow.metadata.icon,
  })

  return (
    <EntityIcon
      icon={icon}
      size={size}
      fallbackIcon={Workflow}
      alt={workflow.metadata.name}
      className={className}
      containerClassName={fluid ? 'h-full w-full' : undefined}
    />
  )
}
