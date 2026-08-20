import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const desktopAppMenuPath = join(__dirname, '../DesktopAppMenu.tsx')

describe('DesktopAppMenu shortcuts cutover', () => {
  const src = readFileSync(desktopAppMenuPath, 'utf8')

  it('removes the duplicate Help-menu keyboard shortcuts affordance', () => {
    expect(src).not.toContain('onOpenKeyboardShortcuts')
    expect(src).not.toContain('ROOT_MENU.keyboardShortcuts')
  })

  it('keeps Settings subpage navigation and native Help URL routing intact', () => {
    expect(src).toContain('SETTINGS_ITEMS.map')
    expect(src).toContain('onOpenSettingsSubpage(item.id)')
    expect(src).toContain('HELP_LINKS.map')
    expect(src).toContain('window.electronAPI.openUrl(link.url)')
  })
})
