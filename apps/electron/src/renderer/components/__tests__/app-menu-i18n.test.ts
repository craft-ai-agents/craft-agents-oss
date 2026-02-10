import { describe, expect, it } from 'bun:test'
import type { TFunction } from 'i18next'
import { getAppMenuLabels, getAppMenuSchemaLabels, getAppMenuSettingsItemLabel } from '../AppMenu'

describe('app menu labels', () => {
  it('returns localized top-menu labels', () => {
    const t: TFunction = ((key: string) => ({
      'common:appMenu.aria.craftMenu': 'Craft menu localized',
      'common:appMenu.file.newChat': 'New chat localized',
      'common:appMenu.file.newWindow': 'New window localized',
      'common:appMenu.settings.menu': 'Settings localized',
      'common:appMenu.help.menu': 'Help localized',
      'common:appMenu.debug.menu': 'Debug localized',
      'common:appMenu.quit': 'Quit localized',
      'common:appMenu.aria.goBack': 'Go back localized',
      'common:appMenu.aria.goForward': 'Go forward localized',
      'common:appMenu.schema.sections.edit': 'Edit localized',
      'common:appMenu.schema.sections.view': 'View localized',
      'common:appMenu.schema.sections.window': 'Window localized',
      'common:appMenu.schema.items.undo': 'Undo localized',
      'common:appMenu.schema.items.redo': 'Redo localized',
      'common:appMenu.schema.items.cut': 'Cut localized',
      'common:appMenu.schema.items.copy': 'Copy localized',
      'common:appMenu.schema.items.paste': 'Paste localized',
      'common:appMenu.schema.items.selectAll': 'Select all localized',
      'common:appMenu.schema.items.zoomIn': 'Zoom in localized',
      'common:appMenu.schema.items.zoomOut': 'Zoom out localized',
      'common:appMenu.schema.items.resetZoom': 'Reset zoom localized',
      'common:appMenu.schema.items.toggleFocusMode': 'Toggle focus localized',
      'common:appMenu.schema.items.toggleSidebar': 'Toggle sidebar localized',
      'common:appMenu.schema.items.minimize': 'Minimize localized',
      'common:appMenu.schema.items.maximize': 'Maximize localized',
    } as Record<string, string>)[key] || key) as TFunction

    const labels = getAppMenuLabels(t)

    expect(labels.ariaCraftMenu).toBe('Craft menu localized')
    expect(labels.newChat).toBe('New chat localized')
    expect(labels.newWindow).toBe('New window localized')
    expect(labels.settingsMenu).toBe('Settings localized')
    expect(labels.helpMenu).toBe('Help localized')
    expect(labels.debugMenu).toBe('Debug localized')
    expect(labels.quit).toBe('Quit localized')
    expect(labels.ariaGoBack).toBe('Go back localized')
    expect(labels.ariaGoForward).toBe('Go forward localized')

    const schemaLabels = getAppMenuSchemaLabels(t)
    expect(schemaLabels.sections.edit).toBe('Edit localized')
    expect(schemaLabels.sections.view).toBe('View localized')
    expect(schemaLabels.sections.window).toBe('Window localized')
    expect(schemaLabels.items.undo).toBe('Undo localized')
    expect(schemaLabels.items.toggleSidebar).toBe('Toggle sidebar localized')
    expect(schemaLabels.items.maximize).toBe('Maximize localized')

    const itemLabel = getAppMenuSettingsItemLabel(t, 'appearance')
    expect(itemLabel).toBe('settings:navigator.items.appearance.label')
  })

  it('resolves settings submenu item labels from settings namespace', () => {
    const t: TFunction = ((key: string) => ({
      'settings:navigator.items.appearance.label': '外观',
      'settings:navigator.items.permissions.label': '权限',
    } as Record<string, string>)[key] || key) as TFunction

    expect(getAppMenuSettingsItemLabel(t, 'appearance')).toBe('外观')
    expect(getAppMenuSettingsItemLabel(t, 'permissions')).toBe('权限')
  })
})
