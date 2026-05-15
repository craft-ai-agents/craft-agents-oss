/**
 * Settings Icons
 *
 * Shared Lucide icon mapping for settings pages. Used by both:
 * - AppMenu (logo dropdown settings submenu)
 * - SettingsNavigator (settings sidebar panel)
 */

import {
  Building2,
  Keyboard,
  MessageSquare,
  Palette,
  Server,
  ShieldCheck,
  Sparkles,
  Tag,
  ToggleRight,
  UserCircle,
} from 'lucide-react'
import type { SettingsSubpage } from '../../../shared/types'

type IconProps = { className?: string }

export const AppSettingsIcon = ({ className }: IconProps) => <ToggleRight className={className} />
export const AiSettingsIcon = ({ className }: IconProps) => <Sparkles className={className} />
export const AppearanceIcon = ({ className }: IconProps) => <Palette className={className} />
export const InputIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const WorkspaceIcon = ({ className }: IconProps) => <Building2 className={className} />
export const PermissionsIcon = ({ className }: IconProps) => <ShieldCheck className={className} />
export const LabelsIcon = ({ className }: IconProps) => <Tag className={className} />
export const MessagingSettingsIcon = ({ className }: IconProps) => <MessageSquare className={className} />
export const ServerSettingsIcon = ({ className }: IconProps) => <Server className={className} />
export const ShortcutsIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const PreferencesIcon = ({ className }: IconProps) => <UserCircle className={className} />

/**
 * Map of settings subpage IDs to their icon components.
 * Used by both AppMenu and SettingsNavigator for consistent icons.
 */
export const SETTINGS_ICONS: Record<SettingsSubpage, React.ComponentType<IconProps>> = {
  app: AppSettingsIcon,
  ai: AiSettingsIcon,
  appearance: AppearanceIcon,
  input: InputIcon,
  workspace: WorkspaceIcon,
  permissions: PermissionsIcon,
  labels: LabelsIcon,
  messaging: MessagingSettingsIcon,
  server: ServerSettingsIcon,
  shortcuts: ShortcutsIcon,
  preferences: PreferencesIcon,
}
