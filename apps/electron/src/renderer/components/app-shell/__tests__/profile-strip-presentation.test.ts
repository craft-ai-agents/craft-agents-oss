import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const profileStripPath = join(__dirname, '../ProfileStrip.tsx')

describe('ProfileStrip presentation', () => {
  const src = readFileSync(profileStripPath, 'utf8')

  it('renders a compact identity menu instead of persistent gamification content', () => {
    expect(src).toContain('<DropdownMenu open={open} onOpenChange={setOpen}>')
    expect(src).toContain('defaultAvatarFallback?: React.ReactNode')
    expect(src).toContain('default-avatar.svg')
    expect(src).toContain('<ChevronDown')
    expect(src).not.toContain('initialsFromName')
    expect(src).not.toContain('role="progressbar"')
    expect(src).not.toContain("t('profile.level'")
    expect(src).not.toContain("t('profile.xp")
    expect(src).not.toContain("t('profile.balance")
  })

  it('offers settings, updates, and a confirmed destructive sign-out only', () => {
    expect(src).toContain("t('menu.settings')")
    expect(src).toContain("t('menu.checkForUpdates')")
    expect(src).toContain("t('settings.accounts.signOut')")
    expect(src).toContain('showLogoutConfirmation()')
    expect(src).toContain('window.electronAPI.logout()')
    expect(src).not.toContain('menu.keyboardShortcuts')
  })
})
