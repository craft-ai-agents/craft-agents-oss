/**
 * SkillMenu - Shared menu content for skill actions
 *
 * Used by:
 * - SkillsListPanel (dropdown via "..." button, context menu via right-click)
 * - SkillInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent skill actions:
 * - Open in New Window
 * - Show in Finder
 * - Delete
 */

import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  Trash2,
  FolderOpen,
  AppWindow,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'

export interface SkillMenuProps {
  /** Skill slug */
  skillSlug: string
  /** Skill name for display */
  skillName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void
  onDelete: () => void
}

export function getSkillMenuLabels(t: TFunction) {
  return {
    openInNewWindow: t('common:menu.openInNewWindow'),
    showInFinder: t('common:menu.showInFinder'),
    deleteSkill: t('common:menu.deleteSkill'),
  }
}

/**
 * SkillMenu - Renders the menu items for skill actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SkillMenu({
  skillSlug,
  skillName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
}: SkillMenuProps) {
  const { t } = useTranslation(['common'])
  const labels = getSkillMenuLabels(t)
  void skillSlug
  void skillName

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.openInNewWindow}</span>
      </MenuItem>

      {/* Show in Finder */}
      <MenuItem onClick={onShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.showInFinder}</span>
      </MenuItem>

      <Separator />

      {/* Delete */}
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">{labels.deleteSkill}</span>
      </MenuItem>
    </>
  )
}
