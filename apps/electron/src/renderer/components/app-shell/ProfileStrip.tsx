/**
 * Sidebar profile strip — compact identity trigger for account actions.
 *
 * Legacy gamification values remain in ProfileStripData for host compatibility,
 * but this surface deliberately renders no progress, level, or balance state.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, LogOut, RefreshCw, Settings } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

const bundledDefaultAvatar = new URL(
  '../../../../resources/default-avatar.svg',
  import.meta.url,
).href

export interface ProfileStripData {
  displayName: string
  level: number
  xp: number
  progress: number
  xpIntoLevel: number
  xpForNext: number
  nextThreshold: number | null
  balance: number | null
}

interface ProfileStripProps {
  data: ProfileStripData
  onClick: () => void
  className?: string
  defaultAvatarFallback?: React.ReactNode
}

export function ProfileStrip({
  data,
  onClick,
  className,
  defaultAvatarFallback,
}: ProfileStripProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const displayName = data.displayName || t('profile.defaultName')
  const avatarFallback = defaultAvatarFallback ?? (
    <img
      src={bundledDefaultAvatar}
      alt=""
      className="h-full w-full object-cover"
    />
  )

  const openSettings = () => {
    setOpen(false)
    onClick()
  }

  const checkForUpdates = () => {
    setOpen(false)
    void window.electronAPI.checkForUpdates().catch(() => {
      toast.error(t('toast.failedToCheckUpdates'))
    })
  }

  const handleLogout = async () => {
    try {
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return
      setOpen(false)
      await window.electronAPI.logout()
      toast.success(t('settings.accounts.disconnected'))
    } catch {
      toast.error(t('common.failed'))
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-2 py-2 rounded-md',
            'text-left hover:bg-foreground/5 transition-colors',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className,
          )}
          aria-label={t('accountMenu.openMenu')}
          data-tutorial="profile-strip"
        >
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback
              delayMs={0}
              className="bg-foreground/10 text-foreground/80"
            >
              {avatarFallback}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">
            {displayName}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <StyledDropdownMenuContent align="start" sideOffset={6} minWidth="min-w-52">
        <StyledDropdownMenuItem className="font-sans" onClick={openSettings}>
          <Settings className="h-4 w-4" />
          {t('menu.settings')}
        </StyledDropdownMenuItem>
        <StyledDropdownMenuItem className="font-sans" onClick={checkForUpdates}>
          <RefreshCw className="h-4 w-4" />
          {t('menu.checkForUpdates')}
        </StyledDropdownMenuItem>
        <StyledDropdownMenuSeparator />
        <StyledDropdownMenuItem
          className="font-sans text-destructive focus:text-destructive"
          onClick={() => void handleLogout()}
        >
          <LogOut className="h-4 w-4" />
          {t('settings.accounts.signOut')}
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
  )
}
