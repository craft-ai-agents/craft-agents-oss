import type { SettingsMenuItem } from '../../../shared/menu-schema'

/**
 * Props shared by `AppMenu` (router) and the desktop/mobile shapes underneath.
 *
 * The menu owns only the Craft logo trigger and its dropdown/sheet — back/forward
 * nav lives directly in `TopBar.tsx` and does not pass through here.
 */
export interface AppMenuProps {
  onNewChat: () => void
  onNewWindow?: () => void
  onOpenSettings: () => void
  /** Navigate to a specific settings subpage */
  onOpenSettingsSubpage: (subpage: SettingsMenuItem['id']) => void
  onOpenKeyboardShortcuts: () => void
  onOpenStoredUserPreferences: () => void
  onToggleSidebar?: () => void
  onToggleFocusMode?: () => void
}
