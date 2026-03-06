import { Menu, app, shell, BrowserWindow } from 'electron'
import { RPC_CHANNELS, type BroadcastEventMap } from '../shared/types'
import { EDIT_MENU, VIEW_MENU, WINDOW_MENU } from '../shared/menu-schema'
import type { MenuItem } from '../shared/menu-schema'
import type { WindowManager } from './window-manager'
import type { EventSink } from '@craft-agent/server-core/transport'
import { mainLog } from './logger'

type ClientResolver = (webContentsId: number) => string | undefined

// Store references for rebuilding menu
let cachedWindowManager: WindowManager | null = null
let cachedEventSink: EventSink | null = null
let cachedClientResolver: ClientResolver | null = null

/**
 * Creates and sets the application menu for macOS.
 * Includes only relevant items for the Craft Agents app.
 *
 * Call rebuildMenu() when update state changes to refresh the menu.
 */
export function createApplicationMenu(windowManager: WindowManager, sink?: EventSink, resolver?: ClientResolver): void {
  cachedWindowManager = windowManager
  cachedEventSink = sink ?? null
  cachedClientResolver = resolver ?? null
  rebuildMenu()
}

/**
 * Set the event sink and client resolver after server creation.
 * Called separately from createApplicationMenu since the server may not exist at menu init time.
 */
export function setMenuEventSink(sink: EventSink, resolver: ClientResolver): void {
  cachedEventSink = sink
  cachedClientResolver = resolver
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

  // Build the update menu item based on state
  const updateMenuItem: Electron.MenuItemConstructorOptions = updateReady
    ? {
        label: `Install Update…\t【${updateInfo.latestVersion}】`,
        click: async () => {
          await installUpdate()
        }
      }
    : {
        label: 'Check for Updates…',
        click: async () => {
          await checkForUpdates({ autoDownload: true })
        }
      }

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'Craft Agents',
      submenu: [
        { role: 'about' as const, label: 'About Craft Agents' },
        updateMenuItem,
        { type: 'separator' as const },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          registerAccelerator: false,  // Action registry handles the keyboard shortcut
          click: () => sendToRenderer(RPC_CHANNELS.menu.OPEN_SETTINGS)
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
          registerAccelerator: false,  // Action registry handles the keyboard shortcut
          click: () => sendToRenderer(RPC_CHANNELS.menu.NEW_CHAT)
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          registerAccelerator: false,  // Action registry handles the keyboard shortcut
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
          {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: (_menuItem: Electron.MenuItem, window: Electron.BaseWindow | undefined) => {
              const browserWindow = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
              if (!browserWindow) return
              const views = browserWindow.getBrowserViews()
              if (views.length > 0) {
                views[0].webContents.reload()
              } else {
                browserWindow.webContents.reload()
              }
            }
          },
          {
            label: 'Force Reload',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: (_menuItem: Electron.MenuItem, window: Electron.BaseWindow | undefined) => {
              const browserWindow = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
              if (!browserWindow) return
              const views = browserWindow.getBrowserViews()
              if (views.length > 0) {
                views[0].webContents.reloadIgnoringCache()
              } else {
                browserWindow.webContents.reloadIgnoringCache()
              }
            }
          },
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
      label: 'Debug',
      submenu: [
        {
          label: 'Check for Updates',
          click: async () => {
            const { checkForUpdates } = await import('./auto-update')
            const info = await checkForUpdates({ autoDownload: true })
            mainLog.info('[debug-menu] Update check result:', info)
          }
        },
        {
          label: 'Install Update',
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
          label: 'Reset to Defaults...',
          click: async () => {
            const { dialog } = await import('electron')
            await dialog.showMessageBox({
              type: 'info',
              message: 'Reset to Defaults',
              detail: 'To reset Craft Agent to defaults, quit the app and run:\n\nbun run fresh-start\n\nThis will delete all configuration, credentials, workspaces, and sessions.',
              buttons: ['OK']
            })
          }
        }
      ]
    }] : []),

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Help & Documentation',
          click: () => shell.openExternal('https://agents.craft.do/docs')
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          registerAccelerator: false,  // Action registry handles the keyboard shortcut
          click: () => sendToRenderer(RPC_CHANNELS.menu.KEYBOARD_SHORTCUTS)
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/** Menu channels that are main→renderer push events in BroadcastEventMap */
type MenuBroadcastChannel = Extract<keyof BroadcastEventMap, `menu:${string}`>

/**
 * Sends an event to the focused renderer window via the RPC event sink.
 */
function sendToRenderer(channel: MenuBroadcastChannel): void {
  if (!cachedEventSink || !cachedClientResolver) return
  const win = BrowserWindow.getFocusedWindow()
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    const clientId = cachedClientResolver(win.webContents.id)
    if (clientId) {
      cachedEventSink(channel, { to: 'client', clientId })
    }
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
      registerAccelerator: false,  // Action registry handles the keyboard shortcut
      click: () => sendToRenderer(item.ipcChannel as MenuBroadcastChannel),
    }
  }

  // Should never reach here
  return { type: 'separator' }
}
