/**
 * Settings Icons
 *
 * Shared Lucide icon mapping for settings pages. Used by both:
 * - AppMenu (logo dropdown settings submenu)
 * - SettingsNavigator (settings sidebar panel)
 */

import {
  BookOpen,
  Building2,
  Cloud,
  FileText,
  Keyboard,
  MessageSquare,
  Palette,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  ToggleRight,
  Users,
} from 'lucide-react'
import type { SettingsSubpage } from '../../../shared/types'

type IconProps = { className?: string }

export const AppSettingsIcon = ({ className }: IconProps) => <ToggleRight className={className} />
export const AiSettingsIcon = ({ className }: IconProps) => <Sparkles className={className} />
export const CloudRunsIcon = ({ className }: IconProps) => <Cloud className={className} />
export const AppearanceIcon = ({ className }: IconProps) => <Palette className={className} />
export const InputIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const WorkspaceIcon = ({ className }: IconProps) => <Building2 className={className} />
export const AccountsIcon = ({ className }: IconProps) => <Users className={className} />
export const PermissionsIcon = ({ className }: IconProps) => <ShieldCheck className={className} />
export const LabelsIcon = ({ className }: IconProps) => <Tag className={className} />
export const OrganizationsIcon = ({ className }: IconProps) => <Users className={className} />
export const MessagingSettingsIcon = ({ className }: IconProps) => <MessageSquare className={className} />
export const ServerSettingsIcon = ({ className }: IconProps) => <Server className={className} />
export const SecuritySettingsIcon = ({ className }: IconProps) => <ShieldAlert className={className} />
export const ShortcutsIcon = ({ className }: IconProps) => <Keyboard className={className} />
export const RuntimeIcon = ({ className }: IconProps) => <Settings className={className} />
export const ContextIcon = ({ className }: IconProps) => <FileText className={className} />
export const KnowledgeIcon = ({ className }: IconProps) => <BookOpen className={className} />
export const MarketplaceIcon = ({ className }: IconProps) => <ShoppingBag className={className} />

/**
 * Map of settings subpage IDs to their icon components.
 * Used by both AppMenu and SettingsNavigator for consistent icons.
 */
export const SETTINGS_ICONS: Record<SettingsSubpage, React.ComponentType<IconProps>> = {
  runtime: RuntimeIcon,
  context: ContextIcon,
  knowledge: KnowledgeIcon,
  marketplace: MarketplaceIcon,
  extensions: MarketplaceIcon,
  app: AppSettingsIcon,
  ai: AiSettingsIcon,
  appearance: AppearanceIcon,
  input: InputIcon,
  workspace: WorkspaceIcon,
  accounts: AccountsIcon,
  permissions: PermissionsIcon,
  labels: LabelsIcon,
  organizations: OrganizationsIcon,
  messaging: MessagingSettingsIcon,
  server: ServerSettingsIcon,
  security: SecuritySettingsIcon,
  cloudRuns: CloudRunsIcon,
  shortcuts: ShortcutsIcon,
}
