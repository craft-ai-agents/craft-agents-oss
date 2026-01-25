/**
 * WhatsApp IPC Handlers
 *
 * Registers IPC handlers for WhatsApp integration, enabling renderer
 * to communicate with the WhatsApp service in the main process.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import { getWhatsAppService, closeWhatsAppService } from './whatsapp-service'
import { getCredentialManager } from '@vesper/shared/credentials'
import type { SessionManager } from './sessions'

/**
 * Register WhatsApp IPC handlers
 */
export function registerWhatsAppHandlers(sessionManager: SessionManager): void {
  const credentialManager = getCredentialManager()

  /**
   * Connect to WhatsApp
   * Starts the Baileys worker and initiates QR code authentication
   */
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_CONNECT,
    async (_event, { workspaceId, phoneNumber }: { workspaceId: string; phoneNumber: string }) => {
      try {
        const service = getWhatsAppService(workspaceId)

        // Attach error handler to prevent ERR_UNHANDLED_ERROR crashes
        service.on('error', (error) => {
          console.error('[WhatsApp IPC] Service error:', error)
          broadcastWhatsAppEvent(IPC_CHANNELS.WHATSAPP_ERROR, {
            workspaceId,
            message: error.message || 'Unknown error',
            timestamp: error.timestamp || Date.now()
          })
        })

        service.setCredentialManager(credentialManager)
        service.setPhoneNumber(phoneNumber)
        service.setSessionManager(sessionManager)

        await service.start(phoneNumber)

        return { success: true }
      } catch (error) {
        console.error('[WhatsApp IPC] Connect error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Disconnect from WhatsApp
   * Stops the worker and deletes credentials (GDPR compliant)
   */
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_DISCONNECT,
    async (_event, { workspaceId, phoneNumber }: { workspaceId: string; phoneNumber?: string }) => {
      try {
        const service = getWhatsAppService(workspaceId)
        await service.disconnect(phoneNumber)
        closeWhatsAppService(workspaceId)

        return { success: true }
      } catch (error) {
        console.error('[WhatsApp IPC] Disconnect error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Get current WhatsApp connection status
   */
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_STATUS,
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const service = getWhatsAppService(workspaceId)
        const status = service.getConnectionStatus()

        return { success: true, status }
      } catch (error) {
        console.error('[WhatsApp IPC] Status error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * List all WhatsApp sessions for a workspace
   */
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_LIST_SESSIONS,
    async (_event, { workspaceId }: { workspaceId: string }) => {
      try {
        const service = getWhatsAppService(workspaceId)
        service.setCredentialManager(credentialManager)

        const sessions = await service.listSessions()

        return { success: true, sessions }
      } catch (error) {
        console.error('[WhatsApp IPC] List sessions error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  /**
   * Send a message to a WhatsApp group
   */
  ipcMain.handle(
    IPC_CHANNELS.WHATSAPP_SEND_MESSAGE,
    async (_event, { workspaceId, to, content }: { workspaceId: string; to: string; content: string }) => {
      try {
        const service = getWhatsAppService(workspaceId)
        const messageId = await service.sendMessage(to, content)

        return { success: true, messageId }
      } catch (error) {
        console.error('[WhatsApp IPC] Send message error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )
}

/**
 * Broadcast WhatsApp event to all renderer windows
 */
export function broadcastWhatsAppEvent(
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
