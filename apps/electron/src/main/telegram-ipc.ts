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
import type { SessionManager } from './sessions'

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
    async (_event, { workspaceId, botToken }: { workspaceId: string; botToken: string }) => {
      try {
        const service = getTelegramService(workspaceId)

        // Attach error handler to prevent ERR_UNHANDLED_ERROR crashes
        service.on('error', (error) => {
          console.error('[Telegram IPC] Service error:', error)
          broadcastTelegramEvent(IPC_CHANNELS.TELEGRAM_ERROR, {
            workspaceId,
            message: error.message || 'Unknown error',
            timestamp: error.timestamp || Date.now()
          })
        })

        service.setCredentialManager(credentialManager)
        service.setSessionManager(sessionManager)

        await service.start(botToken)

        return { success: true }
      } catch (error) {
        console.error('[Telegram IPC] Connect error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Disconnect from Telegram
   * Stops the bot and deletes credentials (GDPR compliant)
   */
  ipcMain.handle(
    IPC_CHANNELS.TELEGRAM_DISCONNECT,
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const service = getTelegramService(workspaceId)
        await service.stop()

        return { success: true }
      } catch (error) {
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
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const service = getTelegramService(workspaceId)
        const status = service.getConnectionStatus()

        return { success: true, status }
      } catch (error) {
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
    async (_event, { workspaceId, chatId, content }: { workspaceId: string; chatId: number; content: string }) => {
      try {
        const service = getTelegramService(workspaceId)
        const messageId = await service.sendMessage(chatId, content)

        return { success: true, messageId }
      } catch (error) {
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
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const token = await credentialManager.getTelegramBotToken(workspaceId)

        return { success: true, token }
      } catch (error) {
        console.error('[Telegram IPC] Get saved token error:', error)
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
