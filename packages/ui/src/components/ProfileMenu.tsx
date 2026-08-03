import React, { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Settings,
  Sparkles,
  Palette,
  Keyboard,
  FolderCog,
  ShieldCheck,
  Tags,
  MessageSquare,
  Server,
  SlidersHorizontal,
  Bell,
  ChevronRight,
  UserRound,
} from 'lucide-react'

/**
 * A settings entry in the profile menu. `id` matches a SettingsSubpage id in
 * shared/settings-registry.ts, so the caller can open that page directly.
 */
export interface ProfileMenuSettingsItem {
  id: string
  label: string
  icon: React.ComponentType<{ size?: string | number }>
}

/**
 * ARCHstudio's own settings pages, mirroring SETTINGS_PAGES order.
 * This deliberately replaces the upstream account menu (Upgrade plan /
 * Get apps and extensions / Gift Claude / Log out), which was a copy of a
 * hosted product's UI and does not apply here: this app is single-user and
 * local, with no accounts, no plans, and nothing to log out of.
 */
export const DEFAULT_PROFILE_SETTINGS_ITEMS: ProfileMenuSettingsItem[] = [
  { id: 'app', label: 'App', icon: Bell },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'input', label: 'Input', icon: Keyboard },
  { id: 'workspace', label: 'Workspace', icon: FolderCog },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'labels', label: 'Labels', icon: Tags },
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'server', label: 'Server', icon: Server },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
]

interface ProfileMenuProps {
  userName: string
  /** Opens the settings drawer; `subpage` selects which page to land on. */
  onOpenSettings: (subpage?: string) => void
  /** Settings entries to list. Defaults to DEFAULT_PROFILE_SETTINGS_ITEMS. */
  settingsItems?: ProfileMenuSettingsItem[]
}

export function ProfileMenu({
  userName,
  onOpenSettings,
  settingsItems = DEFAULT_PROFILE_SETTINGS_ITEMS,
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Respect prefers-reduced-motion: collapse the entrance to an instant
  // state change (AnimatePresence still mounts/unmounts, just without
  // animating) — same pattern as AnimatedCollapsibleContent.
  const shouldReduceMotion = useReducedMotion()

  const toggleOpen = () => setIsOpen(!isOpen)

  const select = (subpage?: string) => {
    setIsOpen(false)
    onOpenSettings(subpage)
  }

  return (
    <div className="profile-menu-container">
      <button
        type="button"
        className="profile-button"
        onClick={toggleOpen}
        aria-expanded={isOpen}
        aria-controls="profile-dropdown-menu"
      >
        <UserRound size={18} />
        <span className="profile-label">{userName}</span>
        <ChevronRight size={16} className={`profile-chevron ${isOpen ? 'profile-chevron--open' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id="profile-dropdown-menu"
            className="profile-dropdown"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.1, ease: 'easeOut' }}
          >
          <div className="profile-dropdown__header">
            <span className="profile-dropdown__email">ARCHstudio</span>
          </div>
          <ul className="profile-dropdown__list">
            <li>
              <button type="button" onClick={() => select()}>
                <Settings size={16} />
                <span>All Settings</span>
              </button>
            </li>
            <li className="profile-dropdown__separator" />
            {settingsItems.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => select(item.id)}>
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
