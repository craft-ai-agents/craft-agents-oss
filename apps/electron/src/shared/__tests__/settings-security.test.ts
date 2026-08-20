import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETTINGS_ITEMS } from '../menu-schema'
import { buildCompoundRoute, parseCompoundRoute } from '../route-parser'
import { getSettingsPage, isValidSettingsSubpage, SETTINGS_PAGES } from '../settings-registry'

const settingsPagesSource = readFileSync(join(import.meta.dir, '../../renderer/pages/settings/settings-pages.ts'), 'utf8')
const settingsIconsSource = readFileSync(join(import.meta.dir, '../../renderer/components/icons/SettingsIcons.tsx'), 'utf8')
const sidebarTypesSource = readFileSync(join(import.meta.dir, '../../renderer/components/app-shell/sidebar-types.ts'), 'utf8')

describe('security settings page registry', () => {
  it('registers exactly one security subpage through the canonical registry', () => {
    const entries = SETTINGS_PAGES.filter((page) => page.id === 'security')

    expect(entries).toEqual([
      {
        id: 'security',
        labelKey: 'settings.security.title',
        descriptionKey: 'settings.security.description',
      },
    ])
    expect(isValidSettingsSubpage('security')).toBe(true)
    expect(getSettingsPage('security').id).toBe('security')
  })

  it('derives the deep link and every menu/component/icon integration from the registry', () => {
    const parsed = parseCompoundRoute('settings/security')

    expect(parsed).toEqual({ navigator: 'settings', details: { type: 'security', id: 'security' } })
    expect(buildCompoundRoute(parsed!)).toBe('settings/security')
    expect(settingsPagesSource).toContain('security: SecuritySettingsPage')
    expect(settingsIconsSource).toContain('security: SecuritySettingsIcon')
    expect(settingsIconsSource).toContain('SecuritySettingsIcon = ({ className }: IconProps) => <ShieldAlert')
    expect(SETTINGS_ITEMS.filter((item) => item.id === 'security')).toEqual([
      expect.objectContaining({
        id: 'security',
        labelKey: 'settings.security.title',
        descriptionKey: 'settings.security.description',
        icon: 'ShieldAlert',
      }),
    ])
    expect(sidebarTypesSource).toContain("return { type: 'settings', subpage }")
  })

  it('keeps unknown deep links invalid', () => {
    expect(parseCompoundRoute('settings/security-hidden')).toBeNull()
  })
})
