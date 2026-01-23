import { ChildProcess, spawn } from 'child_process'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { WhatsAppMessage, WhatsAppConnectionStatus, WhatsAppError, WhatsAppSession } from '@craft-agent/shared/whatsapp'
import type { CredentialManager } from '@craft-agent/shared/credentials'
import { createMessageRouter, type WhatsAppMessageRouter } from '@craft-agent/shared/whatsapp/message-router'
import { formatResult } from '@craft-agent/shared/whatsapp/result-formatter'
import type { Message } from '@anthropic-ai/claude-agent-sdk'

export class WhatsAppService extends EventEmitter {
  private subprocess: ChildProcess | null = null
  private isRunning = false
  private connectionStatus: WhatsAppConnectionStatus = { connection: 'close' }
  private sessionData: WhatsAppSession | null = null
  private credentialManager: CredentialManager | null = null
  private phoneNumber: string | null = null
  private messageRouter: WhatsAppMessageRouter | null = null
  private sessionManager: any = null // Will be typed as SessionManager when available

  constructor(private workspaceId: string) {
    super()
  }

  // Set credential manager for session persistence
  setCredentialManager(credentialManager: CredentialManager): void {
    this.credentialManager = credentialManager
  }

  // Set phone number for this service instance
  setPhoneNumber(phoneNumber: string): void {
    this.phoneNumber = phoneNumber
  }

  /**
   * Set SessionManager for routing
   */
  setSessionManager(sessionManager: any): void {
    this.sessionManager = sessionManager
    if (sessionManager && !this.messageRouter) {
      this.messageRouter = createMessageRouter(this.workspaceId, sessionManager)
    }
  }

