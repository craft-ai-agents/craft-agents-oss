import {
  ROOT_MENU,
  HELP_LINKS,
  DEBUG_MENU,
  SETTINGS_ITEMS,
  type SettingsMenuItem,
} from '../../../shared/menu-schema'

/** Identifies one of the mobile menu pages. */
export type MobileMenuPageId = 'root' | 'settings' | 'help' | 'debug'

/**
 * What a mobile menu row does on tap.
 *
 * The renderer maps these to concrete callbacks/effects. Keeping the data
 * declarative means one schema feeds desktop, mobile, and any future shapes.
 */
export type MobileMenuAction =
  | { kind: 'navigate'; to: MobileMenuPageId }
  | { kind: 'callback'; key: 'newChat' | 'newWindow' | 'openSettings' }
  | { kind: 'settingsSubpage'; subpage: SettingsMenuItem['id'] }
  | { kind: 'url'; url: string }
  | { kind: 'electronApi'; method: 'checkForUpdates' | 'installUpdate' | 'menuToggleDevTools' }

export interface MobileMenuRow {
  id: string
  iconName: string
  labelKey: string
  description?: string
  action: MobileMenuAction
}

export interface MobileMenuPage {
  id: MobileMenuPageId
  /** i18n key for the page title shown in the header. */
  titleKey: string
  rows: MobileMenuRow[]
}

interface BuildOptions {
  hasNewWindow: boolean
  isDebugMode: boolean
}

/**
 * Build the mobile menu page graph from the shared schema.
 *
 * The Edit/View/Window submenus are intentionally omitted on mobile:
 * - Edit (Undo/Redo/Cut/Copy/Paste/Select All) — handled by the OS-native edit menu on touch.
 * - View (Zoom, sidebar/focus toggles) — browser-native zoom; sidebar/focus are no-ops in compact.
 * - Window (Minimize/Maximize) — meaningless in a browser tab.
 * - Quit — also meaningless in a browser tab.
 *
 * Adding a new help link requires only an addition to `HELP_LINKS`. Adding a new
 * settings page requires only an addition to `SETTINGS_PAGES`. Both fan out here.
 */
export function buildMobileMenuPages({ hasNewWindow, isDebugMode }: BuildOptions): MobileMenuPage[] {
  const rootRows: MobileMenuRow[] = [
    {
      id: ROOT_MENU.newChat.id,
      iconName: 'SquarePen',
      labelKey: ROOT_MENU.newChat.labelKey,
      action: { kind: 'callback', key: 'newChat' },
    },
  ]
  if (hasNewWindow) {
    rootRows.push({
      id: ROOT_MENU.newWindow.id,
      iconName: ROOT_MENU.newWindow.icon,
      labelKey: ROOT_MENU.newWindow.labelKey,
      action: { kind: 'callback', key: 'newWindow' },
    })
  }
  // Touch users have no keyboard, so the Keyboard Shortcuts leaf is omitted
  // on mobile — the page would render but be useless.
  rootRows.push(
    {
      id: 'settings',
      iconName: 'Settings',
      labelKey: 'sidebar.settings',
      action: { kind: 'navigate', to: 'settings' },
    },
    {
      id: 'help',
      iconName: 'HelpCircle',
      labelKey: 'menu.help',
      action: { kind: 'navigate', to: 'help' },
    },
  )
  if (isDebugMode) {
    rootRows.push({
      id: 'debug',
      iconName: DEBUG_MENU.icon,
      labelKey: DEBUG_MENU.labelKey,
      action: { kind: 'navigate', to: 'debug' },
    })
  }

  const settingsRows: MobileMenuRow[] = [
    {
      id: 'settings-overview',
      iconName: 'Settings',
      labelKey: 'menu.settings',
      action: { kind: 'callback', key: 'openSettings' },
    },
    ...SETTINGS_ITEMS.map<MobileMenuRow>((item) => ({
      id: `settings-${item.id}`,
      iconName: item.icon,
      labelKey: item.labelKey,
      description: item.descriptionKey,
      action: { kind: 'settingsSubpage', subpage: item.id },
    })),
  ]

  const helpRows: MobileMenuRow[] = HELP_LINKS.map<MobileMenuRow>((link) => ({
    id: link.id,
    iconName: link.icon,
    labelKey: link.labelKey,
    action: { kind: 'url', url: link.url },
  }))

  const debugRows: MobileMenuRow[] = DEBUG_MENU.items
    .filter((item) => item.type === 'action')
    .map<MobileMenuRow>((item) => {
      // Narrowed by the filter above.
      const action = item as Extract<typeof item, { type: 'action' }>
      return {
        id: action.id,
        iconName: action.icon,
        labelKey: action.labelKey,
        action: {
          kind: 'electronApi',
          method:
            action.id === 'checkForUpdates' ? 'checkForUpdates' :
            action.id === 'installUpdate' ? 'installUpdate' :
            'menuToggleDevTools',
        },
      }
    })

  return [
    { id: 'root', titleKey: 'menu.craftMenu', rows: rootRows },
    { id: 'settings', titleKey: 'sidebar.settings', rows: settingsRows },
    { id: 'help', titleKey: 'menu.help', rows: helpRows },
    { id: 'debug', titleKey: DEBUG_MENU.labelKey, rows: debugRows },
  ]
}
