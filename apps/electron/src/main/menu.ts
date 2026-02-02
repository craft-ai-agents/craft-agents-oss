import { Menu, app, shell, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { WindowManager } from './window-manager'
import { mainLog } from './logger'
import i18n from './i18n'

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

  // Helper to translate menu strings
  const t = (key: string, options?: any) => i18n.t(key, options)

  // Build the update menu item based on state
  const updateMenuItem: Electron.MenuItemConstructorOptions = updateReady
    ? {
        label: `${t('menu.app.installUpdate')}\t【${updateInfo.latestVersion}】`,
        click: async () => {
          await installUpdate()
        }
      }
    : {
        label: t('menu.app.checkForUpdates'),
        click: async () => {
          await checkForUpdates({ autoDownload: true })
        }
      }

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'Craft Agents',
      submenu: [
        { role: 'about' as const, label: t('menu.app.about') },
        updateMenuItem,
        { type: 'separator' as const },
        {
          label: t('menu.app.settings'),
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_OPEN_SETTINGS)
        },
        { type: 'separator' as const },
        { role: 'hide' as const, label: t('menu.app.hide') },
        { role: 'hideOthers' as const, label: t('menu.app.hideOthers') },
        { role: 'unhide' as const, label: t('menu.app.unhide') },
        { type: 'separator' as const },
        { role: 'quit' as const, label: t('menu.app.quit') }
      ]
    }] : []),

    // File menu
    {
      label: t('menu.file.title'),
      submenu: [
        {
          label: t('menu.file.newChat'),
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_NEW_CHAT)
        },
        {
          label: t('menu.file.newWindow'),
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
        isMac ? { role: 'close' as const, label: t('menu.file.close') } : { role: 'quit' as const, label: t('menu.file.quit') }
      ]
    },

    // Edit menu (standard roles for text editing)
    {
      label: t('menu.edit.title'),
      submenu: [
        { role: 'undo' as const, label: t('menu.edit.undo') },
        { role: 'redo' as const, label: t('menu.edit.redo') },
        { type: 'separator' as const },
        { role: 'cut' as const, label: t('menu.edit.cut') },
        { role: 'copy' as const, label: t('menu.edit.copy') },
        { role: 'paste' as const, label: t('menu.edit.paste') },
        { role: 'selectAll' as const, label: t('menu.edit.selectAll') }
      ]
    },

    // View menu
    {
      label: t('menu.view.title'),
      submenu: [
        { role: 'zoomIn' as const, label: t('menu.view.zoomIn') },
        { role: 'zoomOut' as const, label: t('menu.view.zoomOut') },
        { role: 'resetZoom' as const, label: t('menu.view.resetZoom') },
        // Dev tools only in development
        ...(!app.isPackaged ? [
          { type: 'separator' as const },
          { role: 'reload' as const, label: t('menu.view.reload') },
          { role: 'forceReload' as const, label: t('menu.view.forceReload') },
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const, label: t('menu.view.toggleDevTools') }
        ] : [])
      ]
    },

    // Window menu
    {
      label: t('menu.window.title'),
      submenu: [
        { role: 'minimize' as const, label: t('menu.window.minimize') },
        { role: 'zoom' as const, label: t('menu.window.zoom') },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const, label: t('menu.window.bringAllToFront') }
        ] : [])
      ]
    },

    // Debug menu (development only)
    ...(!app.isPackaged ? [{
      label: t('menu.debug.title'),
      submenu: [
        {
          label: t('menu.debug.checkForUpdates'),
          click: async () => {
            const { checkForUpdates } = await import('./auto-update')
            const info = await checkForUpdates({ autoDownload: true })
            mainLog.info('[debug-menu] Update check result:', info)
          }
        },
        {
          label: t('menu.debug.installUpdate'),
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
          label: t('menu.debug.resetToDefaults'),
          click: async () => {
            const { dialog } = await import('electron')
            await dialog.showMessageBox({
              type: 'info',
              message: t('menu.debug.resetMessage'),
              detail: t('menu.debug.resetDetail'),
              buttons: ['OK']
            })
          }
        }
      ]
    }] : []),

    // Help menu
    {
      label: t('menu.help.title'),
      submenu: [
        {
          label: t('menu.help.helpDocumentation'),
          click: () => shell.openExternal('https://agents.craft.do/docs')
        },
        {
          label: t('menu.help.keyboardShortcuts'),
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
