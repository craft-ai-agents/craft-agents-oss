/**
 * Header - App header with branding and controls
 */

import { Sun, Moon, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Jonwork app icon from the committed enterprise brand set.
 */
function CraftAgentLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="jonwork-viewer-icon" x1="4" y1="3" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A78BFA" />
          <stop offset="1" stopColor="#6D4BD1" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#jonwork-viewer-icon)" />
      <path d="M15.8 6.3v7.1c0 3.1-1.8 4.8-4.7 4.8-2 0-3.5-.8-4.4-2.3l2.2-1.5c.5.8 1.1 1.2 2 1.2 1.2 0 1.8-.7 1.8-2.2V9H9.6V6.3h6.2Z" fill="white" />
      <circle cx="18.6" cy="5.4" r="1.5" fill="#67E8F9" />
    </svg>
  )
}

interface HeaderProps {
  hasSession: boolean
  sessionTitle?: string
  isDark: boolean
  onToggleTheme: () => void
  onClear: () => void
}

export function Header({ hasSession, sessionTitle, isDark, onToggleTheme, onClear }: HeaderProps) {
  const { t } = useTranslation()
  return (
    <header className="shrink-0 grid grid-cols-[auto_1fr_auto] items-center px-4 py-3">
      {/* Logo - links to main site */}
      <a
        href="https://thecraftagents.com"
        className="hover:opacity-80 transition-opacity"
        title="Jonwork"
      >
        <CraftAgentLogo className="w-6 h-6 text-[#9570BE]" />
      </a>

      {/* Session title - centered */}
      <div className="flex justify-center">
        {sessionTitle && (
          <span className="text-sm font-semibold text-foreground truncate max-w-md">
            {sessionTitle}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Clear button (when session is loaded) */}
        {hasSession && (
          <button
            onClick={onClear}
            className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
            title={t('viewer.clearSession')}
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Theme toggle */}
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-md bg-background shadow-minimal text-foreground/40 hover:text-foreground/70 transition-colors"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  )
}
