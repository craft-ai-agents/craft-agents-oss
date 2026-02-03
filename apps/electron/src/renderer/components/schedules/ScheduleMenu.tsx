/**
 * ScheduleMenu - Context menu items for schedule actions
 *
 * Follows SessionMenu pattern using useMenuComponents for
 * compatibility with both DropdownMenu and ContextMenu.
 */

import { Pencil, Trash2 } from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'

interface ScheduleMenuProps {
  onEdit: () => void
  onDelete: () => void
}

export function ScheduleMenu({ onEdit, onDelete }: ScheduleMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      <MenuItem onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
        <span className="flex-1">Edit Schedule</span>
      </MenuItem>
      <Separator />
      <MenuItem onClick={onDelete} variant="destructive">
        <Trash2 className="h-3.5 w-3.5" />
        <span className="flex-1">Delete</span>
      </MenuItem>
    </>
  )
}
