/**
 * HookMenu - Shared menu content for hook actions
 *
 * Used by:
 * - HooksListPanel (dropdown via "..." button, context menu via right-click)
 * - HookInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, following the same dual-menu pattern as SourceMenu.
 */

import {
  Trash2,
  FileCode,
  Copy,
  Play,
  Power,
  PowerOff,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'

export interface HookMenuProps {
  hookId: string
  hookName: string
  enabled: boolean
  onToggleEnabled?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onEditJson?: () => void
  onDelete?: () => void
}

export function HookMenu({
  hookId,
  hookName,
  enabled,
  onToggleEnabled,
  onTest,
  onDuplicate,
  onEditJson,
  onDelete,
}: HookMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Toggle enabled/disabled */}
      {onToggleEnabled && (
        <MenuItem onClick={onToggleEnabled}>
          {enabled ? (
            <PowerOff className="h-3.5 w-3.5" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span className="flex-1">{enabled ? 'Disable' : 'Enable'}</span>
        </MenuItem>
      )}

      {/* Test Hook */}
      {onTest && (
        <MenuItem onClick={onTest}>
          <Play className="h-3.5 w-3.5" />
          <span className="flex-1">Run Test</span>
        </MenuItem>
      )}

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
          <span className="flex-1">Duplicate</span>
        </MenuItem>
      )}

      <Separator />

      {/* Edit hooks.json */}
      {onEditJson && (
        <MenuItem onClick={onEditJson}>
          <FileCode className="h-3.5 w-3.5" />
          <span className="flex-1">Edit Configuration</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      {onDelete && (
        <MenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">Delete</span>
        </MenuItem>
      )}
    </>
  )
}
