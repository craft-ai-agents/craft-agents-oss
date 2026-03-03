import { dialog, BrowserWindow } from 'electron'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { IPC_CHANNELS } from '../../shared/types'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { RpcServer } from '../../transport/types'
import type { HandlerDeps } from './handler-deps'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.auth.LOGOUT,
  IPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION,
  IPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION,
  IPC_CHANNELS.credentials.HEALTH_CHECK,
] as const

export function registerAuthHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Show logout confirmation dialog
  server.handle(IPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION, async () => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Log Out'],
      defaultId: 0,
      cancelId: 0,
      title: 'Log Out',
      message: 'Are you sure you want to log out?',
      detail: 'All conversations will be deleted. This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Log Out
    return result.response === 1
  })

  // Show delete session confirmation dialog
  server.handle(IPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION, async (_ctx, name: string) => {
    const window = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Conversation',
      message: `Are you sure you want to delete: "${name}"?`,
      detail: 'This action cannot be undone.',
    } as Electron.MessageBoxOptions)
    // result.response is the index of the clicked button
    // 0 = Cancel, 1 = Delete
    return result.response === 1
  })

  // Logout - clear all credentials and config
  server.handle(IPC_CHANNELS.auth.LOGOUT, async () => {
    try {
      const manager = getCredentialManager()

      // List and delete all stored credentials
      const allCredentials = await manager.list()
      for (const credId of allCredentials) {
        await manager.delete(credId)
      }

      // Delete the config file
      const configPath = join(homedir(), '.craft-agent', 'config.json')
      await unlink(configPath).catch(() => {
        // Ignore if file doesn't exist
      })

      deps.platform.logger.info('Logout complete - cleared all credentials and config')
    } catch (error) {
      deps.platform.logger.error('Logout error:', error)
      throw error
    }
  })

  // Credential health check - validates credential store is readable and usable
  // Called on app startup to detect corruption, machine migration, or missing credentials
  server.handle(IPC_CHANNELS.credentials.HEALTH_CHECK, async () => {
    const manager = getCredentialManager()
    return manager.checkHealth()
  })
}
