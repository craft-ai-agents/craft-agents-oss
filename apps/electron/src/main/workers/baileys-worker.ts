/**
 * Baileys Worker - WhatsApp Web Connection Handler
 *
 * Runs as a subprocess, communicates with main process via Node.js IPC.
 *
 * Responsibilities:
 * - Connect to WhatsApp Web using Baileys library
 * - Generate and send QR codes for authentication
 * - Handle session persistence and restoration
 * - Process incoming messages and forward to parent
 * - Send outgoing messages on behalf of parent
 *
 * IPC Protocol:
 * Parent → Worker:
 *   - { type: 'restore_session', sessionData: object }
 *   - { type: 'request_session_data' }
 *   - { type: 'send_message', id: string, to: string, content: string }
 *   - { type: 'disconnect' }
 *
 * Worker → Parent:
 *   - { type: 'connection_update', data: ConnectionStatus }
 *   - { type: 'session_updated', data: SessionData }
 *   - { type: 'incoming_message', data: WhatsAppMessage }
 *   - { type: 'message_sent', messageId: string }
 *   - { type: 'error', message: string }
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import * as qrcode from 'qrcode-terminal'
import { join } from 'path'
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'fs'
import { homedir } from 'os'

// ============================================================================
// Types
// ============================================================================

interface ParentMessage {
  type: 'restore_session' | 'request_session_data' | 'send_message' | 'disconnect'
  sessionData?: unknown
  id?: string
  to?: string
  content?: string
}

interface ConnectionUpdateData {
  connection: 'qr' | 'open' | 'close'
  qr?: string
  isNewLogin?: boolean
  shouldReconnect?: boolean
  statusCode?: number
}

interface SessionData {
  jid: string
  pushName: string
  sessionData: unknown
}

interface WhatsAppMessageData {
  id: string
  groupJid: string
  groupName: string
  senderJid: string
  senderPhoneNumber: string
  senderName: string
  content: string
  timestamp: number
  attachments: never[] // TODO: Implement attachment handling
}

// ============================================================================
// Global State
// ============================================================================

const workspaceId = process.env.WORKSPACE_ID || 'default'
let socket: WASocket | null = null
let currentSessionData: SessionData | null = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5

// Auth directory for Baileys state
const authDir = join(homedir(), '.vespr', 'whatsapp-auth', workspaceId)

// ============================================================================
// IPC Communication
// ============================================================================

/**
 * Send message to parent process via IPC
 */
function sendToParent(message: Record<string, unknown>): void {
  if (process.send) {
    try {
      process.send(message)
    } catch (error) {
      console.error('[BaileysWorker] Failed to send to parent:', error)
    }
  }
}

/**
 * Send error to parent
 */
function sendError(message: string): void {
  console.error('[BaileysWorker] Error:', message)
  sendToParent({ type: 'error', message })
}

/**
 * Send connection update to parent
 */
function sendConnectionUpdate(data: ConnectionUpdateData): void {
  sendToParent({ type: 'connection_update', data })
}

// ============================================================================
// WhatsApp Connection
// ============================================================================

/**
 * Initialize WhatsApp connection
 */
async function connect(existingSession?: unknown): Promise<void> {
  try {
    // Ensure auth directory exists
    if (!existsSync(authDir)) {
      mkdirSync(authDir, { recursive: true })
    }

    // If we have existing session data, restore it
    if (existingSession) {
      try {
        // Write session data to auth directory for Baileys to pick up
        const credsPath = join(authDir, 'creds.json')
        writeFileSync(credsPath, JSON.stringify(existingSession), 'utf-8')
        console.log('[BaileysWorker] Restored session data from credentials')
      } catch (error) {
        console.error('[BaileysWorker] Failed to restore session:', error)
      }
    }

    // Load auth state from directory
    const { state, saveCreds } = await useMultiFileAuthState(authDir)

    // Create WhatsApp socket
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We handle QR display ourselves
      browser: ['Vespr', 'Desktop', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
    })

    // Set up event handlers
    setupConnectionHandler(existingSession)
    setupCredentialsHandler(saveCreds)
    setupMessageHandler()

    console.log('[BaileysWorker] WhatsApp socket created')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendError(`Failed to connect: ${message}`)
    throw error
  }
}

/**
 * Handle connection state changes
 */
