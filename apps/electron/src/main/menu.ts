import { Menu, app, shell, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { WindowManager } from './window-manager'

/**
 * Creates and sets the application menu for macOS.
 * Includes only relevant items for the Craft Agents app.
 */
export function createApplicationMenu(windowManager: WindowManager): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'Craft Agents',
      submenu: [
        { role: 'about' as const, label: 'About Craft Agents' },
        { type: 'separator' as const },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_OPEN_SETTINGS)
        },
        { type: 'separator' as const },
        { role: 'hide' as const, label: 'Hide Craft Agents' },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: 'Quit Craft Agents' }
      ]
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_NEW_CHAT)
        },
        {
          label: 'New Window',
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

    // Edit menu (standard roles for text editing)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { role: 'resetZoom' as const },
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

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const }
        ] : [])
      ]
    },

    // Debug menu (development only)
    ...(!app.isPackaged ? [{
      label: 'Debug',
      submenu: [
        {
          label: 'Reset Onboarding Tutorial',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow()
            if (win && !win.isDestroyed()) {
              await win.webContents.executeJavaScript(
                `localStorage.removeItem('craft-tutorial-progress')`
              )
              win.reload()
            }
          }
        }
      ]
    }] : []),

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_KEYBOARD_SHORTCUTS)
        },
        {
          label: 'Documentation',
          click: () => sendToRenderer(IPC_CHANNELS.MENU_OPEN_HELP)
        },
        { type: 'separator' as const },
        {
          label: 'Open Craft App',
          click: () => shell.openExternal('craftdocs://')
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
