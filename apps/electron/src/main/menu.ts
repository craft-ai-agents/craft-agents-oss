import { Menu, app, shell, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { EDIT_MENU, VIEW_MENU, WINDOW_MENU } from '../shared/menu-schema'
import type { MenuItem } from '../shared/menu-schema'
import type { WindowManager } from './window-manager'
import { mainLog } from './logger'
import { getMainI18n } from './i18n'
import { buildResetDefaultsDialogOptions, getMenuI18nLabels } from './i18n-labels'

// Store reference for rebuilding menu
let cachedWindowManager: WindowManager | null = null

/**
 * Creates and sets the application menu for macOS.
 * Includes only relevant items for the Craft Agents app.
 *
 * Call rebuildMenu() when update state changes to refresh the menu.
 */
export function createApplicationMenu(windowManager: WindowManager): void {
  cachedWindowManager = windowManager
  rebuildMenu()
}

/**
 * Rebuilds the application menu with current update state.
 * Call this when update availability changes.
 *
 * On Windows/Linux: Menu is hidden - all functionality is in the Craft logo menu.
 * On macOS: Native menu is required by Apple guidelines, so we keep it synced.
 */
export async function rebuildMenu(): Promise<void> {
  if (!cachedWindowManager) return

  const windowManager = cachedWindowManager
  const isMac = process.platform === 'darwin'

  // On Windows/Linux, hide the native menu entirely
  // Users access menu via the Craft logo dropdown in the app
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }

  // Get current update state
  const { getUpdateInfo, installUpdate, checkForUpdates } = await import('./auto-update')
  const updateInfo = getUpdateInfo()
  const updateReady = updateInfo.available && updateInfo.downloadState === 'ready'
  const { t } = await getMainI18n(['menu', 'dialogs'])
  const labels = getMenuI18nLabels(t, updateInfo.latestVersion ?? undefined)

  // Build the update menu item based on state
  const updateMenuItem: Electron.MenuItemConstructorOptions = updateReady
    ? {
        label: labels.installUpdateWithVersion,
        click: async () => {
          await installUpdate()
        }
      }
    : {
        label: labels.checkForUpdates,
        click: async () => {
          await checkForUpdates({ autoDownload: true })
        }
      }

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: labels.appName,
      submenu: [
        { role: 'about' as const, label: labels.aboutApp },
        updateMenuItem,
        { type: 'separator' as const },
        {
          label: labels.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_OPEN_SETTINGS)
        },
        { type: 'separator' as const },
        { role: 'hide' as const, label: labels.hideApp },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: labels.quitApp }
      ]
    }] : []),

    // File menu
    {
      label: labels.file,
      submenu: [
        {
          label: labels.newChat,
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_NEW_CHAT)
        },
        {
          label: labels.newWindow,
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            if (focused) {
              const workspaceId = windowManager.getWorkspaceForWindow(focused.webContents.id)
              if (workspaceId) {
                windowManager.createWindow({ workspaceId })
              }
            }
          }
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },

    // Edit menu (from shared schema)
    {
      label: EDIT_MENU.label,
      submenu: EDIT_MENU.items.map(toElectronMenuItem),
    },

    // View menu (from shared schema + dev-only items)
    {
      label: VIEW_MENU.label,
      submenu: [
        ...VIEW_MENU.items.map(toElectronMenuItem),
        // Dev tools only in development
        ...(!app.isPackaged ? [
          { type: 'separator' as const },
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const }
        ] : [])
      ]
    },

    // Window menu (from shared schema + macOS-specific items)
    {
      label: WINDOW_MENU.label,
      submenu: [
        ...WINDOW_MENU.items.map(toElectronMenuItem),
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const }
        ] : [])
      ]
    },

    // Debug menu (development only)
    ...(!app.isPackaged ? [{
      label: labels.debug,
      submenu: [
        {
          label: labels.debugCheckForUpdates,
          click: async () => {
            const { checkForUpdates } = await import('./auto-update')
            const info = await checkForUpdates({ autoDownload: true })
            mainLog.info('[debug-menu] Update check result:', info)
          }
        },
        {
          label: labels.debugInstallUpdate,
          click: async () => {
            const { installUpdate } = await import('./auto-update')
            try {
              await installUpdate()
            } catch (err) {
              mainLog.error('[debug-menu] Install failed:', err)
            }
          }
        },
        { type: 'separator' as const },
        {
          label: labels.resetToDefaults,
          click: async () => {
            const { dialog } = await import('electron')
            await dialog.showMessageBox(buildResetDefaultsDialogOptions(t))
          }
        }
      ]
    }] : []),

    // Help menu
    {
      label: labels.help,
      submenu: [
        {
          label: labels.helpDocumentation,
          click: () => shell.openExternal('https://agents.craft.do/docs')
        },
        {
          label: labels.keyboardShortcuts,
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_KEYBOARD_SHORTCUTS)
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * Sends an IPC message to the focused renderer window.
 */
function sendToRenderer(channel: string): void {
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel)
  }
}

/**
 * Converts a MenuItem from the shared schema to Electron MenuItemConstructorOptions.
 */
function toElectronMenuItem(item: MenuItem): Electron.MenuItemConstructorOptions {
  if (item.type === 'separator') {
    return { type: 'separator' }
  }

  if (item.type === 'role') {
    // Use Electron's built-in role - it handles accelerators automatically
    return { role: item.role as Electron.MenuItemConstructorOptions['role'] }
  }

  if (item.type === 'action') {
    return {
      label: item.label,
      accelerator: item.shortcut,
      click: () => sendToRenderer(item.ipcChannel),
    }
  }

  // Should never reach here
  return { type: 'separator' }
}
