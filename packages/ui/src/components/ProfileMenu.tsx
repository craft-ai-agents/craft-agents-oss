import React, { useState } from 'react'
import {
  Settings,
  Globe,
  LifeBuoy,
  CreditCard,
  AppWindow,
  Gift,
  BookOpen,
  LogOut,
  ChevronRight,
  UserRound,
} from 'lucide-react'

interface ProfileMenuProps {
  userName: string
  onOpenSettings: () => void
  onOpenLanguage: () => void
  onOpenHelp: () => void
  onUpgradePlan: () => void
  onGetAppsAndExtensions: () => void
  onGiftClaude: () => void
  onLearnMore: () => void
  onLogout: () => void
}

export function ProfileMenu({
  userName,
  onOpenSettings,
  onOpenLanguage,
  onOpenHelp,
  onUpgradePlan,
  onGetAppsAndExtensions,
  onGiftClaude,
  onLearnMore,
  onLogout,
}: ProfileMenuProps) {
  const [isOpen, setIsOpen] = useState(false)

  const toggleOpen = () => setIsOpen(!isOpen)

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
        <span className="profile-label">
          {userName} <span className="profile-status">Pro</span>
        </span>
        <ChevronRight size={16} className={`profile-chevron ${isOpen ? 'profile-chevron--open' : ''}`} />
      </button>

      {isOpen && (
        <div id="profile-dropdown-menu" className="profile-dropdown">
          <div className="profile-dropdown__header">
            <span className="profile-dropdown__email">skobeponga@gmail.com</span>
          </div>
          <ul className="profile-dropdown__list">
            <li>
              <button type="button" onClick={onOpenSettings}>
                <Settings size={16} />
                <span>Settings</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={onOpenLanguage}>
                <Globe size={16} />
                <span>Language</span>
                <ChevronRight size={14} className="profile-dropdown__item-chevron" />
              </button>
            </li>
            <li>
              <button type="button" onClick={onOpenHelp}>
                <LifeBuoy size={16} />
                <span>Get help</span>
              </button>
            </li>
            <li className="profile-dropdown__separator" />
            <li>
              <button type="button" onClick={onUpgradePlan}>
                <CreditCard size={16} />
                <span>Upgrade plan</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={onGetAppsAndExtensions}>
                <AppWindow size={16} />
                <span>Get apps and extensions</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={onGiftClaude}>
                <Gift size={16} />
                <span>Gift Claude</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={onLearnMore}>
                <BookOpen size={16} />
                <span>Learn more</span>
                <ChevronRight size={14} className="profile-dropdown__item-chevron" />
              </button>
            </li>
            <li className="profile-dropdown__separator" />
            <li>
              <button type="button" onClick={onLogout}>
                <LogOut size={16} />
                <span>Log out</span>
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
