import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleHelp,
  CircleUserRound,
  Coins,
  Download,
  LogOut,
  Palette,
  RefreshCw,
  Settings,
  UsersRound,
  X,
} from 'lucide-react'

import { useTheme } from '@/context/ThemeContext'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { DESKTOP_WINDOWS_DOWNLOAD_URL } from './desktop-download'

interface WebAccount {
  id?: string
  username: string
  credits: number | null
  role?: 'admin' | 'user'
}
interface ManagedUser extends Required<Omit<WebAccount, 'credits'>> {
  credits: number
}
const HELP_URL = 'https://thecraftagents.com/docs'

interface SidebarAccountMenuProps {
  onOpenSettings: () => void
  onLogout: () => void
}

export function SidebarAccountMenu({ onOpenSettings, onLogout }: SidebarAccountMenuProps) {
  const { t } = useTranslation()
  const { resolvedMode, setMode } = useTheme()
  const [account, setAccount] = useState<WebAccount>({ username: '用户名', credits: null })
  const [showUserManagement, setShowUserManagement] = useState(false)
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [adminError, setAdminError] = useState('')
  const isWebAccountUi = /^https?:$/.test(window.location.protocol)

  useEffect(() => {
    let active = true
    const refresh = () => {
      const request = isWebAccountUi
        ? fetch('/api/account', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null)
        : window.electronAPI.getDesktopAccount().then(result => result?.account ?? null)
      request
        .then(data => {
          if (active && data?.username) setAccount(data)
        })
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('jonwork:credits-changed', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('jonwork:credits-changed', refresh)
    }
  }, [isWebAccountUi])

  const refreshUsers = async () => {
    const response = await fetch('/api/admin/users', { credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || '加载用户失败')
    setUsers(data.users)
  }

  const openUserManagement = () => {
    setAdminError('')
    setShowUserManagement(true)
    void refreshUsers().catch(error => setAdminError(error instanceof Error ? error.message : '加载用户失败'))
  }

  const rechargeUser = async (user: ManagedUser) => {
    const input = window.prompt(`给 ${user.username} 充值积分`, '300')
    if (input == null) return
    const amount = Number(input)
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setAdminError('请输入正整数积分')
      return
    }
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/recharge`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setAdminError(data.error || '充值失败')
      return
    }
    setAdminError('')
    await refreshUsers()
    window.dispatchEvent(new Event('jonwork:credits-changed'))
  }

  const changeRole = async (user: ManagedUser, role: 'admin' | 'user') => {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/role`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setAdminError(data.error || '角色更新失败')
      return
    }
    setAdminError('')
    await refreshUsers()
  }

  const handleLogout = () => {
    if (/^https?:$/.test(window.location.protocol)) {
      void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .finally(() => { window.location.href = '/login' })
      return
    }
    onLogout()
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-2.5 rounded-[10px] bg-foreground/[0.04] px-2 py-2 text-left outline-none transition-colors hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label={account.username}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ring-1 ring-accent/20">
            <CircleUserRound className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/85">
            {account.username}
          </span>
          {account.credits != null && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{account.credits} 积分</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <StyledDropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        minWidth="min-w-[280px]"
        className="rounded-[18px] p-2 shadow-modal-small"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="text-[16px] font-semibold tracking-tight text-foreground">
            {account.username}
          </div>
          {account.credits != null && (
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Coins className="h-3.5 w-3.5" />
              剩余 {account.credits} 积分
            </div>
          )}
        </div>

        <StyledDropdownMenuSeparator className="mx-0" />

        <StyledDropdownMenuItem onClick={onOpenSettings} className="min-h-10 rounded-[8px] px-2.5">
          <Settings />
          {t('sidebar.settings')}
        </StyledDropdownMenuItem>

        {isWebAccountUi && account.role === 'admin' && (
          <StyledDropdownMenuItem onClick={openUserManagement} className="min-h-10 rounded-[8px] px-2.5">
            <UsersRound />
            用户与积分管理
          </StyledDropdownMenuItem>
        )}

        <div className="flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 text-sm">
          <Palette className="h-3.5 w-3.5 shrink-0" />
          <span>{t('settings.appearance.title')}</span>
          <div className="ml-auto flex rounded-[9px] bg-foreground/[0.06] p-1">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMode(mode)}
                className={cn(
                  'rounded-[7px] px-3 py-1 text-xs transition-colors',
                  resolvedMode === mode
                    ? 'bg-background font-medium text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`settings.appearance.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <StyledDropdownMenuItem
          onClick={() => window.electronAPI.openUrl(HELP_URL)}
          className="min-h-10 rounded-[8px] px-2.5"
        >
          <CircleHelp />
          {t('menu.helpAndDocs')}
        </StyledDropdownMenuItem>

        {isWebAccountUi ? (
          <StyledDropdownMenuItem
            onClick={() => { window.location.href = DESKTOP_WINDOWS_DOWNLOAD_URL }}
            className="min-h-10 rounded-[8px] px-2.5"
          >
            <Download />
            下载 Windows 客户端
          </StyledDropdownMenuItem>
        ) : (
          <StyledDropdownMenuItem
            onClick={() => window.electronAPI.checkForUpdates()}
            className="min-h-10 rounded-[8px] px-2.5"
          >
            <RefreshCw />
            {t('menu.checkForUpdates')}
          </StyledDropdownMenuItem>
        )}

        <StyledDropdownMenuSeparator className="mx-0" />

        <StyledDropdownMenuItem onClick={handleLogout} className="min-h-10 rounded-[8px] px-2.5">
          <LogOut />
          {t('webui.logOut')}
        </StyledDropdownMenuItem>
      </StyledDropdownMenuContent>
    </DropdownMenu>
    {showUserManagement && (
      <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/35 p-4" onMouseDown={() => setShowUserManagement(false)}>
        <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border bg-background p-5 shadow-modal-small" onMouseDown={event => event.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">用户与积分管理</h2>
              <p className="text-xs text-muted-foreground">管理员可充值和设置角色，但不能查看其他用户的工作区数据。</p>
            </div>
            <button type="button" onClick={() => setShowUserManagement(false)} className="rounded-lg p-2 hover:bg-foreground/[0.06]" aria-label="关闭">
              <X className="h-4 w-4" />
            </button>
          </div>
          {adminError && <div className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{adminError}</div>}
          <div className="space-y-2">
            {users.map(user => (
              <div key={user.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{user.username}</div>
                  <div className="text-xs text-muted-foreground">{user.credits} 积分 · {user.role === 'admin' ? '管理员' : '普通用户'}</div>
                </div>
                <select
                  value={user.role}
                  onChange={event => void changeRole(user, event.target.value as 'admin' | 'user')}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
                <button type="button" onClick={() => void rechargeUser(user)} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90">
                  充值
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    </>
  )
}
