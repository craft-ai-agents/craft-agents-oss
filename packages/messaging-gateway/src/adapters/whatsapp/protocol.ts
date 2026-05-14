/**
 * IPC protocol between WhatsAppAdapter and an out-of-process WhatsApp worker.
 *
 * Transport: newline-delimited JSON (NDJSON) over the worker's stdin/stdout.
 * - Adapter -> Worker: one WorkerCommand per line (stdin).
 * - Worker -> Adapter: one WorkerEvent per line (stdout).
 * - Worker stderr is reserved for free-form logs (not parsed).
 */

export type WorkerCommand =
  | StartCommand
  | SubmitPairingPhoneCommand
  | SendTextCommand
  | SendFileCommand
  | ShutdownCommand

export interface StartCommand {
  type: 'start'
  authStateDir: string
  pairingMode?: 'qr' | 'code'
  selfChatMode?: boolean
  responsePrefix?: string
}

export interface SubmitPairingPhoneCommand {
  type: 'submit_pairing_phone'
  phoneNumber: string
}

export interface SendTextCommand {
  id: string
  type: 'send_text'
  channelId: string
  text: string
}

export interface SendFileCommand {
  id: string
  type: 'send_file'
  channelId: string
  dataBase64: string
  filename: string
  caption?: string
  mimeType?: string
}

export interface ShutdownCommand {
  type: 'shutdown'
}

export type WorkerEvent =
  | ReadyEvent
  | QrEvent
  | PairingCodeEvent
  | ConnectedEvent
  | DisconnectedEvent
  | IncomingEvent
  | SendResultEvent
  | ErrorEvent
  | UnavailableEvent

export interface ReadyEvent {
  type: 'ready'
  baileysVersion?: string
  buildId?: string
  gitSha?: string
}

export interface QrEvent {
  type: 'qr'
  qr: string
}

export interface PairingCodeEvent {
  type: 'pairing_code'
  code: string
}

export interface ConnectedEvent {
  type: 'connected'
  jid?: string
  name?: string
}

export interface DisconnectedEvent {
  type: 'disconnected'
  loggedOut: boolean
  reason?: string
}

export interface WorkerIncomingAttachment {
  type: 'photo' | 'document' | 'voice' | 'video' | 'audio'
  fileName?: string
  mimeType?: string
  fileSize?: number
  localPath: string
}

export interface IncomingEvent {
  type: 'incoming'
  channelId: string
  messageId: string
  senderId: string
  senderName?: string
  text: string
  attachments?: WorkerIncomingAttachment[]
  timestamp: number
}

export interface SendResultEvent {
  type: 'send_result'
  id: string
  ok: boolean
  messageId?: string
  error?: string
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

export interface UnavailableEvent {
  type: 'unavailable'
  reason: 'baileys_load_failed' | 'auth_state_error' | 'reconnect_exhausted' | 'unknown'
  message: string
}

export function encodeMessage(msg: WorkerCommand | WorkerEvent): string {
  return JSON.stringify(msg) + '\n'
}

export function parseFrames<T>(buffer: string): { messages: T[]; rest: string } {
  const messages: T[] = []
  let rest = buffer
  while (true) {
    const nl = rest.indexOf('\n')
    if (nl === -1) break
    const line = rest.slice(0, nl).trim()
    rest = rest.slice(nl + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as T)
    } catch {
      // Skip malformed lines so one bad frame does not kill the stream.
    }
  }
  return { messages, rest }
}
