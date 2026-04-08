/**
 * AutomationMenu - Shared menu content for automation actions
 *
 * Used by:
 * - AutomationsListPanel (dropdown via "..." button, context menu via right-click)
 * - AutomationInfoPage (title dropdown menu)
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
import { useTranslations } from '@/i18n'

export interface AutomationMenuProps {
  automationId: string
  automationName: string
  enabled: boolean
  onToggleEnabled?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onEditJson?: () => void
  onDelete?: () => void
}

export function AutomationMenu({
  automationId,
  automationName,
  enabled,
  onToggleEnabled,
  onTest,
  onDuplicate,
  onEditJson,
  onDelete,
}: AutomationMenuProps) {
  const { t } = useTranslations()
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
          <span className="flex-1">{enabled ? t('common.disable', 'Disable') : t('common.enable', 'Enable')}</span>
        </MenuItem>
      )}

      {/* Test Automation */}
      {onTest && (
        <MenuItem onClick={onTest}>
          <Play className="h-3.5 w-3.5" />
          <span className="flex-1">{t('common.runTest', 'Run Test')}</span>
        </MenuItem>
      )}

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
          <span className="flex-1">{t('common.duplicate', 'Duplicate')}</span>
        </MenuItem>
      )}

      {/* Edit automations.json */}
      {onEditJson && (
        <MenuItem onClick={onEditJson}>
          <FileCode className="h-3.5 w-3.5" />
          <span className="flex-1">{t('common.editConfiguration', 'Edit Configuration')}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      {onDelete && (
        <MenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">{t('common.delete', 'Delete')}</span>
        </MenuItem>
      )}
    </>
  )
}
