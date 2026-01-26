/**
 * Telegram IPC Handlers
 *
 * Registers IPC handlers for Telegram integration, enabling renderer
 * to communicate with the Telegram service in the main process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { getTelegramService } from './telegram-service'
import { getCredentialManager } from '@vesper/shared/credentials'
import { sanitizeError } from '@vesper/shared/utils'
import { loadWorkspaceConfig, saveWorkspaceConfig, getWorkspacePath } from '@vesper/shared/workspaces'
import { getDefaultAccountConfig } from '@vesper/shared/telegram/account-manager'
import type { SessionManager } from './sessions'
import type { AccessControlConfig } from '@vesper/shared/telegram'

/**
 * Register Telegram IPC handlers
 */
export function registerTelegramHandlers(sessionManager: SessionManager): void {
  const credentialManager = getCredentialManager()

  /**
   * Connect to Telegram
   * Starts the bot with the provided token
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_CONNECT,
    async (_event, { workspaceId, botToken, accountId = 'default' }: { workspaceId: string; botToken: string; accountId?: string }) => {
      try {
        const service = getTelegramService(workspaceId, accountId)

        // Attach error handler to prevent ERR_UNHANDLED_ERROR crashes
        service.on('error', (error) => {
          console.error('[Telegram IPC] Service error:', error)
          broadcastTelegramEvent(IPC_CHANNELS.TELEGRAM_ERROR, {
            workspaceId,
            accountId,
            message: error.message || 'Unknown error',
            timestamp: error.timestamp || Date.now()
          })
        })

        service.setCredentialManager(credentialManager)
        service.setSessionManager(sessionManager)

        // Load access control config
        const workspacePath = getWorkspacePath(workspaceId)
        const config = loadWorkspaceConfig(workspacePath)
        if (config) {
          const account = config.telegramAccounts?.[accountId] || getDefaultAccountConfig()
          const accessControl = account.config.accessControl || null
          service.setAccessControlConfig(accessControl)
        }

        await service.start(botToken)

        return { success: true }
      } catch (error) {
        const sanitized = sanitizeError(error, [botToken])
        console.error('[Telegram IPC] Connect error:', sanitized)
        return { success: false, error: (sanitized as Error).message }
      }
    }
  )

  /**
   * Disconnect from Telegram
   * Stops the bot and deletes credentials (GDPR compliant)
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_DISCONNECT,
    async (_event, { workspaceId, accountId = 'default' }: { workspaceId: string; accountId?: string }) => {
      try {
        const service = getTelegramService(workspaceId, accountId)
        await service.stop()

        return { success: true }
      } catch (error) {
        // No bot token to sanitize on disconnect
        console.error('[Telegram IPC] Disconnect error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Get current Telegram connection status
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_STATUS,
    async (_event, { workspaceId, accountId = 'default' }: { workspaceId: string; accountId?: string }) => {
      try {
        const service = getTelegramService(workspaceId, accountId)
        const status = service.getConnectionStatus()

        return { success: true, status }
      } catch (error) {
        // No bot token to sanitize on status check
        console.error('[Telegram IPC] Status error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Send a message to a Telegram chat
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_SEND_MESSAGE,
    async (_event, { workspaceId, chatId, content, accountId = 'default' }: { workspaceId: string; chatId: number; content: string; accountId?: string }) => {
      try {
        const service = getTelegramService(workspaceId, accountId)
        const messageId = await service.sendMessage(chatId, content)

        return { success: true, messageId }
      } catch (error) {
        // No bot token to sanitize on send message
        console.error('[Telegram IPC] Send message error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Get saved bot token for auto-connect
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_GET_SAVED_TOKEN,
    async (_event, { workspaceId, accountId = 'default' }: { workspaceId: string; accountId?: string }) => {
      try {
        const token = await credentialManager.getTelegramBotToken(workspaceId, accountId)

        return { success: true, token }
      } catch (error) {
        // No bot token to sanitize on get saved token (token not retrieved on error)
        console.error('[Telegram IPC] Get saved token error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Get access control config for a Telegram account
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_GET_ACCESS_CONTROL,
    async (_event, { workspaceId, accountId = 'default' }: { workspaceId: string; accountId?: string }) => {
      try {
        const workspacePath = getWorkspacePath(workspaceId)
        const config = loadWorkspaceConfig(workspacePath)

        if (!config) {
          return { success: false, error: 'Workspace config not found' }
        }

        // Get account config or create default
        const account = config.telegramAccounts?.[accountId] || getDefaultAccountConfig()
        const accessControl = account.config.accessControl || {
          dmPolicy: 'open',
          groupPolicy: 'open',
          allowedUsers: [],
          allowedChats: []
        }

        return { success: true, accessControl }
      } catch (error) {
        console.error('[Telegram IPC] Get access control error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Set access control config for a Telegram account
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_SET_ACCESS_CONTROL,
    async (_event, { workspaceId, accountId = 'default', accessControl }: {
      workspaceId: string
      accountId?: string
      accessControl: AccessControlConfig
    }) => {
      try {
        const workspacePath = getWorkspacePath(workspaceId)
        const config = loadWorkspaceConfig(workspacePath)

        if (!config) {
          return { success: false, error: 'Workspace config not found' }
        }

        // Ensure telegramAccounts exists
        if (!config.telegramAccounts) {
          config.telegramAccounts = {}
        }

        // Get or create account
        if (!config.telegramAccounts[accountId]) {
          config.telegramAccounts[accountId] = getDefaultAccountConfig()
          config.telegramAccounts[accountId].id = accountId
        }

        // Update access control config
        config.telegramAccounts[accountId].config.accessControl = accessControl

        // Save config
        saveWorkspaceConfig(workspacePath, config)

        // Update the service's access control config
        const service = getTelegramService(workspaceId, accountId)
        service.setAccessControlConfig(accessControl)

        return { success: true }
      } catch (error) {
        console.error('[Telegram IPC] Set access control error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )
}

/**
 * Broadcast Telegram event to all renderer windows
 */
export function broadcastTelegramEvent(
  channel: string,
  data: Record<string, unknown>
): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed() && win.webContents.mainFrame) {
      win.webContents.send(channel, data)
    }
  }
}