  // Listen for QR code from subprocess and handle auth
  private setupQRCodeHandler(): void {
    if (!this.subprocess) return

    // Listen for QR code events from subprocess
    this.on('qr_code', async (qrCode: string) => {
      // Emit QR code to renderer for display
      const { ipcMain, BrowserWindow } = require('electron')
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('whatsapp:qr_code', {
            workspaceId: this.workspaceId,
            qrCode
          })
        }
      }

      // Also print to console for Phase 1 (terminal-based)
      console.log('📱 WhatsApp QR Code (scan with phone):')
      console.log(qrCode)
    })
  }

  // Handle successful authentication
  private setupAuthHandler(): void {
    if (!this.subprocess) return

    this.on('connection_status', async (status: WhatsAppConnectionStatus) => {
      // When connection opens and we have a new login
      if (status.connection === 'open' && status.isNewLogin && this.phoneNumber) {
        // Request session data from subprocess
        this.subprocess!.send({ type: 'request_session_data' })
      }
    })

    // Handle session data from subprocess
    this.on('session_updated', async (sessionData: unknown) => {
      if (!this.credentialManager || !this.phoneNumber) return

      try {
        // Store encrypted credentials
        const session: WhatsAppSession = {
          jid: (sessionData as any).jid || '',
          pushName: (sessionData as any).pushName || 'WhatsApp User',
          sessionData, // Opaque - store as-is
          createdAt: Date.now(),
          connectedAt: Date.now(),
          isExpired: false
        }

        this.sessionData = session

        // Encrypt and persist to disk
        await this.credentialManager.setWhatsAppSession(
          this.workspaceId,
          this.phoneNumber,
          session
        )

        // Emit success event to renderer
        const { BrowserWindow } = require('electron')
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send('whatsapp:authenticated', {
              workspaceId: this.workspaceId,
              phoneNumber: this.phoneNumber
            })
          }
        }

        console.log(`✅ WhatsApp authenticated: ${this.phoneNumber}`)
      } catch (error) {
        console.error('Failed to save WhatsApp session:', error)
        this.emit('error', {
          message: 'Failed to save authentication credentials',
          timestamp: Date.now()
        })
      }
    })
  }

  // On service start: restore session if it exists
  private async startWithCredentials(): Promise<void> {
    if (!this.credentialManager || !this.phoneNumber) {
      throw new Error('Credential manager and phone number must be set before starting')
    }

    try {
      // Try to load existing session (no QR needed)
      const savedSession = await this.credentialManager.getWhatsAppSession(
        this.workspaceId,
        this.phoneNumber
      )

      if (savedSession) {
        // Send saved session to subprocess for restoration
        this.subprocess!.send({
          type: 'restore_session',
          sessionData: savedSession.sessionData
        })

        this.sessionData = savedSession

        console.log(`🔌 Restoring WhatsApp session: ${this.phoneNumber}`)
        return
      }
    } catch (error) {
      console.error('Failed to load saved WhatsApp session:', error)
    }

    // No saved session - will show QR code
    console.log('📱 No saved session found. QR code will be displayed.')
  }

  // Start subprocess
  async start(phoneNumber?: string): Promise<void> {
    if (this.isRunning) return

    // Allow phone number to be set
    if (phoneNumber) {
      this.setPhoneNumber(phoneNumber)
    }

    const workerPath = join(__dirname, 'workers', 'baileys-worker.js')
    this.subprocess = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'], // IPC on channel 3
      env: { ...process.env, WORKSPACE_ID: this.workspaceId }
    })

    this.setupEventHandlers()
    this.setupQRCodeHandler()
    this.setupAuthHandler()

    // Try to restore from saved credentials
    if (this.credentialManager && this.phoneNumber) {
      try {
        await this.startWithCredentials()
      } catch (error) {
        console.error('Failed to start with credentials:', error)
      }
    }

    this.isRunning = true
    this.emit('started')
  }

  // Stop subprocess gracefully
  async stop(): Promise<void> {
    if (!this.subprocess || !this.isRunning) return

    // Send disconnect message
    this.subprocess.send({ type: 'disconnect' })

    // Wait for graceful shutdown (max 5s)
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        if (this.subprocess && this.subprocess.exitCode === null) {
          this.subprocess.kill('SIGTERM')
        }
        resolve()
      }, 5000)

      this.subprocess!.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.isRunning = false
    this.connectionStatus = { connection: 'close' }
    this.emit('stopped')
  }

  // Send message to WhatsApp group
  async sendMessage(to: string, content: string): Promise<string> {
    if (!this.subprocess || !this.isRunning) {
      throw new Error('WhatsApp service not running')
    }

    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    this.subprocess.send({
      type: 'send_message',
      id: messageId,
      to,
      content
    })

    return messageId
  }

  // Get connection status
  getConnectionStatus(): WhatsAppConnectionStatus {
    return this.connectionStatus
  }

  /**
   * Fully disconnect and delete WhatsApp credentials (GDPR compliance)
   * - Kills subprocess gracefully
   * - Deletes encrypted credentials from disk
   * - Clears in-memory state
   * - Cannot be recovered after deletion
   */
  async disconnect(phoneNumber?: string): Promise<void> {
    if (!this.isRunning) return

    // Phone number for credential cleanup
    const phone = phoneNumber || this.phoneNumber
    if (!phone) {
      console.warn('No phone number specified for WhatsApp credential cleanup')
    }

    try {
      // 1. Kill subprocess gracefully
      if (this.subprocess) {
        this.subprocess.send({ type: 'disconnect' })
        await new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            if (this.subprocess?.exitCode === null) {
              this.subprocess.kill('SIGTERM')
            }
            resolve()
          }, 5000)

          this.subprocess!.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }

      // 2. Delete encrypted credentials from storage
      if (this.credentialManager && phone) {
        try {
          await this.credentialManager.deleteWhatsAppSession(
            this.workspaceId,
            phone
          )
          console.log(`WhatsApp credentials deleted: ${phone}`)
        } catch (error) {
          console.error('Failed to delete WhatsApp credentials:', error)
          // Still continue with cleanup even if deletion fails
        }
      }

      // 3. Clear in-memory state
      this.isRunning = false
      this.connectionStatus = { connection: 'close' }
      this.sessionData = null
      this.phoneNumber = null

      // 4. Remove event listeners
      this.removeAllListeners()

      // 5. Emit event
      this.emit('disconnected')

      // 6. Broadcast to renderer
      const { BrowserWindow } = require('electron')
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('whatsapp:disconnected', {
            workspaceId: this.workspaceId,
            phoneNumber: phone
          })
        }
      }
    } catch (error) {
      console.error('Error during WhatsApp disconnect:', error)
      // Ensure state is cleared even if error occurs
      this.isRunning = false
      this.emit('error', {
        message: 'Failed to cleanly disconnect WhatsApp',
        timestamp: Date.now()
      })
    }
  }

  /**
   * Get all saved WhatsApp sessions for workspace (for settings UI)
   */
  async listSessions(): Promise<Array<{ phoneNumber: string; connectedAt: number }>> {
    if (!this.credentialManager) return []

    try {
      const sessions = await this.credentialManager.getAllWhatsAppSessions(this.workspaceId)
      return sessions.map(session => ({
        phoneNumber: session.jid?.split('@')[0] || 'unknown',
        connectedAt: session.connectedAt
      }))
    } catch (error) {
      console.error('Failed to list WhatsApp sessions:', error)
      return []
    }
  }

  /**
   * Enhanced event handler for incoming messages
   */
  private setupEventHandlers(): void {
    if (!this.subprocess) return

    // Handle messages from subprocess
    this.subprocess.on('message', async (msg: any) => {
      if (msg.type === 'incoming_message') {
        const whatsappMsg = msg.data as WhatsAppMessage

        // Emit event first (for logging/monitoring)
        this.emit('incoming_message', whatsappMsg)

        // Route through message router
        if (this.messageRouter) {
          try {
            await this.messageRouter.routeIncomingMessage(whatsappMsg)
          } catch (error) {
            console.error('Failed to route WhatsApp message:', error)
            this.emit('routing_error', { message: whatsappMsg, error })
          }
        }
      } else if (msg.type === 'connection_update') {
        this.connectionStatus = msg.data
        this.emit('connection_status', msg.data as WhatsAppConnectionStatus)

        // Emit QR code separately if available
        if (msg.data.qr) {
          this.emit('qr_code', msg.data.qr)
        }
      } else if (msg.type === 'error') {
        const error: WhatsAppError = {
          message: msg.message,
          timestamp: Date.now()
        }
        this.emit('error', error)
      } else if (msg.type === 'message_sent') {
        this.emit('message_sent', msg.messageId)
      } else if (msg.type === 'session_updated') {
        // Session data from subprocess (for persistence)
        this.emit('session_updated', msg.data)
      }
    })

    // Handle subprocess errors
    this.subprocess.on('error', (err) => {
      this.emit('error', {
        message: `Subprocess error: ${err.message}`,
        timestamp: Date.now()
      })
    })

    // Handle subprocess exit
    this.subprocess.on('exit', (code, signal) => {
      this.isRunning = false
      this.connectionStatus = { connection: 'close' }
      if (code !== 0) {
        this.emit('error', {
          message: `Subprocess exited with code ${code} (signal: ${signal})`,
          timestamp: Date.now()
        })
      }
      this.emit('subprocess_exit', { code, signal })
    })

    // Log subprocess output
    if (this.subprocess.stdout) {
      this.subprocess.stdout.on('data', (data) => {
        console.log('[Baileys]', data.toString().trim())
      })
    }
    if (this.subprocess.stderr) {
      this.subprocess.stderr.on('data', (data) => {
        console.error('[Baileys]', data.toString().trim())
      })
    }
  }

  /**
   * Deliver formatted result back to WhatsApp
   */
  async deliverResult(
    groupJid: string,
    sessionId: string,
    sessionMessages: Message[],
  ): Promise<void> {
    try {
      // Format result for WhatsApp constraints
      const formatted = formatResult(sessionMessages, sessionId)

      // Send each message chunk
      for (const resultMessage of formatted.messages) {
        const messageId = await this.sendMessage(groupJid, resultMessage)
        console.log(`✅ Result delivered: ${messageId}`)
      }

      // Log delivery in main window
      this.emit('result_delivered', {
        sessionId,
        messageCount: formatted.messages.length,
        truncated: formatted.truncated,
      })
    } catch (error) {
      console.error('Failed to deliver WhatsApp result:', error)
      this.emit('delivery_error', { sessionId, error })
    }
  }
}

// Export singleton instance per workspace
const instances = new Map<string, WhatsAppService>()

export function getWhatsAppService(workspaceId: string): WhatsAppService {
  if (!instances.has(workspaceId)) {
    instances.set(workspaceId, new WhatsAppService(workspaceId))
  }
  return instances.get(workspaceId)!
}

export function closeWhatsAppService(workspaceId: string): void {
  const service = instances.get(workspaceId)
  if (service) {
    service.stop()
    instances.delete(workspaceId)
  }
}
