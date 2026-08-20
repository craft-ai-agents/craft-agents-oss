import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appShellPath = join(__dirname, '../AppShell.tsx')
const profileStripPath = join(__dirname, '../ProfileStrip.tsx')
const topBarPath = join(__dirname, '../TopBar.tsx')

describe('TopBar navigation cutover', () => {
  const appShellSource = readFileSync(appShellPath, 'utf8')
  const profileStripSource = readFileSync(profileStripPath, 'utf8')
  const source = readFileSync(topBarPath, 'utf8')

  it('leaves keyboard shortcut discovery to Settings instead of rendering a duplicate button', () => {
    expect(source).not.toContain('onOpenKeyboardShortcuts')
    expect(source).not.toContain('menu.keyboardShortcuts')
  })

  it('forwards Settings subpage navigation to the canonical AppMenu route', () => {
    expect(source).toContain('onOpenSettingsSubpage={onOpenSettingsSubpage}')
  })

  it('does not retain the legacy TopBar What’s New action', () => {
    expect(source).not.toContain('onWhatsNew')
    expect(source).not.toContain('hasUnseenWhatsNew')
    expect(appShellSource).not.toContain('onWhatsNew={')
    expect(appShellSource).not.toContain('hasUnseenWhatsNew={')
  })

  it('keeps update checks in the ProfileStrip identity menu', () => {
    expect(profileStripSource).toContain("t('menu.checkForUpdates')")
    expect(profileStripSource).toContain('window.electronAPI.checkForUpdates()')
  })
})