function setupConnectionHandler(existingSession?: unknown): void {
  if (!socket) return

  socket.ev.on('connection.update', (update: Partial<BaileysEventMap['connection.update']>) => {
    const { connection, lastDisconnect, qr } = update

    // QR code received - send to parent for display
    if (qr) {
      console.log('[BaileysWorker] QR code received')
      sendConnectionUpdate({ connection: 'qr', qr })

      // Also print to terminal for debugging
      qrcode.generate(qr, { small: true }, (code: string) => {
        console.log('[BaileysWorker] Scan this QR code:')
        console.log(code)
      })
    }

    // Connection closed
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(`[BaileysWorker] Connection closed. Status: ${statusCode}, Reconnect: ${shouldReconnect}`)

      sendConnectionUpdate({
        connection: 'close',
        shouldReconnect,
        statusCode,
      })

      // Attempt reconnection if appropriate
      if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000) // Exponential backoff, max 30s
        console.log(`[BaileysWorker] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
        setTimeout(() => connect(existingSession), delay)
      } else if (statusCode === DisconnectReason.loggedOut) {
        // User logged out - clear auth state
        console.log('[BaileysWorker] User logged out, clearing auth state')
        try {
          rmSync(authDir, { recursive: true, force: true })
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // Connection opened successfully
    if (connection === 'open') {
      console.log('[BaileysWorker] Connected to WhatsApp')
      reconnectAttempts = 0 // Reset reconnect counter

      const isNewLogin = !existingSession
      sendConnectionUpdate({ connection: 'open', isNewLogin })

      // Store session info
      if (socket?.user) {
        currentSessionData = {
          jid: socket.user.id,
          pushName: socket.user.name || 'Unknown',
          sessionData: {}, // Will be populated by creds.update
        }
      }
    }
  })
}

/**
 * Handle credential updates (for session persistence)
 */
function setupCredentialsHandler(saveCreds: () => Promise<void>): void {
  if (!socket) return

  socket.ev.on('creds.update', async () => {
    try {
      await saveCreds()
      console.log('[BaileysWorker] Credentials saved')

      // Send updated session data to parent
      if (socket?.user) {
        // Read the current creds to send to parent
        const credsPath = join(authDir, 'creds.json')
        let sessionData: unknown = {}
        try {
          const { readFileSync } = await import('fs')
          sessionData = JSON.parse(readFileSync(credsPath, 'utf-8'))
        } catch {
          // Ignore read errors
        }

        sendToParent({
          type: 'session_updated',
          data: {
            jid: socket.user.id,
            pushName: socket.user.name || 'Unknown',
            sessionData,
          },
        })
      }
    } catch (error) {
      console.error('[BaileysWorker] Failed to save credentials:', error)
    }
  })
}

/**
 * Handle incoming messages
 */
function setupMessageHandler(): void {
  if (!socket) return

  socket.ev.on('messages.upsert', async (event) => {
    const { messages, type } = event

    // Only process new messages (not history sync)
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        await processIncomingMessage(msg)
      } catch (error) {
        console.error('[BaileysWorker] Error processing message:', error)
      }
    }
  })
}

/**
 * Process a single incoming message
 */
async function processIncomingMessage(msg: BaileysEventMap['messages.upsert']['messages'][0]): Promise<void> {
  // Skip messages from self
  if (msg.key.fromMe) return

  // Skip non-group messages (for now, only support group chats)
  const remoteJid = msg.key.remoteJid
  if (!remoteJid?.endsWith('@g.us')) return

  // Extract message content
  const content =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''

  // Only process messages that mention @vespr (bot trigger)
  if (!content.toLowerCase().includes('@vespr')) return

  console.log(`[BaileysWorker] Received message mentioning @vespr: ${content.substring(0, 50)}...`)

  // Get sender info
  const groupJid = remoteJid
  const senderJid = msg.key.participant || remoteJid

  // Get group name
  let groupName = 'Unknown Group'
  if (socket) {
    try {
      const groupMeta = await socket.groupMetadata(groupJid)
      groupName = groupMeta.subject
    } catch (error) {
      console.error('[BaileysWorker] Failed to get group metadata:', error)
    }
  }

  // Extract phone number from JID
  const senderPhone = senderJid.split('@')[0]

  // Build message data
  const messageData: WhatsAppMessageData = {
    id: msg.key.id || `msg_${Date.now()}`,
    groupJid,
    groupName,
    senderJid,
    senderPhoneNumber: `+${senderPhone}`,
    senderName: msg.pushName || 'Unknown',
    content,
    timestamp: (typeof msg.messageTimestamp === 'number'
      ? msg.messageTimestamp
      : Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
    attachments: [], // TODO: Handle media attachments
  }

  // Send to parent process
  sendToParent({ type: 'incoming_message', data: messageData })
}

/**
 * Send a message to a WhatsApp chat
 */
async function sendMessage(to: string, content: string, messageId: string): Promise<void> {
  if (!socket) {
    sendError('Cannot send message: not connected')
    return
  }

  try {
    await socket.sendMessage(to, { text: content })
    console.log(`[BaileysWorker] Message sent to ${to}`)
    sendToParent({ type: 'message_sent', messageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendError(`Failed to send message: ${message}`)
  }
}

/**
 * Disconnect and cleanup
 */
async function disconnect(): Promise<void> {
  console.log('[BaileysWorker] Disconnecting...')

  if (socket) {
    try {
      await socket.logout()
    } catch (error) {
      console.error('[BaileysWorker] Error during logout:', error)
    }
    socket = null
  }

  // Clean up auth state
  try {
    rmSync(authDir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }

  process.exit(0)
}

// ============================================================================
// Parent Message Handler
// ============================================================================

process.on('message', async (msg: ParentMessage) => {
  console.log(`[BaileysWorker] Received command: ${msg.type}`)

  switch (msg.type) {
    case 'restore_session':
      await connect(msg.sessionData)
      break

    case 'request_session_data':
      if (currentSessionData) {
        sendToParent({ type: 'session_updated', data: currentSessionData })
      }
      break

    case 'send_message':
      if (msg.to && msg.content && msg.id) {
        await sendMessage(msg.to, msg.content, msg.id)
      }
      break

    case 'disconnect':
      await disconnect()
      break

    default:
      console.warn(`[BaileysWorker] Unknown command: ${(msg as any).type}`)
  }
})

// ============================================================================
// Error Handling
// ============================================================================

process.on('uncaughtException', (error) => {
  console.error('[BaileysWorker] Uncaught exception:', error)
  sendError(`Uncaught exception: ${error.message}`)
})

process.on('unhandledRejection', (reason) => {
  console.error('[BaileysWorker] Unhandled rejection:', reason)
  sendError(`Unhandled rejection: ${String(reason)}`)
})

// ============================================================================
// Startup
// ============================================================================

console.log(`[BaileysWorker] Starting for workspace: ${workspaceId}`)

// Start connection (will wait for restore_session or connect fresh)
connect().catch((error) => {
  console.error('[BaileysWorker] Failed to start:', error)
  sendError(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
